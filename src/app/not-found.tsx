import Link from 'next/link'
import { Building2, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Global 404 — catches any URL that matches no route at all (a typo'd path, a stale
// bookmark from before a rename, etc.) for visitors who haven't reached the authenticated
// app shell yet, so it renders standalone rather than borrowing the app shell it can't
// assume exists. Route-level `notFound()` calls made from inside an authenticated page
// (tickets/[id], units/[id], etc.) are caught first by `(app)/not-found.tsx`, which keeps
// the sidebar/TopNav — this file is the outermost fallback. Mirrors the (auth) layout's
// centered brand-mark treatment (src/app/(auth)/layout.tsx) since neither shell applies here.
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 py-10 text-center">
      <div className="flex items-center gap-2 text-foreground">
        <Building2 className="size-5" aria-hidden />
        <span className="font-heading text-base font-medium tracking-tight">Property Ops</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <SearchX className="size-8 text-muted-foreground" aria-hidden />
        <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist, or may have moved.
        </p>
      </div>
      <Button render={<Link href="/" />} nativeButton={false}>
        Back to dashboard
      </Button>
    </main>
  )
}
