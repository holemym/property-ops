'use client'

import { useEffect } from 'react'
import { toast } from 'sonner'

// Fires a one-off success toast when the invoice detail is reached with ?sent=1 (after
// sendInvoiceAction). Client-only; no state, just a side effect on mount.
export function SentToast() {
  useEffect(() => {
    toast.success('Invoice sent.')
  }, [])
  return null
}
