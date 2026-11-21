# Murmur — Supabase-only migration status

Last updated: 2026-11-21

## Target architecture
- Supabase Auth is the only identity provider (email/password and Google OAuth).
- `auth.users.id` is the canonical internal user UUID.
- `public.profiles.id` matches the Auth UUID.
- Every profile receives a unique 16-character `public_id`; it is a public lookup identifier, not a credential.
- Supabase Postgres + RLS is the only application database.
- Supabase Realtime provides live updates.
- Supabase Storage is the only media storage provider.
- The browser uses only the Supabase project URL and publishable key. Never expose a service-role key.

## Completed in this pass
- The live `index.html` loads `supabase-client.js`, `supabase-runtime.js`, `visitor-tracking.js`, and `supabase-app.js`; it does not load the Firebase-era classic-script modules.
- Supabase email/password sign-in, signup, Google OAuth initiation, sign-out, password reset, and password reset completion use Supabase Auth.
- Signup stores full name and username in Supabase Auth metadata; a database trigger creates the profile.
- Profile IDs are linked to Supabase Auth UUIDs and have unique 16-character public IDs.
- Supabase Storage buckets and owner-folder upload/update/delete policies exist for Murmur media.
- Supabase Realtime publication includes posts, notifications, stories, reels, and messages.
- The active home feed, profile, posts, friend search/requests, conversations, messages, stories, reels, notes, notifications, and account-restriction checks use Supabase services.
- Private visitor tables have RLS enabled and no direct browser-role table grants.
- Anonymous visitor recording is constrained by per-visitor and optional per-network five-minute rate limits.
- Admin tables are RLS-enabled and service-role-only; admin actions use the Supabase-authenticated `murmur-admin-supabase` Edge Function.
- Applied migration `20261121130809_harden_public_table_privileges_and_profile_rls`: revoked browser-role `TRUNCATE`, `REFERENCES`, and `TRIGGER` on all public tables; set the same restrictions for future tables created by `postgres`; revoked anonymous access to account restriction/appeal tables; optimized profile insert/update policies with `(select auth.uid())`.

## Important remaining work — do not deploy as finished
- Firebase-era files and Firebase-named historical database objects still exist. The live index does not load those scripts, but the legacy Edge Functions and historical identity rows still need controlled retirement. Preserve the existing 2 legacy identity links and 3 device-account links until a deliberate migration/archive plan is approved; do not delete them as part of routine cleanup.
- The Supabase UI is an initial working slice, not a complete recreation of every previous screen. Remaining UI work includes full messaging attachments/voice, read receipts/typing, comments/reactions/saved posts, richer story views, richer reels controls, block/report flows, admin tools and device/visitor administration.
- Confirm Supabase Auth email-confirmation settings and Google OAuth provider credentials/redirect URLs in the dashboard.
- Validate RLS and Storage policies with separate test accounts; run the documented two-user and anonymous tests.
- Enable leaked-password protection in Supabase Auth settings if the plan supports it.
- Review public-read media bucket behavior before real user media is uploaded. All current media buckets contain zero objects; do not make private buckets without updating the client to use signed URLs and the corresponding row-aware Storage policies.
- Verify Realtime subscriptions and media uploads in a browser on desktop and mobile.
- Test signup, login, Google OAuth, password reset, session restoration, posts, friend requests, chat, stories, reels, notes and notifications before public deployment.

## Current database setup
- Profile ID: UUID linked to Supabase Auth.
- Public account ID: unique 16-character lowercase hex string.
- Storage buckets: `murmur-avatars`, `murmur-posts`, `murmur-stories`, `murmur-reels`; `murmur-media` is also configured private.
- Realtime publication: `posts`, `notifications`, `stories`, `reels`, and `messages`.

## Safety
- Do not delete the existing Supabase test account or historical Firebase-to-Supabase identity/device records until a migration plan preserves their references.
- Do not place a service-role key in any frontend or Admin file.
- Do not mark the project launch-ready until two-user RLS tests, Storage privacy checks, browser smoke tests and dashboard configuration checks pass.

## Chatly standards enforcement pass — 2026-11-21
- `MURMUR_ENGINEERING_RULES.md` makes both Chatly reference documents mandatory for every Murmur code and database change.
- `.github/pull_request_template.md` and `.github/workflows/murmur-supabase-guard.yml` enforce the repository security and architecture checklist.
- The guard is static analysis only; it does not replace browser tests, two-user RLS tests, Supabase advisors or dashboard configuration checks.

## Visitor-table security remediation — 2026-11-21
- Applied Supabase migration `20261121130057_secure_private_visitor_tracking_tables` (repository file: `supabase/migrations/20261121130057_secure_private_visitor_tracking_tables.sql`).
- Enabled RLS on `private.murmur_visitor_devices` and `private.murmur_visitor_events`.
- Revoked direct table privileges from `PUBLIC`, `anon` and `authenticated`; anonymous and signed-in browser roles cannot SELECT or INSERT directly.
- Preserved `public.record_murmur_visit(uuid, text)` as the narrowly scoped anonymous visitor write path. It is SECURITY DEFINER with an empty search_path and schema-qualified table names; its intentional public execution is rate-limited.
- No visitor rows were deleted or rewritten.

## Admin database and visitor RPC security review — 2026-11-21
- Reviewed admin tables: `public.admin_audit_log`, `public.murmur_admin_allowlist`, `public.murmur_admin_identity_map`, `public.murmur_admin_records`, `public.murmur_error_logs`, and `public.murmur_refresh_cooldowns`. All have RLS enabled; browser roles have no direct SELECT/INSERT access.
- Admin RPCs inspected are restricted to `service_role`; keep the service-role key server-side only.
- Applied `20261121130327_rate_limit_public_visitor_recording`: max 40 accepted events per visitor per five-minute window and, when a valid forwarded IP is available, max 200 events per network address per five-minute window.
- Verified a null visitor ID is rejected without writing an event.
- The security advisor will continue to flag the anonymous visitor RPC because it intentionally remains a public SECURITY DEFINER endpoint. Review this exception before launch.

## RLS-without-policy classification
- The RLS-enabled/no-policy tables include private migration/device tables, public admin/system tables and legacy `public.murmur_posts`. A privilege audit confirmed no direct SELECT/INSERT grants to `anon` or `authenticated` for this group. Do not add broad client policies merely to clear informational advisor findings.
- `public.murmur_posts` is a legacy Firebase-keyed table with zero rows and no browser grants. Keep it inaccessible while its old endpoint is retired; drop it only in a separately reviewed migration after all dependencies are confirmed absent.

## Public table privilege hardening — 2026-11-21
- Revoked `TRUNCATE`, `REFERENCES`, and `TRIGGER` from `anon` and `authenticated` on all existing public tables. These privileges bypass row-level access expectations or are not needed by browser clients.
- Added matching default-privilege revocations for future public tables created by `postgres`.
- Revoked all anonymous privileges on `account_restrictions` and `account_appeals`; authenticated access remains governed by their existing RLS policies.
- Recreated profile insert/update policies using `(select auth.uid())`, retaining ownership checks and the update `WITH CHECK`.
