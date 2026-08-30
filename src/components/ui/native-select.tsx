import { cn } from '@/lib/utils'

// THE styled native <select> class. The app deliberately uses native selects
// (auto-apply filters, dialog pickers) rather than a composed listbox; this
// class was previously copy-pasted per file and had drifted — border-border vs
// border-input, bg-background vs bg-transparent, and one copy with NO
// focus-visible ring at all (a real keyboard-a11y gap). One string, one look,
// ring included.
export const selectClassName =
  'h-8 w-full rounded-lg border border-border bg-background px-2.5 text-sm text-foreground ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

// Thin component form for call sites that don't need to splice extra classes.
export function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(selectClassName, className)} {...props} />
}
