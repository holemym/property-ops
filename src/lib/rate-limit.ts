import { createServiceClient } from '@/lib/supabase/service'

// App-side wrapper around the check_rate_limit() SECURITY DEFINER RPC (migration 0022).
// Fail-OPEN: any error calling the RPC (network hiccup, migration not yet applied,
// service outage) returns `true` (allow) rather than locking the org out — a limiter
// outage must never become an outage of the app itself. Errors are logged so a
// persistent failure is still visible in Vercel logs.
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number
): Promise<boolean> {
  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_key: key,
      p_max: max,
      p_window_seconds: windowSeconds,
    })
    if (error) {
      console.error('checkRateLimit RPC error (failing open):', error.message)
      return true
    }
    return data === true
  } catch (err) {
    console.error('checkRateLimit threw (failing open):', err)
    return true
  }
}

// First hop of X-Forwarded-For (the client's real IP, as set by Vercel's edge), or
// 'unknown' when absent (e.g. local dev) — used to key IP-scoped buckets like
// login/signup/job-token. A shared NAT (office Wi-Fi) sharing one IP is an accepted
// tradeoff at this scale; per-account keys (login by email, search by user id) don't
// have this issue.
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (!forwarded) return 'unknown'
  const first = forwarded.split(',')[0]?.trim()
  return first || 'unknown'
}
