import { cn } from "@/lib/utils"

// A placeholder block. Pass a className to size/shape it (h-4 w-32, etc.).
//
// The `skeleton` class (globals.css) paints the muted fill plus a slow left-to-right
// sheen, so a screenful of these reads as ONE surface loading rather than a grid of
// independently blinking boxes. Reduced motion is handled there too — the highlight is
// dropped and the block sits flat and still.
//
// aria-hidden by default: a skeleton is decorative scaffolding, and announcing a dozen
// of them tells a screen-reader user nothing. The *region* carries the announcement
// instead — see LoadingRegion in components/common/skeletons.tsx. Callers can still
// override by passing their own aria-hidden.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("skeleton rounded-md", className)}
      {...props}
    />
  )
}

export { Skeleton }
