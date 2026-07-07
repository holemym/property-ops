import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

// Loading fallback for the finance overview. Mirrors the real layout — header, a
// four-metric strip, a wide month chart, and two entry tables — so the shell doesn't
// reflow when data arrives.
export default function FinanceLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-80" />
      </div>

      {/* Metric strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} size="sm">
            <CardContent className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Month chart */}
      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-48 w-full rounded-md" />
        </CardContent>
      </Card>

      {/* Entry tables */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {Array.from({ length: 5 }).map((_, r) => (
                <div key={r} className="flex justify-between">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-16" />
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
