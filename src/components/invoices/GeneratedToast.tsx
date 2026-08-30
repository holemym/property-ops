'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

// Fires a one-off result toast when /invoices is reached with ?generated=&skipped=
// (after generateRentInvoicesAction, P3-2). Mirrors SentToast's mount-effect pattern.
// `skipped` counts invoices NOT drafted because a (tenancy, month) pair was already
// billed — caught either by the planner's own pre-check or, for a concurrent click, by
// the DB's partial unique index (invoices_tenancy_period_unique, migration 0027).
// Tenancies skipped for having no rent on file are intentionally NOT folded into this
// count — the dialog copy never promised to bill them, so there is nothing to report.
export function GeneratedToast({ generated, skipped }: { generated: number; skipped: number }) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    if (generated > 0 && skipped > 0) {
      toast.success(
        `Drafted ${generated} rent invoice${generated === 1 ? '' : 's'} · ${skipped} already billed.`,
      )
    } else if (generated > 0) {
      toast.success(`Drafted ${generated} rent invoice${generated === 1 ? '' : 's'}.`)
    } else if (skipped > 0) {
      toast(
        `${skipped === 1 ? 'That invoice was' : `All ${skipped} invoices were`} already billed for this month.`,
      )
    } else {
      toast('No active tenancies with rent to bill for this month.')
    }
    // Strip the result params (ErrorToast's strip-after-show pattern) so a refresh
    // doesn't re-announce "Drafted N invoices" for work that already happened.
    const params = new URLSearchParams(searchParams.toString())
    params.delete('generated')
    params.delete('skipped')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [generated, skipped, pathname, router, searchParams])
  return null
}
