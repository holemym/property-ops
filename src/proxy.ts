import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

// /job/<token> is the vendor secure-link route (P3.8): vendors have NO session, so the
// proxy must NOT bounce them to /login. Adding /job here ONLY makes the route reachable
// without auth — it is NOT a security relaxation: the route still REQUIRES a valid
// capability token, which the page/actions validate (hash + expiry + not-revoked) via the
// service client. An invalid/expired/revoked token shows the generic "invalid" page.
const PUBLIC_PATHS = ['/login', '/signup', '/auth/callback', '/job']

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request)

  const path = request.nextUrl.pathname
  // Exact-or-subpath match, NOT a bare prefix: a public path `p` matches `p` itself or any
  // `p/...` subpath, but never a sibling that merely shares the prefix. A loose
  // `startsWith(p)` would make `/login-history` public via `/login`, or a future `/jobs*`
  // route public via `/job` — a latent footgun in the security-critical route gate. Closing
  // the whole class here, not just for `/job`.
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))

  if (!user && !isPublic) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Don't bounce a logged-in user off /login|/signup if they were sent there
  // deliberately with an error to display (e.g. a deactivated user whose JWT is
  // still valid but whose app access is revoked by requireUser). Otherwise they'd
  // ping-pong: requireUser -> /login -> proxy -> /dashboard -> requireUser -> /login...
  // Invariant: any authenticated user landing on /login with an ?error param got there
  // via requireUser's deactivation redirect (login-failure errors only happen for
  // logged-out users, whom the `user &&` guard already excludes); if a future flow sends
  // logged-in users to /login?error for another reason, revisit.
  const hasError = request.nextUrl.searchParams.has('error')
  if (user && !hasError && (path === '/login' || path === '/signup')) {
    const dashboardUrl = new URL('/dashboard', request.url)
    return NextResponse.redirect(dashboardUrl)
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
