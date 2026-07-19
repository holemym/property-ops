'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'

// Catches thrown errors from any page nested under (app) — a bad query, a thrown
// permission check (requirePermission throws a plain Error on denial, per
// src/lib/auth/session.ts), etc. — and keeps the Sidebar/TopNav shell mounted (this
// boundary sits inside the (app) layout's segment; it does not wrap (app)/layout.tsx
// itself, only what layout.tsx renders as `children`). Must be a Client Component
// (Next.js error.tsx convention).
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to an error reporting service. `error` is a caught exception, not
    // user-entered data — safe to log, no PII.
    console.error(error)
  }, [error])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Something went wrong"
        subtitle="An unexpected error interrupted this page."
      />
      <EmptyState
        icon={<TriangleAlert />}
        title="This page hit a snag"
        body="Try again, or head back to the dashboard while we look into it."
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => reset()}>
              Try again
            </Button>
            <Button render={<Link href="/dashboard" />} nativeButton={false}>
              Back to dashboard
            </Button>
          </div>
        }
      />
    </div>
  )
}
