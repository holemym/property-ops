# Self-hosting runbook (Track S3)

Property Ops runs today on Vercel + Supabase Cloud (project `property-ops`, ref
`mdnffpqwudsyldhembzo`, eu-west-1). Nothing about the app *requires* that pairing —
this is the exit plan: how to run the same codebase on a single VPS or on-prem box if
the business ever needs to leave the managed platforms (cost, data residency,
contractual reasons). Docs-only; no code changes ship with this file.

---

## 1. Portability rules (already true today — this section documents, not changes)

The app was built to leave cleanly. Verified against the current codebase
(`src/`, `next.config.ts`, `package.json`) as of this writing:

- **No Vercel-only APIs.** No `@vercel/*` runtime SDK, no Vercel KV/Blob/Cron, no
  Edge Config, no `waitUntil`/Vercel-specific request context. The one approved
  Vercel-flavored dependency on the roadmap (`@vercel/speed-insights`, PERF-2) is an
  analytics beacon only — safe to leave installed-but-inert or remove on self-host,
  never load-bearing.
- **No serverless-only state.** Rate limiting (migration `0022_rate_limit.sql`) is
  Postgres-backed (`rate_limit_buckets` + `check_rate_limit()`), not an in-memory
  counter or Vercel Edge Middleware KV — it behaves identically self-hosted and
  survives process restarts/cold starts either way.
- **Integrations are raw `fetch`, env-key-gated, best-effort, never-throw.** Resend
  (email, `src/lib/email/send.ts`), Anthropic (AI triage, `src/lib/ai/claude.ts`), and
  Nominatim (geocoding, `src/lib/geocode.ts`, Track M) are all plain HTTPS calls with
  no vendor SDK and no dependency on where the Next.js process runs. Unset the key and
  the feature no-ops (logs instead of sending, heuristic instead of AI, etc.) — a
  self-host with no outbound internet still works, just with those features dark.
- **All config is env vars.** No settings baked into `next.config.ts` beyond reading
  `NEXT_PUBLIC_SUPABASE_URL` for the CSP `connect-src` allowlist. Every var the app
  reads is inventoried below — this table is the portability contract: reproduce it
  correctly on the new host and the app behaves identically.
- **Auth/data boundary is Supabase, not Vercel.** Supabase itself is portable (it
  ships an official self-host Docker Compose distribution — Postgres + GoTrue auth +
  PostgREST + Storage + Realtime + Studio). The app's Supabase client code
  (`src/lib/supabase/{client,server,middleware,service}.ts`) only ever talks to the
  project via `NEXT_PUBLIC_SUPABASE_URL` + keys — it never assumes `*.supabase.co`,
  so pointing it at a self-hosted Supabase URL is a config change, not a code change.

### Env var matrix

Ground truth: `grep -rhoE "process\.env\.[A-Z_]+" src next.config.ts` against the
codebase as of migration 0023 / Track D in progress. Re-run that grep before a real
cutover — this table can drift as new env-gated features land.

| Var | Required? | Stage / feature | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | Core (Phase 1) | Project API URL. Client-visible (`NEXT_PUBLIC_*`). Also read directly in `next.config.ts` to build the CSP `connect-src` allowlist. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | Core (Phase 1) | Anon/publishable key, used by browser + server (RLS-scoped) clients. Client-visible. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Required** | Core (Phase 1) | Bypasses RLS. Server-only — read lazily in `src/lib/supabase/service.ts`, never sent to the client, never logged. Guard this like a root DB password. |
| `NEXT_PUBLIC_SITE_URL` | **Required** | Core (auth callback, email links, job links) | Used to build `/auth/callback` (`src/lib/urls.ts`), the ticket-notification email base URL (`src/lib/email/notify.ts`, `src/app/(app)/tickets/actions.ts`), and the vendor job-link URL (`src/app/(app)/tickets/[id]/page.tsx`). Must be the externally-reachable canonical origin (e.g. `https://ops.yourdomain.com`), no trailing slash. |
| `SIGNUP_MODE` | Optional | S1.2 invite-only signup | `src/lib/auth/signup-mode.ts`. Set to `invite` to close public self-signup (`/signup` becomes invite-only, admins issue invites instead). Unset = open signup (pre-S1 default behavior). |
| `RESEND_API_KEY` | Optional | Phase 4 email delivery | `src/lib/email/send.ts`. Unset → `sendEmail()` is a no-op that only console-logs (zero network calls, zero cost) — safe default for a fresh self-host with no email provider yet. |
| `EMAIL_FROM` | Optional (requires `RESEND_API_KEY`) | Phase 4 email delivery | Must be a Resend-verified sender address. Falls back to a hardcoded default `DEFAULT_FROM` in `send.ts` if unset while `RESEND_API_KEY` is set — but that default is almost certainly wrong for a self-host's own domain, so set it explicitly whenever `RESEND_API_KEY` is set. |
| `ANTHROPIC_API_KEY` | Optional | AI triage (disconnected integration) | `src/lib/ai/claude.ts`, `src/lib/ai/triage.ts`. Unset → ticket triage falls back to the offline heuristic classifier; no AI call is attempted and nothing breaks. |
| `ANTHROPIC_TRIAGE_MODEL` | Optional (requires `ANTHROPIC_API_KEY`) | AI triage | Defaults to `claude-haiku-4-5` if unset. |
| `DEMO_MODE` | Optional | Track D demo sandbox | `src/app/(auth)/demo-actions.ts`. Set to `on` to expose the public "Explore the demo" entry points. Leave unset on a production self-host serving real customer data — the demo sandbox is a marketing/sales tool, not something you want live on a tenant's own private deployment. |
| `DEMO_WORKSPACE_ID` | Optional (requires `DEMO_MODE=on`) | Track D demo sandbox | `src/app/(auth)/demo-actions.ts`. Must match the fixed workspace UUID seeded by migration `0023_demo_mode.sql`'s `reset_demo_workspace()`. Only meaningful alongside `DEMO_MODE=on`. |

