'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

// createTenancyAction / updateTenancyAction redirect back to their host page with
// `?tenancy=created|updated` on success — this surfaces that as a sonner success toast,
// then strips the param via a replace so a refresh doesn't re-announce it (ErrorToast's
// read-and-strip shape; GeneratedToast on /invoices is the same family). Rendered on
// every page that hosts the tenancy dialogs (/occupancy + unit hubs); renders nothing.
export function TenancySavedToast() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const shown = useRef<string | null>(null)

  const result = searchParams.get('tenancy')

  useEffect(() => {
    if (!result || shown.current === result) return
    shown.current = result
    if (result === 'created') toast.success('Tenancy recorded.')
    else if (result === 'updated') toast.success('Tenancy updated.')
    // Unknown values toast nothing but are still stripped below.

    const params = new URLSearchParams(searchParams.toString())
    params.delete('tenancy')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [result, pathname, router, searchParams])

  return null
}
