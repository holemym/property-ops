import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { safeNext } from '@/lib/auth/callback'

// /job/<token> is the vendor secure-link route (P3.8): vendors have NO session, so the
// proxy must NOT bounce them to /login. Adding /job here ONLY makes the route reachable
// without auth — it is NOT a security relaxation: the route still REQUIRES a valid
// capability token, which the page/actions validate (hash + expiry + not-revoked) via the
// service client. An invalid/expired/revoked token shows the generic "invalid" page.
const PUBLIC_PATHS = ['/login', '/signup', '/forgot-password', '/auth/callback', '/job']

// Email-link params Supabase may append. When an email link's redirect URL is not on the
// project's allow-list, Supabase falls back to the SITE URL (the root) and appends these
// there; the session-less root then bounced to /login and silently DROPPED the code —
// "clicked the link, back at sign-in, nothing happened" (reported 2026-09-02). They're
// forwarded to the callback instead, so a config gap degrades to "lands on the
// dashboard" rather than to a dead end.
const LINK_PARAMS = ['code', 'token_hash', 'error_code']
const LINK_LANDING_PATHS = new Set(['/', '/login', '/dashboard'])

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const params = request.nextUrl.searchParams
  if (LINK_LANDING_PATHS.has(path) && LINK_PARAMS.some((p) => params.has(p))) {
    const callback = new URL('/auth/callback', request.url)
    params.forEach((value, key) => callback.searchParams.set(key, value))
    return NextResponse.redirect(callback)
  }

  const { response, user } = await updateSession(request)
  // Exact-or-subpath match, NOT a bare prefix: a public path `p` matches `p` itself or any
  // `p/...` subpath, but never a sibling that merely shares the prefix. A loose
  // `startsWith(p)` would make `/login-history` public via `/login`, or a future `/jobs*`
  // route public via `/job` — a latent footgun in the security-critical route gate. Closing
  // the whole class here, not just for `/job`.
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + '/'))

  if (!user && !isPublic) {
    const loginUrl = new URL('/login', request.url)
    // Remember where they were headed (a ticket link from a notification email, a
    // bookmarked invoice) so sign-in lands them there instead of on the dashboard.
    // Bare roots carry no information, so they keep the URL clean.
    if (path !== '/' && path !== '/dashboard') {
      loginUrl.searchParams.set('next', path + request.nextUrl.search)
    }
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
    return NextResponse.redirect(new URL(safeNext(params.get('next')), request.url))
  }

  return response
}

export const config = {
  // maplibre-gl-csp-worker.js: the map's worker script (public/, copied by
  // scripts/copy-maplibre-worker.mjs) — a hot static asset with no reason to pay the
  // per-request auth check. _vercel/: the platform's analytics scripts, which must
  // never be bounced to /login.
  matcher: ['/((?!_next/static|_next/image|_vercel/|favicon.ico|maplibre-gl-csp-worker\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
