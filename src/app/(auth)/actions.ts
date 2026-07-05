'use server'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { redirectWithError } from '@/lib/redirect-with-error'
import { AUTH_CALLBACK_URL } from '@/lib/urls'

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

export async function signUpWithPassword(formData: FormData) {
  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')
  const fullName = String(formData.get('fullName') ?? '')

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
