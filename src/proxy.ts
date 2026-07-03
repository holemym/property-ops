import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/signup', '/auth/callback']

export async function proxy(request: NextRequest) {
  const { response, user } = await updateSession(request)

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PATHS.some((p) => path.startsWith(p))

  if (!user && !isPublic) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  // Don't bounce a logged-in user off /login|/signup if they were sent there
  // deliberately with an error to display (e.g. a deactivated user whose JWT is
  // still valid but whose app access is revoked by requireUser). Otherwise they'd
  // ping-pong: requireUser -> /login -> proxy -> /dashboard -> requireUser -> /login...
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
