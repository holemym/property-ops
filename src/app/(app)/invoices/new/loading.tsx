import { Skeleton } from '@/components/ui/skeleton'

// Loading fallback for the new-invoice form. Header + a stack of field skeletons and a couple
// of line-item rows, so the shell doesn't reflow when the attribution lists finish loading.
export default function NewInvoiceLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex max-w-3xl flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-8 w-full rounded-lg" />
            </div>
          ))}
        </div>

        <Skeleton className="h-40 w-full rounded-lg" />

        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-lg" />
          ))}
        </div>

        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
    </div>
  )
}
