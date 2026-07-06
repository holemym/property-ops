'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

// Server actions report failure by redirecting back with `?error=<message>` (see
// redirectWithError). This client component reads that param on mount, surfaces it as a
// sonner error toast, then strips it from the URL via a replace so a refresh doesn't
// re-fire the toast. Rendered once per page that hosts those actions; renders nothing.
export function ErrorToast() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const shown = useRef<string | null>(null)

  const error = searchParams.get('error')

  useEffect(() => {
    if (!error || shown.current === error) return
    shown.current = error
    toast.error(error)

    // Drop the error param but preserve any others (e.g. ?joblink=).
    const params = new URLSearchParams(searchParams.toString())
    params.delete('error')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [error, pathname, router, searchParams])

  return null
}
