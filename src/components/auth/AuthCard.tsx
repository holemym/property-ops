import { AlertCircle } from 'lucide-react'

import { cn } from '@/lib/utils'

export function AuthCard({
  title,
  description,
  error,
  children,
}: {
  title: string
  description?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'w-full max-w-[380px] rounded-xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10',
        'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-[--duration-slow]',
      )}
    >
      <div className="mb-5 flex flex-col gap-1">
        <h1 className="font-heading text-lg font-medium leading-snug">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {children}
    </div>
  )
}
