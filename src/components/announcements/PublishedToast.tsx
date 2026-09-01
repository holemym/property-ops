'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

// Fires a one-off notice when /announcements is reached with ?published=empty —
// publishAnnouncementAction appends it when the publish succeeded but the resolved
// audience was EMPTY (a property with no active tenancies, or no invited residents
// yet), so the operator learns nobody was pinged without the publish failing.
// Self-contained param-read + strip-after-show, the ErrorToast pattern; neutral
// toast() (not error) because the publish itself worked, mirroring GeneratedToast's
// "nothing to bill" case.
export function PublishedToast() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const fired = useRef(false)

  const published = searchParams.get('published')

  useEffect(() => {
    if (published !== 'empty' || fired.current) return
    fired.current = true
    toast('Published — no residents currently match this audience.')

    const params = new URLSearchParams(searchParams.toString())
    params.delete('published')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [published, pathname, router, searchParams])

  return null
}
