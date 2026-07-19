import Link from 'next/link'
import { SearchX } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'

// Catches `notFound()` thrown by any page nested under (app) — tickets/[id],
// units/[id], people/[id], invoices/[id], portal/[id], owners/[name], etc. — and any
// unmatched sub-path under the app shell. Next.js resolves the nearest not-found.js
// ancestor, and this one sits inside the (app) layout's segment, so Sidebar/TopNav
// (rendered by (app)/layout.tsx, a sibling segment file that this boundary does NOT
// wrap) stay mounted; only the <main> content swaps to this UI. `/dashboard` is a safe
// universal target — it redirects tenant roles on to /portal itself.
export default function AppNotFound() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Not found"
        subtitle="The page or item you requested doesn't exist."
      />
      <EmptyState
        icon={<SearchX />}
        title="Nothing here"
        body="It may have been moved, deleted, or you may not have access to it."
        action={
          <Button render={<Link href="/dashboard" />} nativeButton={false}>
            Back to dashboard
          </Button>
        }
      />
    </div>
  )
}