**Test-only, not part of any deployment (dev or self-hosted prod):**
`RLS_TEST_SUPABASE_URL` / `RLS_TEST_SERVICE_ROLE_KEY` / `RLS_TEST_ANON_KEY` — read
only by `npm run test:rls` (see `.env.rls.example`), and only ever meant to point at a
disposable, throwaway Supabase project. Never set these against the box you're
actually self-hosting on.

`NEXT_PUBLIC_*` vars are compiled into client-side bundles at build time — treat them
as public, non-secret config, and rebuild after changing them (unlike server-only
vars, which a `next start` restart alone will pick up).

---

## 2. Target architecture

One VPS or on-prem box running three things behind a reverse proxy:

```
Internet
   |
   v
Caddy (auto-TLS, :443)
   |
   +--> Next.js standalone server (:3000, internal)
   |        |
   |        v
   +--> (optional) direct pass-through to Supabase Studio (:8000, internal, admin-only)
            |
Supabase self-host stack (Docker Compose): Postgres, GoTrue (auth), PostgREST,
Storage API, Realtime, Studio, Kong (API gateway) — all on an internal Docker
network, not directly internet-facing except through Kong on its own port.
```

**Supabase:** use Supabase's own official self-host Docker Compose distribution
(`github.com/supabase/supabase`, `docker/` directory) rather than hand-rolling
Postgres + GoTrue + PostgREST + Storage separately — it wires the pieces together
correctly (JWT secret shared between GoTrue/PostgREST/Storage, Kong routing, etc.)
and is what upstream actually tests. Apply this project's own `supabase/migrations/`
+ `supabase/schema_bundle.sql` against the resulting Postgres instance (see §3) —
those files are Supabase-flavor-agnostic plain SQL/PL-pgSQL, they don't care whether
they're running on Supabase Cloud or self-hosted Supabase.

Configure the self-hosted Supabase stack's SMTP settings (GoTrue's `GOTRUE_SMTP_*`
env vars in the compose `.env`) so auth emails (confirmation, password reset, invite)
actually deliver — Supabase Cloud provides a shared sender by default; self-hosted
GoTrue does not send anything until SMTP is configured.

**Next.js:** build with `output: 'standalone'` in `next.config.ts` (a one-line addon
to the existing config, not present today because Vercel doesn't need it — Vercel
builds standalone output implicitly). Standalone output produces a
`.next/standalone/server.js` plus a trimmed `node_modules` you can `node server.js` on
any box without a full `npm install` — copy `.next/standalone/`, `.next/static/` (into
`.next/standalone/.next/static/`), and `public/` (into `.next/standalone/public/`) to
the host, set the env vars from §1, and run it under a process supervisor (systemd
unit or `pm2`) so it restarts on crash/reboot. Point Caddy at its port.

**Caddy:** terminates TLS (automatic Let's Encrypt certs, zero manual cert
management), reverse-proxies `/` to the Next.js standalone server. A minimal
`Caddyfile`:

```
ops.yourdomain.com {
    reverse_proxy localhost:3000
}
```

Caddy's own `Strict-Transport-Security` behavior can coexist with the app's own HSTS
header (`next.config.ts` sets `max-age=63072000; includeSubDomains`) — Caddy won't
strip or duplicate it, just don't also set a conflicting HSTS value in the Caddyfile.

---

## 3. Migration path (cloud → self-host cutover)

1. **Freeze writes** on the Cloud instance (maintenance-mode banner, or a scheduled
   low-traffic window — this app has no built-in maintenance mode, so this is a
   manual coordination step, not a toggle).
