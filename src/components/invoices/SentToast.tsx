'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

// Fires a one-off success toast when the invoice detail is reached with ?sent=1 (after
// sendInvoiceAction). Client-only; no state, just a side effect on mount. `message` lets
// the D4 demo-simulation path ("Invoice sent — demo simulation") reuse the same toast
// plumbing with different copy instead of forking a second component.
export function SentToast({ message }: { message?: string }) {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    toast.success(message ?? 'Invoice sent.')
    // Strip ?sent= (ErrorToast's strip-after-show pattern) so a refresh doesn't
    // re-announce a send that already happened.
    const params = new URLSearchParams(searchParams.toString())
    params.delete('sent')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [message, pathname, router, searchParams])
  return null
}
