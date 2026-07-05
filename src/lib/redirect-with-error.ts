import { redirect } from 'next/navigation'

// Single source of truth for the `?error=` redirect pattern used by server actions.
// (src/app/(auth)/auth/callback/route.ts is the one documented exception: Route
// Handlers build absolute-URL NextResponse redirects, so it inlines the same encoding.)
export function redirectWithError(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`)
}
