# P2 — In-app notifications — Design

**Date:** 2026-07-12 · **Status:** approved (Fable design pass) · Replaces the
`[plan]` placeholder; board tasks P2-1..P2-3.

A bell + inbox over events the system already emits. **v1 is event-driven only** —
the three moments that already trigger email hooks. No realtime infra, no polling
loops: unread count renders server-side on each navigation (the app is RSC-rendered
per navigation anyway).

## 1. Data — migration 0026 `[rls review required]`

```
create type public.notification_type as enum
  ('TICKET_ASSIGNED', 'TICKET_STATUS_CHANGED', 'TICKET_COMMENT');

create table public.notifications (
  id uuid pk default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  recipient_user_id uuid not null references profiles(id) on delete cascade,
  type public.notification_type not null,
  title text not null,            -- e.g. 'Ticket assigned to you'
  body text,                      -- e.g. the ticket title
  href text not null,             -- in-app link, e.g. /tickets/<id>
  read_at timestamptz,            -- null = unread
  created_at timestamptz not null default now()
);
create index notifications_recipient_idx
  on public.notifications (recipient_user_id, read_at, created_at desc);
```

**RLS (the interesting part — reviewer, focus here):**
- SELECT: `recipient_user_id = auth.uid() and workspace_id = current_workspace_id()
  and coalesce(current_is_active(), false)` — strictly own-inbox, even managers never
  read another user's notifications.
- UPDATE (mark-read): same predicate in USING and WITH CHECK. Known accepted
  limitation, document in-file: row-level RLS can't stop the recipient editing their
  own row's title via PostgREST — blast radius is their own inbox row only. Do NOT
  add a SECURITY DEFINER RPC for this in v1.
- INSERT: **zero policy** — writes happen only via the service client (the same
  pattern as `log_ticket_event`'s audit writes: server actions authorize first, then
  write with service role). No DELETE.
- Demo: extend `reset_demo_workspace()` (via `create or replace` in this migration)
  to also `delete from public.notifications where workspace_id = demo_ws;`.

Fold into `schema_bundle.sql`.

## 2. Writer — `src/lib/notifications/notify-inapp.ts`

`createNotification(service, {workspaceId, recipientUserId, type, title, body, href})`
— best-effort, never-throws, console.error on failure (clone the discipline of
`appendTicketEvent` call sites). **Never notify the actor about their own action**
(skip when `recipientUserId === actorUserId`) and skip when recipient is null.

Wire into `src/app/(app)/tickets/actions.ts` at three action sites. **Accuracy
correction (verified against the live code 2026-07-15, pre-audit):** `notify.ts`
covers FIVE email moments — `notifyTicketStatusChanged`, `notifyOperatorAssigned`,
`notifyVendorAssigned`, `notifyVendorJobLink`, `notifyTicketCreated` — NOT three, and
crucially **there is no comment email at all.** So only two of the three in-app moments
have an existing email sibling to sit beside; the comment notification is net-new. The
emails stay untouched; add the in-app writes as follows:
1. Operator assigned → notify the operator. Sits beside `notifyOperatorAssigned`
   (~line 290). (`TICKET_ASSIGNED`)
2. Status changed → notify the reporter (`created_by`, and `created_for` if set and
   distinct — note the existing `reporterUserId: ticket.created_for_user_id ??
   ticket.created_by_user_id` resolution at ~line 225). Sits beside
   `notifyTicketStatusChanged` (~line 219). (`TICKET_STATUS_CHANGED`)
3. Comment added — **NEW, no email sibling.** Add at `addTicketCommentAction`
   (~line 482), which already parses/validates the `visibility` field and gates
   INTERNAL at ~line 500. PUBLIC only — never leak INTERNAL comment existence → notify
   the reporter if the commenter is someone else; if the commenter IS the reporter,
   notify the assigned operator instead. (`TICKET_COMMENT`)

Demo workspace: skip entirely (one `isDemoWorkspace` check at the top of the shared
writer — visitors share anon identities; notifications would be nonsense there).

## 3. UI

- **Bell in `TopNav`** (operators AND tenants — tenants get status/comment pings for
  their own requests; this is the rare surface both roles share): icon `Bell` +
  unread-count chip (cap display at "9+"), server-fetched via
  `countUnreadNotifications(supabase, userId)`. Links to `/notifications`. Hide when
  count is 0? No — always show the bell, chip only when >0.
- **`/notifications`** — PageHeader ("Notifications"); list newest-first (paged via
  the house `Pagination` at 25/page), each row: type-tinted dot (status colors from
  `src/lib/status.ts` tones), title, body, `relativeDay` timestamp, unread rows
  `bg-muted/40` + semibold title. Row click = a form-button row that marks read
  (server action) then redirects to `href`. "Mark all read" PageHeader action.
  EmptyState (icon `Bell`): "You're all caught up".
- Data layer `src/lib/data/notifications.ts`: `listNotificationsPage` (house
  `.range()` pattern), `countUnread`, `markRead(id)`, `markAllRead()` — the two write
  actions use the caller's OWN RLS client (UPDATE policy covers it), NOT the service
  client.
- **Delete `/preview/notifications` + nav entry in the same commit** (swap rule).
- Tenant surface note: tenants have no sidebar; the bell lives in TopNav which the
  portal layout already renders — verify the portal shows it; `/notifications` itself
  must be reachable by tenant role (no permission gate beyond auth; RLS scopes rows).

## 4. Out of scope (v1)

Realtime push, document-expiry/lease-ending digests (computed views, not events —
needs a scheduled job, revisit after self-hosting lands a cron story), per-type
preferences, email/in-app unification.

## 5. Board decomposition

- **P2-1** `[builder]` `[rls]` — migration 0026 (+demo-reset extension + bundle fold)
  + writer + wiring into the three action sites + data layer + unit tests (pure
  recipient-resolution branches: self-action skip, created_for fan-out, INTERNAL
  comment exclusion).
- **P2-2** `[builder]` — bell + unread chip + `/notifications` page + mark-read/all
  actions + **delete `/preview/notifications`** + portal-surface check. Depends P2-1.
- **P2-3** `[verify]` — after USER runs 0026: assign/status/comment each produce
  exactly one correctly-addressed notification; self-action produces none; INTERNAL
  comment produces none; mark-read + mark-all work; tenant sees only their own; demo
  workspace produces none.

**USER queue addition:** run migration 0026 (after P2-1 lands).
