import { cn } from '@/lib/utils'

// A consistent inline error banner for the server-action `?error=` redirect pattern. Renders
// nothing when there's no message, so callers can drop it in unconditionally. Dark-mode aware
// (the ad-hoc red-50/red-700 spans it replaces had no dark treatment) and announced to screen
// readers via role="alert". `className` is for the odd caller that needs its own margin.
export function FormError({
  message,
  className,
}: {
  message?: string | null
  className?: string
}) {
  if (!message) return null
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400',
        className,
      )}
    >
      {message}
    </p>
  )
}
