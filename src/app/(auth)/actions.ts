'use server'

import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { redirectWithError } from '@/lib/redirect-with-error'
import { AUTH_CALLBACK_URL } from '@/lib/urls'
import { isInviteOnly } from '@/lib/auth/signup-mode'
import { isGoogleAuthEnabled } from '@/lib/auth/providers'
import { signupSchema, passwordSchema } from '@/lib/validation/auth'
import { requireUser } from '@/lib/auth/session'
import { isTenantRole } from '@/lib/auth/permissions'
import { checkRateLimit, clientIp } from '@/lib/rate-limit'
import { friendlyAuthError } from '@/lib/auth/error-messages'
import { safeNext } from '@/lib/auth/callback'
import { needsMfaChallenge, mfaOutcomeIsCorroborated } from '@/lib/auth/mfa'
import { createServiceClient } from '@/lib/supabase/service'
import { logAuthEvent, resolveAuthContext, resolveWorkspaceId, clientUserAgent } from '@/lib/audit/log-auth-event'

// S2-2 note: only password-based sign-in is audited here (LOGIN_SUCCESS/
// LOGIN_FAILURE — the spec's literal event names). signInWithMagicLink/
// signInWithGoogle below only ever KICK OFF their flow from this action; the
// actual sign-in completes at /auth/callback (a Route Handler), which is out
// of this task's scope — requireUser()'s AAL gate is unaffected either way.

// The page someone was headed to when the gate sent them to sign in (proxy sets
// /login?next=…; the login forms carry it in a hidden field). Validated as a same-origin
// path; the dashboard default needs no param, so it is dropped from the URL.
function destination(formData: FormData): string {
  return safeNext(String(formData.get('next') ?? ''))
}
function loginPath(next: string): string {
  return next === '/dashboard' ? '/login' : `/login?next=${encodeURIComponent(next)}`
}

export async function signInWithPassword(formData: FormData) {
  const next = destination(formData)
  const h = await headers()
  const ip = clientIp(h)
  const userAgent = clientUserAgent(h)
  const allowed = await checkRateLimit(`login:${ip}`, 10, 5 * 60)
  if (!allowed) {
    redirectWithError(loginPath(next), 'Too many attempts. Try again in a few minutes.')
  }

  const email = String(formData.get('email') ?? '')
  const password = String(formData.get('password') ?? '')

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    // Best-effort audit write — see log-auth-event.ts's header for the
    // never-throw guarantee. Awaited for ordering only; a failure here can
    // never change the redirect below.
    await logAuthEvent(createServiceClient(), {
      eventType: 'LOGIN_FAILURE',
      email,
      ip,
      userAgent,
    })
    redirectWithError(loginPath(next), friendlyAuthError(error))
  }

  const workspaceId = await resolveWorkspaceId(supabase, data.user?.id)
  await logAuthEvent(createServiceClient(), {
    eventType: 'LOGIN_SUCCESS',
    userId: data.user?.id,
    email: data.user?.email,
    workspaceId,
    ip,
    userAgent,
  })

  // S2-1b: route straight to the AAL2 step-up when this account has a verified TOTP
  // factor (nextLevel === 'aal2' && currentLevel === 'aal1'). A user with no factor
  // always gets nextLevel === currentLevel from Supabase (see needsMfaChallenge's doc
  // comment), so this is unconditionally false for them and they fall through to
  // /dashboard exactly as before this change — requireUser()'s own gate is the backstop
  // either way (see session.ts) so a magic-link/Google sign-in that skips this action
  // still gets caught on first page load.
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
  if (aal && needsMfaChallenge(aal.currentLevel, aal.nextLevel)) {
    redirect('/auth/mfa')
  }

  redirect(next)
}

export async function signInWithMagicLink(formData: FormData) {
  const next = destination(formData)
  // Same abuse guard as password login/signup — every call here triggers a real email
  // send to an arbitrary address, so it was the one auth action with no app-level limit.
  const h = await headers()
  const ip = clientIp(h)
  const allowed = await checkRateLimit(`magic:${ip}`, 5, 15 * 60)
  if (!allowed) {
    redirectWithError(loginPath(next), 'Too many attempts. Try again in a few minutes.')
  }

  const email = String(formData.get('email') ?? '')
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // The link carries the destination too, so the email lands on the same page.
      emailRedirectTo:
        next === '/dashboard' ? AUTH_CALLBACK_URL : `${AUTH_CALLBACK_URL}?next=${encodeURIComponent(next)}`,
      // Supabase's default (true) CREATES a fresh account for an unknown email — which
      // silently bypassed invite-only mode's signup enforcement. Open mode keeps the
      // default: a magic-link signup there is just signup. Unknown emails in invite
      // mode get "Signups not allowed for otp" → friendlyAuthError's invite hint.
      shouldCreateUser: !isInviteOnly(),
    },
  })

  if (error) {
    redirectWithError(loginPath(next), friendlyAuthError(error))
  }
  redirect('/login?magicLinkSent=1')
}

