import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'

  if (code) {
    const supabase = await createClient()
    // A single exchangeCodeForSession call correctly handles OAuth, magic-link, and
    // email-confirmation redirects — all three use the PKCE `?code=` flow under
    // @supabase/ssr, not the separate token_hash/verifyOtp path used for typed-in OTP codes.
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`)
  }

  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('No authorization code was provided.')}`)
}
