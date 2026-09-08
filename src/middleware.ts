
import { NextResponse, type NextRequest } from 'next/server'
import { getCanonicalRedirectUrl } from '@/lib/config/app-url'
import { updateSession } from '@/utils/supabase/middleware'

export async function middleware(request: NextRequest) {
    // Canonicalize before reading/refreshing auth cookies. Path and query string
    // are retained by getCanonicalRedirectUrl; the 308 also preserves the HTTP
    // method for any legacy API request.
    const publicUrl = request.nextUrl.clone()
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
    const requestHost = forwardedHost || request.headers.get('host')?.trim()
    if (requestHost) {
        // Strip only a numeric port. Unknown hosts are never reflected into a
        // redirect because getCanonicalRedirectUrl accepts a fixed allow-list.
        publicUrl.hostname = requestHost.replace(/:\d+$/, '')
    }
    const canonicalUrl = getCanonicalRedirectUrl(publicUrl)
    if (canonicalUrl) return NextResponse.redirect(canonicalUrl, 308)

    return await updateSession(request)
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Feel free to modify this pattern to include more paths.
         */
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
