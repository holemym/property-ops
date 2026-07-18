'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ShieldAlert, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Soft-enforcement nag (S2-1 spec §4). The caller (dashboard/page.tsx) decides
// server-side whether to render this at all — role in ('OWNER','SUPER_ADMIN') AND no
// verified MFA factor, via mfa.listFactors() on the user's server client — this
// component only owns the dismiss interaction. "Dismissible (per-render, no
// persistence)" per spec: local useState, no localStorage/cookie — it reappears on the
// next full page load by design (a soft nag, not a one-time toast). Styled to match
// FormError's red-50/red-700 tone (spec: "FormError-toned"), not the FormError
// component itself, since this needs a CTA link + dismiss button FormError doesn't
// support.
export function DashboardMfaNag() {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div
      role="alert"
      className={cn(
        'mb-4 flex items-start justify-between gap-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700',
        'dark:bg-red-500/10 dark:text-red-400',
      )}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          Protect this workspace — enable two-factor authentication.{' '}
          <Link href="/settings/security" className="font-medium underline underline-offset-2">
            Set up
          </Link>
        </span>
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 rounded-sm p-0.5 text-red-700/70 transition-colors hover:text-red-700 dark:text-red-400/70 dark:hover:text-red-400"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
