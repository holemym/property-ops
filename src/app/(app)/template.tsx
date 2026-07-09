// A template (unlike a layout) re-mounts on every navigation, so this fade replays each
// time the page content changes — a subtle, consistent transition across the whole app.
// Uses the `--duration-fast` token so it reads as responsive, not sluggish.
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-[--duration-fast]">
      {children}
    </div>
  )
}
