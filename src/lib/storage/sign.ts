import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Batch-sign short-lived download URLs for private-bucket files.
 *
 * ONE storage-API call via `createSignedUrls` instead of N parallel
 * `createSignedUrl` requests (100 documents used to mean 100 HTTPS calls per
 * page render). Best-effort by design, matching every existing call site: a
 * path that fails to sign is simply absent from the map — the page renders
 * that file without a download link rather than crashing — and a total
 * failure returns an empty map.
 *
 * TTL stays 60s: these are per-render links on authenticated pages, and the
 * short TTL is part of the S1 hardening posture (matches the previous
 * per-file signing everywhere).
 */
export async function signStoragePaths(
  supabase: SupabaseClient,
  bucket: string,
  paths: string[],
  ttlSeconds = 60,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>()
  if (paths.length === 0) return urls
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, ttlSeconds)
    if (error || !data) return urls
    for (const entry of data) {
      // A per-path failure carries `error` on its own entry; skip it, keep the rest.
      if (entry.path && entry.signedUrl && !entry.error) urls.set(entry.path, entry.signedUrl)
    }
  } catch {
    // best-effort — an outage means "no download links this render", never a crash
  }
  return urls
}
