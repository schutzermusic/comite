
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

type CookieToSet = { name: string; value: string; options: CookieOptions }

const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password']
const AUTH_UTILITY_ROUTES = ['/auth']
const PROFILE_SETUP_ROUTES = ['/onboarding']

const ROUTE_PERMISSIONS: Array<{ prefix: string; permission: string }> = [
    { prefix: '/admin/users', permission: 'admin.manage_users' },
    { prefix: '/admin/roles', permission: 'admin.manage_roles' },
    { prefix: '/admin/audit', permission: 'audit.view' },
    { prefix: '/financeiro', permission: 'finance.view' },
    { prefix: '/contratos', permission: 'contracts.view' },
    { prefix: '/projetos', permission: 'projects.view' },
    { prefix: '/projects', permission: 'projects.view' },
    { prefix: '/riscos', permission: 'risks.view' },
    { prefix: '/workforce-cost', permission: 'people.view' },
    { prefix: '/pessoas', permission: 'people.view' },
    { prefix: '/organograma', permission: 'org_chart.view' },
    { prefix: '/reunioes', permission: 'meetings.view' },
    { prefix: '/atas', permission: 'minutes.view' },
    { prefix: '/comites', permission: 'committees.view' },
]

function isRoute(pathname: string, routes: string[]) {
    return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`))
}

function redirectWithCookies(request: NextRequest, response: NextResponse, pathname: string) {
    const url = request.nextUrl.clone()
    url.pathname = pathname
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

    if (user && !isSetupRoute && !isPublicRoute) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('id,organization_id,status')
            .eq('user_id', user.id)
            .maybeSingle()

        if (!profile?.organization_id) {
            return redirectWithCookies(request, supabaseResponse, '/onboarding')
        }

        const matchedRoute = ROUTE_PERMISSIONS.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))
        if (matchedRoute && pathname !== '/access-restricted') {
            const { data: allowed } = await supabase.rpc('current_user_has_permission', {
                permission_key: matchedRoute.permission,
            })

            if (!allowed) {
                return redirectWithCookies(request, supabaseResponse, '/access-restricted')
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
