import { NextResponse } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { safeNext, failureTarget, linkErrorMessage } from '@/lib/auth/callback'

// Every email link lands here: signup confirmation, magic link, invite, password reset.
// Route Handlers must build absolute-URL NextResponse redirects, so this inlines the
// `?error=` encoding rather than importing the redirect()-based helper.
//
// Three shapes arrive:
//   1. ?code=…            PKCE (Supabase's default templates under @supabase/ssr)
//   2. ?token_hash=&type= the template-based verifyOtp flow — supported so the email
//                         templates can be switched to it later (it survives opening the
//                         link in a different browser, which PKCE does not)
//   3. ?error=&error_code= Supabase already rejected the link (expired / used)
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const next = safeNext(searchParams.get('next'))

  const fail = (message: string) =>
    NextResponse.redirect(`${origin}${failureTarget(next)}?error=${encodeURIComponent(message)}`)

  if (searchParams.get('error_code') || searchParams.get('error')) {
    return fail(linkErrorMessage(searchParams.get('error_code'), searchParams.get('error_description')))
  }

  const supabase = await createClient()

  const code = searchParams.get('code')
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
    return fail(linkErrorMessage(error.code, error.message))
  }

  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (!error) return NextResponse.redirect(`${origin}${next}`)
    return fail(linkErrorMessage(error.code, error.message))
  }

  return fail('That link is incomplete. Request a new one.')
}
