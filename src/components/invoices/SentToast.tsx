'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

// Fires a one-off success toast when the invoice detail is reached with ?sent=1 (after
// sendInvoiceAction). Client-only; no state, just a side effect on mount. `message` lets
// the D4 demo-simulation path ("Invoice sent — demo simulation") reuse the same toast
// plumbing with different copy instead of forking a second component.
export function SentToast({ message }: { message?: string }) {
  useEffect(() => {
    toast.success(message ?? 'Invoice sent.')
  }, [message])
  return null
}
