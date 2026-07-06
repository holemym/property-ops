'use client'

import { useFormStatus } from 'react-dom'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

// A submit button wired to the enclosing <form>'s pending state via useFormStatus.
// While the server action runs it disables itself and swaps its label for a spinner +
// `pendingLabel`, so every mutation form gives immediate, reduced-motion-safe feedback.
// Drop-in for the plain <Button type="submit"> the ticket forms used before; it forwards
// variant/size/className so call sites keep their existing styling.
export function SubmitButton({
  children,
  pendingLabel,
  variant,
  size,
  className,
}: {
  children: React.ReactNode
  pendingLabel?: string
  variant?: React.ComponentProps<typeof Button>['variant']
  size?: React.ComponentProps<typeof Button>['size']
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
    >
      {pending ? (
        <>
          <Loader2 className="animate-spin" />
          {pendingLabel ?? 'Working'}
        </>
      ) : (
        children
      )}
    </Button>
  )
}
