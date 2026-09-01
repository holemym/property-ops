// Provider-button gating for the login page. The app cannot introspect which OAuth
// providers are actually enabled in the Supabase project, and rendering a button for a
// disabled one is a guaranteed dead end (confirmed live: "Continue with Google" was
// showing while the project's Google provider was off — every click errored). So the
// button is env-gated: set NEXT_PUBLIC_AUTH_GOOGLE=1 (Vercel env + .env.local) only
// AFTER enabling the Google provider in Supabase Auth → Providers with a real Google
// OAuth client. signInWithGoogle enforces the same flag server-side — the page merely
// stops offering the form (same split as SIGNUP_MODE's invite gate).
export function isGoogleAuthEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AUTH_GOOGLE === '1'
}
