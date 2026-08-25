import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'

// Shared skeleton primitives for route-level loading.tsx files. Keeping them in one
// place means every loader reads the same, and a slow navigation shows a structural
// placeholder (not a blank pane) — the biggest perceived-performance win.
//
// TWO LAYERS, deliberately:
//   • CONTENT (text lines, chips, values) shimmers — it's the stuff that's arriving.
//   • STRUCTURE (card borders, table chrome) sits still — it's already correct and
//     will not change when data lands.
// Animating both makes the whole page strobe; animating only the content reads as one
// calm surface filling in. Motion is handled centrally by the `.skeleton` class
// (globals.css), including the reduced-motion fallback.

// A shimmering content block. Thin alias over the shared <Skeleton> primitive so there
// is ONE implementation of "placeholder block" in the codebase, not two that drift.
export function Skel({ className }: { className?: string }) {
  return <Skeleton className={cn('rounded', className)} />
}

/**
 * Announces a loading route to assistive tech.
 *
 * Every block inside a skeleton is aria-hidden (decorative — see <Skeleton>), so
 * without this a screen-reader user hears nothing at all during a navigation: the old
 * page is gone and the new one is silent. `role="status"` (an implicit polite live
 * region) plus a visually-hidden label announces it once, and `aria-busy` marks the
 * region as still-settling. Sighted users see only the skeleton.
 */
export function LoadingRegion({
  label = 'Loading…',
  className,
  children,
}: {
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-busy="true" className={cn('flex flex-col gap-6', className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
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

// A card-shaped surface. STRUCTURE — still, not shimmering (see the note above): the
// border is already the final layout, only what goes inside it is pending.
export function CardSkeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('rounded-xl border bg-muted/20', className)} />
}

// A table placeholder: still chrome (border + header strip) over shimmering row lines.
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden className="overflow-hidden rounded-lg border">
      <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-2.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skel key={i} className="h-3.5 w-20" />
        ))}
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skel className="h-4 w-44" />
            <Skel className="h-4 w-28" />
            <Skel className="h-4 w-24" />
            <Skel className="h-5 w-16 rounded-4xl" />
          </div>
        ))}
      </div>
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
          <div key={i} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
            <Skel className="h-7 w-12" />
            <Skel className="h-3 w-16" />
          </div>
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
