'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { redirectWithError } from '@/lib/redirect-with-error'
import { AUTH_CALLBACK_URL } from '@/lib/urls'
import { isInviteOnly } from '@/lib/auth/signup-mode'
import { signupSchema, passwordSchema } from '@/lib/validation/auth'
import { requireUser } from '@/lib/auth/session'

export async function signInWithPassword(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    redirectWithError('/login', error.message)
  }
  redirect('/dashboard')
}

export async function signInWithMagicLink(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: AUTH_CALLBACK_URL },
  })

  if (error) {
    redirectWithError('/login', error.message)
  }
  redirect('/login?magicLinkSent=1')
}

export async function signInWithGoogle() {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: AUTH_CALLBACK_URL },
  })

  if (error || !data.url) {
    redirectWithError('/login', error?.message ?? 'oauth_failed')
  }
  redirect(data.url)
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

export async function signUpWithPassword(formData: FormData) {
  // Invite-only deployments reject self-signup here — the server action is the
  // enforcement boundary; the signup page merely stops offering the form.
  if (isInviteOnly()) {
    redirectWithError(
      '/signup',
      'Sign-ups are by invitation. Ask your administrator for an invite.'
    )
  }

  const parsed = signupSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    password: formData.get('password'),
  })
  if (!parsed.success) {
    redirectWithError('/signup', parsed.error.issues[0].message)
  }
  const { email, password, fullName } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: AUTH_CALLBACK_URL,
    },
  })

  if (error) {
    redirectWithError('/signup', error.message)
  }
  redirect('/login?confirmEmailSent=1')
}

// Set/change the current user's password. Used both by freshly-invited users (who
// arrive via the magic-link callback with no password yet — see the `next` param on
// inviteUserByEmail's redirectTo in settings/users/actions.ts) and by any authenticated
// user wanting to change theirs; requireUser() is the only gate (no workspace needed).
export async function setPassword(formData: FormData) {
  await requireUser()

  const parsed = passwordSchema.safeParse(formData.get('password'))
  if (!parsed.success) {
    redirectWithError('/auth/set-password', parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) {
    redirectWithError('/auth/set-password', error.message)
  }
  redirect('/dashboard')
}
