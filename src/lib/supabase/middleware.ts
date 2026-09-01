import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // PERF-1b (the middleware half of session.ts's PERF-1a): getClaims() verifies the
  // access token locally against the project's JWKS instead of the per-request
  // /auth/v1/user network round-trip getUser() paid on EVERY navigation, RSC fetch,
  // and action POST — the single largest fixed per-request tax in the app. Token
  // refresh still works: getClaims() reads the session via getSession(), which
  // auto-refreshes an expired token and writes the new cookies through the setAll
  // hook above. On the legacy shared JWT secret, supabase-js falls back to a server
  // check internally, so this is also CORRECT (never weaker) before the project is
  // flipped to asymmetric signing keys — the flip (Supabase dashboard) is what makes
  // it zero-network. proxy.ts only gates on "is there a session", so the truthy
  // claims marker preserves its behavior exactly; per-request revocation freshness
  // was already delegated to the app layer (requireUser's is_active check + RLS).
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims ?? null

  return { response, user: claims ? { id: claims.sub } : null }
}