export async function signInWithGoogle() {
  // Enforcement half of the NEXT_PUBLIC_AUTH_GOOGLE gate (the login page merely stops
  // rendering the button) — clicking a stale form on a disabled provider previously
  // surfaced Supabase's raw "provider is not enabled" as a generic error.
  if (!isGoogleAuthEnabled()) {
    redirectWithError('/login', 'Google sign-in is not available on this deployment.')
  }
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: AUTH_CALLBACK_URL },
  })

  if (error || !data.url) {
    redirectWithError('/login', error ? friendlyAuthError(error) : 'Something went wrong. Please try again.')
  }
  redirect(data.url)
}

export async function signOut() {
  const supabase = await createClient()
  // Resolve identity BEFORE signing out — resolveAuthContext reads the
  // still-live session via getClaims(); it never throws (see
  // log-auth-event.ts), so a resolution failure just yields an
  // identity-less SIGN_OUT row instead of blocking the sign-out below.
  const ctx = await resolveAuthContext(supabase)
  const h = await headers()
  await logAuthEvent(createServiceClient(), {
    eventType: 'SIGN_OUT',
    ...ctx,
    ip: clientIp(h),
    userAgent: clientUserAgent(h),
  })
  await supabase.auth.signOut()
  redirect('/login')
}

export async function signUpWithPassword(formData: FormData) {
  const h = await headers()
  const ip = clientIp(h)
  const userAgent = clientUserAgent(h)
  const allowed = await checkRateLimit(`signup:${ip}`, 5, 60 * 60)
  if (!allowed) {
    redirectWithError('/signup', 'Too many attempts. Try again in a few minutes.')
  }

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
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: AUTH_CALLBACK_URL,
    },
  })

  if (error) {
    redirectWithError('/signup', friendlyAuthError(error))
  }

  // A fresh signup's profile (created by handle_new_user) never has a
  // workspace yet — resolveWorkspaceId still does the lookup rather than
  // assuming null, since that's the safe/general primitive and the extra
  // query is negligible.
  const workspaceId = await resolveWorkspaceId(supabase, data.user?.id)
  await logAuthEvent(createServiceClient(), {
    eventType: 'SIGNUP_SUCCESS',
    userId: data.user?.id,
    email: data.user?.email ?? email,
    workspaceId,
    ip,
    userAgent,
  })

  // The confirm-email card lives on /signup (login/page.tsx doesn't render this
  // param) — redirecting to /login here left the brand-new user on a bare sign-in
  // form with no hint that a confirmation email was sent.
  redirect('/signup?confirmEmailSent=1')
}

