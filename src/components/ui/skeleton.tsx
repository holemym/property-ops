import { cn } from "@/lib/utils"

// A pulsing placeholder block. Pass a className to size/shape it (h-4 w-32, etc.).
// The pulse is neutralized under prefers-reduced-motion by the global guard in
// globals.css, so no extra motion handling is needed here.
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
