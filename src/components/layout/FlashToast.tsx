'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'

// One app-wide confirmation for actions that END on a different screen (a redirect),
// where the landing page has no reason to know what just happened: ?flash=<key> shows
// the matching message once, then strips itself so a refresh doesn't repeat it. Keys are
// a fixed allow-list — the URL never carries display text, so a crafted link can't put
// arbitrary words in the app's mouth. Same strip-after-show pattern as GeneratedToast.
const MESSAGES: Record<string, string> = {
  'password-updated': 'Password updated.',
}

export function FlashToast() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const handled = useRef<string | null>(null)
  const key = searchParams.get('flash')

  useEffect(() => {
    if (!key || handled.current === key) return
    handled.current = key
    const message = MESSAGES[key]
    if (message) toast.success(message)
    const params = new URLSearchParams(searchParams.toString())
    params.delete('flash')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [key, pathname, router, searchParams])
  return null
}