2. **`pg_dump` the Cloud Postgres:**
   `pg_dump --format=custom --no-owner --no-privileges -h <cloud-host> -U postgres -d postgres -f propops.dump`
   (use the Cloud project's connection string from Settings → Database; the
   `--no-owner`/`--no-privileges` flags avoid role-name mismatches on restore since
   the self-hosted stack's `postgres`/`supabase_admin` roles won't exactly match
   Cloud's internal role names).
3. **Restore into the self-hosted Postgres:**
   `pg_restore --no-owner --no-privileges -h localhost -U postgres -d postgres propops.dump`
   Then confirm the roles this app actually depends on exist correctly:
   `authenticated`, `anon`, `service_role` (Supabase's standard three) — the official
   self-host compose creates these automatically; the dump/restore only needs to
   populate schemas/tables/data/functions into that existing role structure.
4. **Storage objects:** Supabase Storage backs onto either S3-compatible object
   storage or local disk depending on the self-host config. Sync the `attachments`
   bucket's objects (see `ATTACHMENTS_BUCKET` in `src/lib/data/attachments.ts` — the
   only bucket this app uses) from Cloud to the new backend — either the Supabase
   Storage API's own object listing + download/upload (scriptable against both the
   Cloud and self-hosted Storage REST endpoints with the service key), or, if both
   ends are S3-compatible, a direct `rclone`/`aws s3 sync` between the two buckets.
   Object *paths* (keys) must be preserved exactly — the app derives signed URLs from
   stored paths in the `attachments` table rows, not from any other identifier.
5. **Env cutover:** point the new deployment's `NEXT_PUBLIC_SUPABASE_URL` at the
   self-hosted Kong gateway URL, and its anon/service-role keys at the self-hosted
   stack's freshly-generated JWT-signed keys (Supabase self-host generates its own
   anon/service-role JWTs from a configured `JWT_SECRET` — these are **different
   strings** from the Cloud project's keys, even though they play the same role).
   Set `NEXT_PUBLIC_SITE_URL` to the new canonical domain.
6. **DNS:** point the domain's A/AAAA record at the new box once the above is
   verified end-to-end on a temporary hostname/IP (don't cut DNS over blind).
7. **Smoke-test checklist before calling it done:**
   - [ ] Login works (existing user, correct workspace loads).
   - [ ] Signup/invite flow works per whatever `SIGNUP_MODE` is set.
   - [ ] RLS spot-check: run `npm run test:rls` against the new instance (point
     `.env.rls` at it temporarily — **only if the new instance still has test/seed
     data you can afford to churn**, never against a live cutover with real tenant
     data; otherwise spot-check manually by attempting a few cross-workspace reads
     as a non-manager user and confirming they're denied).
   - [ ] Signed URLs resolve: open an existing ticket attachment, confirm the
     60s-TTL signed URL loads the file from the new Storage backend.
   - [ ] Invite email delivers (requires SMTP configured per §2).
   - [ ] Security headers present: `curl -I https://ops.yourdomain.com` shows HSTS,
     X-Frame-Options, CSP, etc. (same `next.config.ts` headers, unchanged by hosting).
   - [ ] Vendor job-link page (`/job/<token>`) still loads without a session —
     confirms `PUBLIC_PATHS` in `src/proxy.ts` and the new `NEXT_PUBLIC_SITE_URL`
     agree on what a job link looks like.
8. Keep the Cloud project read-only (not deleted) for a rollback window (recommend
   at least one full week) before decommissioning it.

---

## 4. Operations (ongoing, once self-hosted)

- **Nightly backup cron:** `pg_dump --format=custom` on a cron (systemd timer or
  plain crontab) to a path outside the Docker volume, plus a storage-bucket rsync
  (`rclone sync` if S3-compatible backend, or plain `rsync` if local-disk backend) —
  both to an off-box destination (another host, or object storage in a different
  provider/region). Retention: keep at minimum 7 daily + 4 weekly snapshots; prune
  older ones in the same cron script.
- **Restore drill:** quarterly, restore the latest backup into a scratch Postgres +
  Storage instance (never the live one) and run the smoke-test checklist from §3
  against it. A backup you've never restored is a backup you don't actually have.
- **Update cadence for the Supabase images:** self-hosted Supabase is a set of Docker
  images (`postgres`, `gotrue`, `postgrest`, `storage-api`, `realtime`, `kong`,
  `studio`) pinned by tag in the compose file. Watch upstream's release notes; apply
  patch/minor image bumps promptly (they carry security fixes), treat major bumps as
  a deliberate, tested change (snapshot first, bump on a scratch copy, verify the
  smoke-test checklist, then promote) — same patch-free/major-deliberate policy this
  roadmap already applies to npm deps (S2.4).
- **Next.js/app updates:** same `git pull` + `npm run build` + redeploy the
  standalone output as any other environment; no self-host-specific build step beyond
  what §2 describes once `output: 'standalone'` is in place.
- **Uptime monitoring:** point an external monitor (e.g. an uptime-check service, or
  a simple cron `curl` + alert) at a cheap, unauthenticated route — `/login` returns
  200 for logged-out visitors and doesn't touch the database in a way that would mask
  a DB-down condition as a false "up", so a full page-load check against `/login`
  (not just a TCP port check) is the better health signal.

---

## Out of scope (per the security-hardening spec)

WAF/DDoS protection is a platform/edge concern the self-hosted box doesn't get for
free the way Vercel's edge network provides it implicitly — if self-hosting, that's a
separate decision (e.g. Cloudflare in front of Caddy) not covered here. SSO/SAML,
field-level encryption, and GDPR export/delete tooling remain backlog items
regardless of hosting.
