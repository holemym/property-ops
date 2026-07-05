import { createClient } from '@supabase/supabase-js'

// Service-role Supabase client — bypasses RLS and is the ONLY client that may call
// SECURITY DEFINER functions locked to service_role (e.g. log_ticket_event, revoked
// from `authenticated` in migration 0012) or the Auth Admin API (inviteUserByEmail).
//
// SECURITY: SUPABASE_SERVICE_ROLE_KEY is server-only (never NEXT_PUBLIC) and this module
// is imported ONLY by 'use server' action files, so the key is never shipped to the
// client bundle. Never import this from a Client Component or any browser-reachable path.
// Callers MUST authorize the request (requirePermission / token validation) BEFORE using
// this client, since it bypasses every row-level policy.
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
