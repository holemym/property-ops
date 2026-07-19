'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { Building2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Global error boundary. Error boundaries must be Client Components (Next.js file
// convention). This only catches errors thrown below the root layout in segments that
// don't already have their own `error.tsx` — `(app)/error.tsx` catches everything inside
// the authenticated shell first and keeps the sidebar/TopNav, so this is the outermost
// fallback for unauthenticated routes (login/signup) or a root-layout-level failure.
// Root layout.tsx itself keeps rendering (html/body/fonts) since a segment's error.tsx
// never wraps the layout.tsx it's a sibling of.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service. No PII in `error` here — it's a
    // caught exception object, not user-entered data.
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10 text-center">
      <div className="flex items-center gap-2 text-foreground">
        <Building2 className="size-5" aria-hidden />
        <span className="font-heading text-base font-medium tracking-tight">Property Ops</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <TriangleAlert className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold text-foreground">Something went wrong</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          An unexpected error interrupted this page. You can try again, or head back to
          the dashboard.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={() => reset()}>
          Try again
        </Button>
        <Button render={<Link href="/" />} nativeButton={false}>
          Back to dashboard
        </Button>
      </div>
    </main>
  )
}
