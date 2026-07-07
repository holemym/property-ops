import { cn } from '@/lib/utils'

// Shared skeleton primitives for route-level loading.tsx files. Keeping them in one place
// means every loader reads the same, and a slow navigation shows a structural placeholder
// (not a blank pane) — the biggest perceived-performance win.

export function Skel({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded bg-muted', className)} />
}

// Page title + subtitle block — mirrors <PageHeader>.
export function PageHeaderSkeleton({ withAction }: { withAction?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skel className="h-7 w-48" />
        <Skel className="h-4 w-72 max-w-full" />
      </div>
      {withAction && <Skel className="h-9 w-28 rounded-md" />}
    </div>
  )
}

// A card-shaped block of the given height.
export function CardSkeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl border bg-muted/20', className)} />
}

// A table placeholder: a header strip over N rows.
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="h-10 animate-pulse bg-muted/40" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse border-t" />
      ))}
    </div>
  )
}

// A detail-hub placeholder: header, a metric strip, then two content cards.
export function HubSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton withAction />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <CardSkeleton key={i} className="h-20" />
        ))}
      </div>
      <CardSkeleton className="h-40" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CardSkeleton className="h-56" />
        <CardSkeleton className="h-56" />
      </div>
    </div>
  )
}

// A form placeholder: header then a stack of labelled field rows.
export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="flex max-w-2xl flex-col gap-4 rounded-xl border p-6">
        {Array.from({ length: fields }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skel className="h-3.5 w-24" />
            <Skel className="h-9 w-full rounded-md" />
          </div>
        ))}
        <Skel className="h-9 w-28 rounded-md" />
      </div>
    </div>
  )
}
