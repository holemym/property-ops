export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="h-4 w-20 animate-pulse rounded bg-muted" />
      <div className="flex flex-col gap-2">
        <div className="h-7 w-48 animate-pulse rounded bg-muted" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl border bg-muted/30" />
        ))}
      </div>
      <div className="h-40 animate-pulse rounded-lg border bg-muted/20" />
    </div>
  )
}
