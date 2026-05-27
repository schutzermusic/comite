
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isSafeInternalPath } from '@/utils/auth/safe-path'

export { isSafeInternalPath }

type CookieToSet = { name: string; value: string; options: CookieOptions }

const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password']
// Routes that must bypass *all* auth gating (including the
// "authenticated → /dashboard" redirect). Invite & OAuth callbacks land here
// before the client-side session has been established from the URL hash, so
// they must never be redirected — neither to /login nor to /dashboard.
const AUTH_UTILITY_ROUTES = ['/auth', '/welcome', '/access-restricted']
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
    // People / org
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

    const pathname = request.nextUrl.pathname
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
        return redirectWithCookies(request, supabaseResponse, '/dashboard')
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
    return supabaseResponse
}