// "Forgot password?" — sends Supabase's recovery email. The link signs the person in via
// /auth/callback and lands them on /auth/set-password?reason=reset. The confirmation
// screen reads the same whether or not the address is registered (Supabase itself does
// not error for unknown emails), so the form cannot be used to probe for accounts.
export async function requestPasswordReset(formData: FormData) {
  const h = await headers()
  const allowed = await checkRateLimit(`reset:${clientIp(h)}`, 5, 15 * 60)
  if (!allowed) {
    redirectWithError('/forgot-password', 'Too many attempts. Try again in a few minutes.')
  }

  const email = String(formData.get('email') ?? '').trim()
  if (!email.includes('@')) {
    redirectWithError('/forgot-password', 'Enter the email address you sign in with.')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${AUTH_CALLBACK_URL}?next=${encodeURIComponent('/auth/set-password?reason=reset')}`,
  })
  // Only infrastructure failures surface (the shared email budget, the rate limiter);
  // "no such user" is not an error here by design.
  if (error) {
    redirectWithError('/forgot-password', friendlyAuthError(error))
  }
  redirect('/forgot-password?sent=1')
}

// "Didn't get the confirmation email?" on the post-signup card. Supabase only resends
// for an UNCONFIRMED account; for anything else it silently does nothing, which keeps
// this from confirming whether an address is registered.
export async function resendConfirmation(formData: FormData) {
  const h = await headers()
  const allowed = await checkRateLimit(`resend:${clientIp(h)}`, 3, 15 * 60)
  if (!allowed) {
    redirectWithError('/signup?confirmEmailSent=1', 'Too many attempts. Try again in a few minutes.')
  }

  const email = String(formData.get('email') ?? '').trim()
  if (!email.includes('@')) {
    redirectWithError('/signup?confirmEmailSent=1', 'Enter the email address you signed up with.')
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: AUTH_CALLBACK_URL },
  })
  if (error) {
    redirectWithError('/signup?confirmEmailSent=1', friendlyAuthError(error))
  }
  redirect('/signup?confirmEmailSent=1&resent=1')
}

// The three reasons someone is on /auth/set-password; anything else reads as a plain
// "change password" visit. Carried through a hidden field so an error round-trip keeps
// the right heading.
const SET_PASSWORD_REASONS = new Set(['reset', 'invite'])

// Set/change the current user's password. Reached from an invite (reason=invite), a
// reset link (reason=reset), or the account menu / Security page (no reason).
// requireUser() is the only gate (no workspace needed).
export async function setPassword(formData: FormData) {
  const user = await requireUser()
  const rawReason = String(formData.get('reason') ?? '')
  const self = SET_PASSWORD_REASONS.has(rawReason)
    ? `/auth/set-password?reason=${rawReason}`
    : '/auth/set-password'

  const parsed = passwordSchema.safeParse(formData.get('password'))
  if (!parsed.success) {
    redirectWithError(self, parsed.error.issues[0].message)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password: parsed.data })
  if (error) {
    redirectWithError(self, friendlyAuthError(error))
  }

  const h = await headers()
  await logAuthEvent(createServiceClient(), {
    eventType: 'PASSWORD_CHANGE',
    userId: user.id,
    email: user.email,
    workspaceId: user.workspaceId,
    ip: clientIp(h),
    userAgent: clientUserAgent(h),
  })

  // Land each role on its own home (the dashboard would bounce a tenant anyway, and
  // drop the flash on the way) with a confirmation, instead of a silent redirect.
  redirect(`${isTenantRole(user.role) ? '/portal/home' : '/dashboard'}?flash=password-updated`)
}

// S2-2: reports the outcome of the AAL2 TOTP step-up challenge for the audit
// trail. Called from src/components/auth/MfaChallenge.tsx (a CLIENT
// component — the challenge/verify calls must run against the browser's own
// session, see that file's header) as a plain server-action RPC.
//
// SECURITY (this is a client-triggered write into the service-role-only
// `auth_events` log — it must not trust its caller):
//   1. AUTH GATE — refuse to write for a caller with no live session
//      (ctx.userId === null). Without this, an UNAUTHENTICATED caller could
//      hit this endpoint in a loop to flood workspace_id=NULL rows, which are
//      visible platform-wide to every SUPER_ADMIN.
//   2. ANTI-FORGERY — never trust the client's `success` boolean; corroborate
//      it against the session's OWN assurance level via
//      mfaOutcomeIsCorroborated (a local JWT read). Only a genuine mfa.verify()
//      can raise the session to aal2, so a password-only aal1 caller can't
//      forge an MFA_CHALLENGE_SUCCESS — the one signal an admin uses to confirm
//      2FA actually gated a login.
// Still deliberately does NOT call requireUser(): at FAILURE time the caller is
// AAL1-pending, and requireUser()'s enforceMfaChallenge() would bounce this
// action's own execution to /auth/mfa (the loop MfaChallengePage's header
// documents avoiding). It reads AAL directly instead, the same primitive that
// page uses. The ENTIRE body is wrapped in one extra try/catch on top of
// resolveAuthContext/logAuthEvent's own — audit logging must never surface a
// failure (including getClaims()/getAuthenticatorAssuranceLevel() itself) to
// the caller.
export async function logMfaChallengeOutcome(success: boolean): Promise<void> {
  try {
    const supabase = await createClient()
    const ctx = await resolveAuthContext(supabase)
    if (!ctx.userId) return
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
    if (!aal || !mfaOutcomeIsCorroborated(success, aal.currentLevel, aal.nextLevel)) return

    const h = await headers()
    await logAuthEvent(createServiceClient(), {
      eventType: success ? 'MFA_CHALLENGE_SUCCESS' : 'MFA_CHALLENGE_FAILURE',
      ...ctx,
      ip: clientIp(h),
      userAgent: clientUserAgent(h),
    })
  } catch (e) {
    console.error('[audit] logMfaChallengeOutcome threw', e)
  }
}
