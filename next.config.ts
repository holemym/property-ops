import type { NextConfig } from "next";

// Security headers (Track S1.1 — see docs/superpowers/specs/2026-07-09-property-ops-security-hardening-design.md).
// CSP ships as Report-Only first: browse the live app with DevTools console open and
// confirm zero violations before flipping the header name to the enforcing
// "Content-Security-Policy" in a follow-up commit.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const CSP = [
  "default-src 'self'",
  // va.vercel-scripts.com: Speed Insights' dev-mode debug script (PERF-2). In
  // production (no `dsn` prop set) it self-hosts at the same-origin
  // /_vercel/speed-insights/script.js path instead, already covered by 'self'.
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  // blob:/data: cover MapLibre's rendered canvas + marker assets. The old raster
  // *.tile.openstreetmap.org host is gone with the Leaflet map.
  "img-src 'self' data: blob:",
  "font-src 'self'",
  // tiles.openfreemap.org: MapLibre fetches the style JSON, vector tiles, sprites,
  // and glyph PBFs over fetch — all governed by connect-src.
  `connect-src 'self'${SUPABASE_URL ? ` ${SUPABASE_URL}` : ""} https://tiles.openfreemap.org`,
  // MapLibre spins its tile-decoding web worker up from a blob: URL; without an
  // explicit worker-src this falls back to script-src (no blob:) and the map
  // would go blank the day the header flips to enforcing.
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Client router cache for dynamic routes (PERF-3). Every route here is dynamic
  // (cookies), so the Next default of 0 refetched the ENTIRE page on every repeat
  // navigation — back/forward and sidebar re-visits within 30s are now instant
  // client-cache hits. Mutations stay correct: every server action calls
  // revalidatePath, which busts this cache. Accepted staleness surface: the TopNav
  // unread bell can lag up to 30s between navigations.
  experimental: {
    staleTimes: { dynamic: 30 },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value: CSP,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
