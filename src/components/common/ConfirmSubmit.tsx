'use client'

import { useRef, useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type ButtonProps = React.ComponentProps<typeof Button>

// A submit button that asks for confirmation before firing a server action — for
// genuinely destructive / hard-to-undo actions (archive, deactivate). It owns the <form>
// so callers pass the action plus any hidden inputs as `children`; the trigger opens a
// dialog and only the Confirm button actually submits.
//
// The dialog content is portaled outside the <form>, so we submit via a ref
// (requestSubmit fires the action AND native validation) rather than a nested submit
// button. The action revalidates/navigates on success, so closing the dialog is cosmetic.
export function ConfirmSubmit({
  action,
  triggerLabel,
  triggerVariant = 'outline',
  triggerSize,
  title,
  description,
  confirmLabel,
  confirmVariant = 'destructive',
  children,
}: {
  action: (formData: FormData) => void | Promise<void>
  triggerLabel: ReactNode
  triggerVariant?: ButtonProps['variant']
  triggerSize?: ButtonProps['size']
  title: string
  description?: string
  confirmLabel: string
  confirmVariant?: ButtonProps['variant']
  /** Hidden inputs the action reads (e.g. userId / isActive). */
  children?: ReactNode
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [open, setOpen] = useState(false)

  function handleConfirm() {
    setOpen(false)
    formRef.current?.requestSubmit()
  }

  return (
    <form ref={formRef} action={action}>
      {children}
      <Button
        type="button"
        variant={triggerVariant}
        size={triggerSize}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant={confirmVariant} onClick={handleConfirm}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  )
}
