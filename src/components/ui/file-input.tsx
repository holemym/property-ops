'use client'

import * as React from 'react'
import { Paperclip } from 'lucide-react'
import { cn } from '@/lib/utils'

// A styled file-upload control replacing the OS-default <input type=file>. The native
// input is visually hidden but kept in the form (same `name`), so server actions receive
// the file exactly as before — this is presentation only. A label styled as an outline
// button triggers the picker; the chosen filename (or a placeholder) shows beside it.
// Reduced-motion-safe: no motion beyond the shared button transition.
function FileInput({
  className,
  placeholder = 'No file chosen',
  buttonLabel = 'Choose file',
  onChange,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & {
  placeholder?: string
  buttonLabel?: string
}) {
  const [fileName, setFileName] = React.useState<string | null>(null)

  return (
    <label
      data-slot="file-input"
      className={cn(
        'group inline-flex h-8 w-fit max-w-full cursor-pointer items-stretch overflow-hidden rounded-lg border border-input bg-background text-sm transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40 dark:bg-input/30',
        className
      )}
    >
      <span className="inline-flex items-center gap-1.5 border-r border-input px-2.5 font-medium text-foreground">
        <Paperclip className="size-3.5 text-muted-foreground" />
        {buttonLabel}
      </span>
      <span
        className={cn(
          'inline-flex min-w-0 items-center truncate px-2.5',
          fileName ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        {fileName ?? placeholder}
      </span>
      <input
        type="file"
        className="sr-only"
        onChange={(e) => {
          setFileName(e.target.files?.[0]?.name ?? null)
          onChange?.(e)
        }}
        {...props}
      />
    </label>
  )
}

export { FileInput }
