
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isSafeInternalPath } from '@/utils/auth/safe-path'

export { isSafeInternalPath }

type CookieToSet = { name: string; value: string; options: CookieOptions }

const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password', '/ponto/login']
// Routes that must bypass *all* auth gating (including the
// "authenticated → /dashboard" redirect). Invite & OAuth callbacks land here
// before the client-side session has been established from the URL hash, so
// they must never be redirected — neither to /login nor to /dashboard.
// /ponto/ativar é a landing do convite do colaborador (equivalente a /welcome):
// o token chega na URL (hash/code) e é trocado por sessão no cliente, então
// NÃO pode ser barrado pelo gate de sessão do servidor.
const AUTH_UTILITY_ROUTES = ['/auth', '/welcome', '/ponto/ativar', '/access-restricted']
const PROFILE_SETUP_ROUTES = ['/onboarding']
const ACCESS_RESTRICTED_ROUTE = '/access-restricted'

type RoutePermission = {
    prefix: string
    permission?: string | null
    anyPermission?: string[]
}

const ROUTE_PERMISSIONS: RoutePermission[] = [
    // Admin (most specific first)
    { prefix: '/admin/users', permission: 'admin.manage_users' },
    { prefix: '/admin/roles', permission: 'admin.manage_roles' },
    { prefix: '/admin/audit', permission: 'audit.view' },
    { prefix: '/admin', permission: 'admin.view' },
    // Finance / contracts / projects / risks
    { prefix: '/financeiro', permission: 'finance.view' },
    { prefix: '/contratos', permission: 'contracts.view' },
    { prefix: '/projetos', permission: 'projects.view' },
    { prefix: '/projects', permission: 'projects.view' },
    { prefix: '/riscos', permission: 'risks.view' },
    // Portal de Ponto Web (colaborador; /ponto/login é público)
    { prefix: '/ponto', anyPermission: ['people.attendance_use', 'people.attendance_view', 'people.attendance_manage'] },
    // People / org (most specific first)
    { prefix: '/workforce-cost/aprovacoes', permission: 'people.timesheet_approve' },
    { prefix: '/workforce-cost/custos', anyPermission: ['people.cost_view', 'people.cost_manage'] },
    { prefix: '/workforce-cost/jornada', anyPermission: ['people.attendance_use', 'people.attendance_view', 'people.attendance_manage'] },
    { prefix: '/workforce-cost/governanca', anyPermission: ['people.governance_view', 'people.governance_manage'] },
    { prefix: '/workforce-cost/inteligencia', anyPermission: ['people.allocations_view', 'people.ai_insights'] },
    { prefix: '/workforce-cost/geofences', anyPermission: ['people.geofence_manage', 'people.attendance_view'] },
    { prefix: '/workforce-cost/ponto-oficial', permission: 'people.rep_manage' },
    { prefix: '/workforce-cost', permission: 'people.view' },
    { prefix: '/pessoas', permission: 'people.view' },
    { prefix: '/organograma', permission: 'org_chart.view' },
    { prefix: '/membros', permission: 'committees.view' },
    // Governance
    { prefix: '/reunioes', permission: 'meetings.view' },
    { prefix: '/atas', permission: 'minutes.view' },
    { prefix: '/comites', permission: 'committees.view' },
    { prefix: '/deliberacoes', permission: 'deliberations.view' },
    { prefix: '/pautas', permission: 'deliberations.view' },
    { prefix: '/votacoes', permission: 'deliberations.view' },
    // Audit / history
    { prefix: '/historico', permission: 'audit.view' },
    // Roles management (top-level alias)
    { prefix: '/roles', permission: 'admin.manage_roles' },
    // Reports — aligned with sidebar visibility (RBAC audit R5)
    {
        prefix: '/relatorios',
        anyPermission: [
            'dashboard.export',
            'finance.export',
            'projects.export',
            'audit.export',
        ],
    },
    // Workflows — aligned with sidebar (admin tooling, not dashboard)
    { prefix: '/workflows', permission: 'admin.view' },
    // Authenticated-only (no permission required)
    { prefix: '/notificacoes', permission: null },
    { prefix: '/configuracoes', permission: null },
]

async function checkRoutePermission(
    supabase: ReturnType<typeof createServerClient>,
    matched: RoutePermission,
): Promise<boolean> {
    if (matched.anyPermission && matched.anyPermission.length > 0) {
        for (const key of matched.anyPermission) {
            const { data } = await supabase.rpc('current_user_has_permission', {
                permission_key: key,
            })
            if (data) return true
        }
        return false
    }
    if (matched.permission) {
        const { data } = await supabase.rpc('current_user_has_permission', {
            permission_key: matched.permission,
        })
        return Boolean(data)
    }
    return true
}

