export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="h-7 w-32 animate-pulse rounded bg-muted" />
        <div className="h-4 w-80 animate-pulse rounded bg-muted" />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="h-10 animate-pulse bg-muted/40" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 border-t animate-pulse" />
        ))}
      </div>
    </div>
  )
}
