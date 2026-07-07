// ---------------------------------------------------------------------------
// Email sending — the provider transport (Phase 4).
//
// "DISCONNECTED BY DEFAULT." This module NEVER makes a network call unless a
// RESEND_API_KEY is present in the environment. With no key set (the current,
// shipping state), sendEmail() is a no-op that logs what it *would* have sent to
// the console — zero network calls, zero cost. It only reaches the Resend REST
// API when the key is configured. This mirrors the AI-triage module's
// "gated on an env key, best-effort, never throws" pattern (see
// src/lib/ai/triage.ts).
//
// HOW TO CONNECT:
//   1. Set RESEND_API_KEY   — your Resend API key (server-only; never NEXT_PUBLIC).
//   2. Set EMAIL_FROM       — the verified sender, e.g. "Property Ops <ops@yourdomain.com>".
//                             Defaults to Resend's shared onboarding sender if unset.
// No SDK is installed: we POST directly to https://api.resend.com/emails, keeping
// the app dependency-free. Resend is a separate, pay-per-send bill (its own account
// at resend.com), independent of Supabase or any Claude subscription; until a key
// is added, it is never billed.
// ---------------------------------------------------------------------------

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Property Ops <onboarding@resend.dev>'

export type SendEmailInput = {
  to: string | string[]
  subject: string
  html: string
  text?: string
}

export type SendEmailResult = {
  // true = a real send was attempted AND accepted by Resend.
  // false = disconnected no-op, skipped, or a send failure (never throws).
  sent: boolean
  // 'disconnected' when no key is set; 'sent' on success; 'error' on a caught failure.
  status: 'disconnected' | 'sent' | 'error'
  // The Resend message id on success, when returned.
  id?: string
  // Human-readable reason on skip/failure (never a thrown exception).
  error?: string
}

/** True only when a real API key is configured — the single "is it connected?" switch. */
export function isEmailEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

/**
 * Best-effort email send. NEVER throws — on any failure (missing recipient,
 * network error, non-2xx from Resend) it logs and returns a result with
 * `sent: false`, so an email hiccup can never fail the user action that triggered it.
 *
 * Disconnected default: with no RESEND_API_KEY, this logs
 * `[email] (disconnected) would send: <subject> → <to>` and returns immediately
 * without touching the network.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, html, text } = input
  const recipients = Array.isArray(to) ? to : [to]

  // Guard: an empty/blank recipient is a caller bug or an unresolved email — skip
  // quietly rather than send Resend a malformed request.
  const cleaned = recipients.map((r) => (r ?? '').trim()).filter(Boolean)
  if (cleaned.length === 0) {
    console.info('[email] skipped — no recipient for:', subject)
    return { sent: false, status: 'error', error: 'no recipient' }
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // DISCONNECTED: log the intent, make no network call, incur no cost.
    console.info('[email] (disconnected) would send:', subject, '→', cleaned.join(', '))
    return { sent: false, status: 'disconnected' }
  }

  const from = process.env.EMAIL_FROM ?? DEFAULT_FROM

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: cleaned,
        subject,
        html,
        // Resend accepts an optional plain-text alternative.
        ...(text ? { text } : {}),
      }),
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error('[email] Resend responded', res.status, detail)
      return { sent: false, status: 'error', error: `resend ${res.status}` }
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string }
    return { sent: true, status: 'sent', id: data.id }
  } catch (e) {
    // Network error / DNS / abort — swallow so the caller's action never fails.
    console.error('[email] send failed for:', subject, e)
    return { sent: false, status: 'error', error: e instanceof Error ? e.message : 'send failed' }
  }
}