function isRoute(pathname: string, routes: string[]) {
    return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

function redirectWithCookies(request: NextRequest, response: NextResponse, pathname: string) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
    url.search = ''
    const redirectResponse = NextResponse.redirect(url)
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
    return redirectResponse
}

export async function updateSession(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet: CookieToSet[]) {
                    cookiesToSet.forEach(({ name, value }: CookieToSet) =>
                        request.cookies.set(name, value)
                    )
                    supabaseResponse = NextResponse.next({
                        request,
                    })
                    cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
                        supabaseResponse.cookies.set(name, value, options)
                    )
                },
            },
        }
    )

    // IMPORTANT: Avoid writing any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very hard to debug
    // issues with users being randomly logged out.

    const {
        data: { user },
    } = await supabase.auth.getUser()

    // Subdomínio do Portal de Ponto (ponto.insightapex.co): mapeia as rotas
    // raiz do host para as páginas /ponto — a URL do navegador fica limpa
    // (ponto.…/login) e todo o gating abaixo usa o pathname mapeado.
    const host = (request.headers.get('host') ?? '').toLowerCase()
    const isPontoHost = host === 'ponto.insightapex.co' || host.startsWith('ponto.')
    let pontoRewrite: string | null = null
    let pathname = request.nextUrl.pathname
    if (isPontoHost && !pathname.startsWith('/ponto') && !pathname.startsWith('/api')) {
        if (pathname === '/' || pathname === '') pontoRewrite = '/ponto'
        else if (pathname === '/login') pontoRewrite = '/ponto/login'
        else if (pathname === '/ativar') pontoRewrite = '/ponto/ativar'
        if (pontoRewrite) pathname = pontoRewrite
    }
    // Endpoints de job agendado autenticam por CRON_SECRET (Bearer), sem
    // sessão de usuário — o Vercel Cron não envia cookie. Nunca podem ser
    // redirecionados para /login; o próprio handler valida o segredo.
    if (pathname.startsWith('/api/ponto/cron') || pathname.startsWith('/api/ponto/retention')) {
        return supabaseResponse
    }

    const isPublicRoute = isRoute(pathname, PUBLIC_ROUTES) || isRoute(pathname, AUTH_UTILITY_ROUTES)
    const isSetupRoute = isRoute(pathname, PROFILE_SETUP_ROUTES)
    const isAccessRestricted = pathname === ACCESS_RESTRICTED_ROUTE

    if (!user && !isPublicRoute) {
        const url = request.nextUrl.clone()
        url.pathname = '/login'
        url.searchParams.set('next', pathname)
        const redirectResponse = NextResponse.redirect(url)
        supabaseResponse.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie))
        return redirectResponse
    }

    if (user && isRoute(pathname, PUBLIC_ROUTES)) {
        // Colaborador já autenticado no portal de ponto vai direto bater ponto
        const target = isPontoHost || pathname.startsWith('/ponto') ? '/ponto' : '/dashboard'
        return redirectWithCookies(request, supabaseResponse, target)
    }

    if (user && !isPublicRoute) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('id,organization_id,status')
            .eq('user_id', user.id)
            .maybeSingle()

        // Active-but-no-org → onboarding still wins
        if (!profile?.organization_id && !isSetupRoute) {
            return redirectWithCookies(request, supabaseResponse, '/onboarding')
        }

        // Inactive profile gate (BEFORE permission check, AFTER onboarding rule)
        if (
            profile &&
            profile.status !== 'active' &&
            !isAccessRestricted &&
            !isRoute(pathname, PUBLIC_ROUTES) &&
            !isRoute(pathname, AUTH_UTILITY_ROUTES)
        ) {
            return redirectWithCookies(request, supabaseResponse, ACCESS_RESTRICTED_ROUTE)
        }

        if (!isSetupRoute && !isAccessRestricted) {
            const matchedRoute = ROUTE_PERMISSIONS.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))
            if (matchedRoute && (matchedRoute.permission || matchedRoute.anyPermission)) {
                const allowed = await checkRoutePermission(supabase, matchedRoute)
                if (!allowed) {
                    return redirectWithCookies(request, supabaseResponse, ACCESS_RESTRICTED_ROUTE)
                }
            }
        }
    }

    // IMPORTANT: You *must* return the supabaseResponse object as it is. If you're
    // creating a new response object with NextResponse.next() make sure to:
    // 1. Pass the request in it, like so:
    //    const myNewResponse = NextResponse.next({ request })
    // 2. Copy over the cookies, like so:
    //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
    // 3. Change the myNewResponse object to fit your needs, but avoid changing
    //    the cookies!
    // 4. Finally:
    //    return myNewResponse
    if (pontoRewrite) {
        const rewriteResponse = NextResponse.rewrite(new URL(pontoRewrite, request.url), { request })
        supabaseResponse.cookies.getAll().forEach((cookie) => rewriteResponse.cookies.set(cookie))
        return rewriteResponse
    }
    return supabaseResponse
}
