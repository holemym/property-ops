import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { statusBadge, type StatusBadgeInput } from "@/lib/status"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        // Semantic status tones — subtle bg-tint + readable text, dark-mode safe.
        // Saturated color is reserved for status; these mirror the tones in
        // src/lib/status.ts and are consumed via <StatusBadge>.
        neutral:
          "bg-muted text-foreground",
        muted:
          "bg-muted text-muted-foreground",
        blue:
          "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300",
        amber:
          "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300",
        green:
          "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
        red:
          "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

// StatusBadge — the ONLY sanctioned way to render a colored status pill. It resolves a
// domain value to { label, tone } via statusBadge() and renders a tone-tinted Badge. The
// `tone` names map 1:1 to badge variants (neutral/muted/blue/amber/green/red).
type StatusBadgeProps = StatusBadgeInput & { className?: string }

function StatusBadge({ className, ...input }: StatusBadgeProps) {
  // The runtime call is uniform; the statusBadge() overloads guarantee callers pass a
  // value matching their `kind`, so this cast is safe.
  const { label, tone } = statusBadge(
    input.kind as "vendor_is_active",
    input.value as boolean,
  )
  return (
    <Badge variant={tone} className={className}>
      {label}
    </Badge>
  )
}

export { Badge, badgeVariants, StatusBadge }
