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
- Historical Firebase-named database objects and identity records remain for audit/migration history. The inactive Firebase client modules have been removed, four legacy Edge Function endpoints are retired, the error logger now accepts Supabase sessions only, and the active admin API no longer exposes Firebase identity links. Preserve the existing 2 legacy identity links and 3 device-account links until a deliberate migration/archive plan is approved; do not delete them as part of routine cleanup.
- The Supabase UI is an initial working slice, not a complete recreation of every previous screen. Remaining UI work includes full messaging attachments/voice, read receipts/typing, comments/reactions/saved posts, richer story views, richer reels controls, block/report flows, admin tools and device/visitor administration.
- Confirm Supabase Auth email-confirmation settings and Google OAuth provider credentials/redirect URLs in the dashboard.
- Validate RLS and Storage policies with separate test accounts; run the documented two-user and anonymous tests.
- Leaked-password protection is not available on this project's current Free plan; Supabase documents this feature as Pro and above. It remains a known limitation unless the project plan changes.
- The avatar bucket remains public; post, story, and reel media buckets are private. The client stores object paths and requests short-lived signed URLs; row-aware Storage policies check post visibility, story friendship/expiry, and reel audience. All media buckets were empty when this migration was applied.
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
- Preserved `public.record_murmur_visit(uuid, text)` as a narrowly scoped SECURITY DEFINER database function with an empty search_path and schema-qualified table names, but revoked browser-role execution. The `murmur-visitor-track` Edge Function is the only anonymous ingress and calls the RPC with the server-side service role after rate limiting.
- No visitor rows were deleted or rewritten.

## Admin database and visitor RPC security review — 2026-11-21
- Reviewed admin tables: `public.admin_audit_log`, `public.murmur_admin_allowlist`, `public.murmur_admin_identity_map`, `public.murmur_admin_records`, `public.murmur_error_logs`, and `public.murmur_refresh_cooldowns`. All have RLS enabled; browser roles have no direct SELECT/INSERT access.
- Admin RPCs inspected are restricted to `service_role`; keep the service-role key server-side only.
- Applied `20261121130327_rate_limit_public_visitor_recording`: max 40 accepted events per visitor per five-minute window and, when a valid forwarded IP is available, max 200 events per network address per five-minute window.
- Verified a null visitor ID is rejected without writing an event.
- The visitor RPC is now service-role-only, so the advisor no longer flags it as publicly executable. Anonymous telemetry is accepted only through the rate-limited visitor Edge Function.

## RLS-without-policy classification
- The RLS-enabled/no-policy tables include private migration/device tables, public admin/system tables and legacy `public.murmur_posts`. A privilege audit confirmed no direct SELECT/INSERT grants to `anon` or `authenticated` for this group. Do not add broad client policies merely to clear informational advisor findings.
- `public.murmur_posts` is a legacy Firebase-keyed table with zero rows and no browser grants. Its old Edge Function is now retired. Keep the table inaccessible; drop it only in a separately reviewed migration after all dependencies and historical references are confirmed absent.

## Public table privilege hardening — 2026-11-21
- Revoked `TRUNCATE`, `REFERENCES`, and `TRIGGER` from `anon` and `authenticated` on all existing public tables. These privileges bypass row-level access expectations or are not needed by browser clients.
- Added matching default-privilege revocations for future public tables created by `postgres`.
- Revoked all anonymous privileges on `account_restrictions` and `account_appeals`; authenticated access remains governed by their existing RLS policies.
- Recreated profile insert/update policies using `(select auth.uid())`, retaining ownership checks and the update `WITH CHECK`.


## Supabase-only runtime retirement — 2026-11-21

- Audited every HTML entry point and the import graph of the active modules. The main app loads only `supabase-client.js`, `supabase-runtime.js`, `visitor-tracking.js`, `supabase-app.js`, and `pwa.js`; the separate invite page loads `invite.js`. Active Supabase modules import only the Supabase client/data/social modules.
- Removed 28 inactive JavaScript modules that were not referenced by any HTML entry point or active-module import, including the old Firebase app, Google auth, registration and login modules. Their history remains recoverable through Git.
- Replaced the deployed `murmur-posts`, `murmur-identity`, and `murmur-admin` Firebase endpoints, plus the unused password-reset account-enumeration endpoint, with retired 410 responses and enabled Supabase JWT verification at the Edge gateway. Old Firebase tokens can no longer use these endpoints.
- Reworked `murmur-error-log` to require a verified Supabase JWT at the Edge gateway and verify the user with Supabase Auth. New error records use a `supabase:<uuid>` actor key in the renamed `actor_key` column. Existing 115 error-log rows were preserved.
- The active `murmur-admin-supabase` endpoint now returns 410 for the historical Firebase identity lookup action. The 2 historical identity links and 3 visitor-device account links remain private and unchanged.
- Verified the Supabase Auth account/profile counts: one existing test account and one profile. No test users were created or deleted.
- The Supabase organization is on the Free plan. Supabase's current password-security documentation states that leaked-password protection requires Pro or above; this cannot be enabled on the current plan.
- Current media buckets `murmur-posts`, `murmur-stories`, and `murmur-reels` are public-read and contain zero objects. They remain public for compatibility with the current client, which stores public URLs. Convert them to private only together with a signed-URL/path-based client migration and row-aware Storage policies.

## Final verification snapshot — 2026-11-21

- Verified no `anon` or `authenticated` role has `TRUNCATE`, `REFERENCES`, or `TRIGGER` privileges on any public table.
- Verified anonymous SELECT/INSERT privileges are absent from `account_restrictions` and `account_appeals`.
- Verified profile INSERT/UPDATE policies still enforce `id = (select auth.uid())`; Supabase's performance advisor no longer reports the profile RLS init-plan warnings.
- Security advisor: no publicly executable SECURITY DEFINER functions remain. Remaining findings are informational RLS-enabled private/admin tables with no direct policies, plus leaked-password protection unavailable on the Free plan.
- Performance advisor: remaining findings are unused-index notices. Do not drop these indexes based on the current short/no-user activity window; collect longer-term usage evidence first.
- Health advisor returned no findings.
- Full two-user browser RLS tests, Google OAuth/email delivery checks, private-media policy migration, and live Vercel deployment verification remain outstanding. Do not call the app launch-ready until those pass.


## Firebase identity RPC retirement — 2026-11-21

- Applied migration `20261121132000_retire_firebase_identity_rpcs`.
- Dropped the unused server-only Firebase identity RPCs: both `admin_ensure_firebase_link` overloads, `admin_set_firebase_email`, `admin_find_firebase_link_by_email`, `admin_list_firebase_identity_links`, and `admin_link_firebase_device`.
- The deployed Firebase callers were already replaced with retired endpoints; a dependency scan found no other database functions referencing these RPCs.
- No rows were deleted. The private historical `firebase_user_links` and `murmur_device_accounts` records remain preserved and inaccessible to browser roles.
- Retired `murmur-password-reset-check` because the live client uses Supabase Auth's native `resetPasswordForEmail` flow; the old endpoint distinguished unknown and active email addresses and was not part of the current app.


## Final legacy-table and Edge Function cleanup — 2026-11-21

- Applied migration `20261121132234_drop_legacy_murmur_posts_table`.
- Dropped `public.murmur_posts` only after confirming it had zero rows, no foreign-key dependents, no referencing views/triggers/functions, no browser grants, and no active client or Edge Function callers. Its old post endpoint was already retired.
- Retired the unused `murmur-public-announcements` Edge Function. The live client reads published announcements directly from Supabase under the existing RLS policy.
- Changed `murmur-error-log` to require Supabase JWT verification at the Edge gateway; anonymous error logging is no longer accepted. Admin log access still requires an enabled Supabase Super Admin.
- The only public anonymous ingestion endpoint is `murmur-visitor-track` (Edge JWT verification disabled intentionally for anonymous telemetry); it applies a 200-per-network five-minute limit and calls the service-role-only visitor RPC, which adds a 40-per-visitor five-minute limit. No browser role can execute the database RPC directly.


## Private media and signed URL migration — 2026-11-21

- Applied migration `20261121132636_private_murmur_media_with_signed_urls`.
- `murmur-avatars` remains public-read. `murmur-posts`, `murmur-stories`, `murmur-reels`, and `murmur-media` are private.
- Added row-aware `private.can_view_murmur_media(bucket_id, object_path)` as a narrowly scoped SECURITY DEFINER helper with an empty search_path. Only authenticated users can execute it; it checks the relevant post visibility/specific audience, active friend stories, and reel audience, and verifies the object path belongs to the row's author.
- Replaced the broad public-read media policy with public avatar read plus authenticated audience-aware media read.
- The client now stores random object paths rather than public or signed URLs, creates short-lived signed URLs at render time, ignores original filenames for object keys, validates MIME type and size, and attempts Storage API deletion when a post/story/reel is deleted.
- Storage limits: avatars 5 MB, posts 20 MB, stories 20 MB, reels 100 MB. Allowed MIME types are restricted per bucket.
- Added unique indexes for media paths. Existing media buckets had zero objects, so no old media URLs needed migration.


## Anonymous visitor ingress hardening — 2026-11-21

- Applied migration `20261121133117_restrict_visitor_rpc_to_service_role`.
- Revoked `EXECUTE` on `public.record_murmur_visit(uuid,text)` from `PUBLIC`, `anon`, and `authenticated`; granted it only to `service_role`.
- Added the public `murmur-visitor-track` Edge Function with JWT verification disabled intentionally because visits must be recorded before sign-in. It validates the visitor UUID and path, rate-limits the forwarded network address to 200 requests per five-minute window, and invokes the visitor RPC with the server-side service-role key.
- The database RPC retains the 40-per-visitor five-minute limit and optional network limit. The browser now calls the Edge Function through the shared Supabase client rather than calling a public SECURITY DEFINER RPC.
- Verified `anon_execute=false`, `authenticated_execute=false`, and `service_role_execute=true` for the visitor RPC. The security advisor no longer reports a publicly executable SECURITY DEFINER function.
- Updated the visitor script to wait for the shared Supabase client-ready event and bumped the service-worker shell cache to v19.


## Error-log identity column cleanup — 2026-11-21

- Applied migration `20261121133303_rename_error_log_firebase_uid_to_actor_key` (exact applied version is recorded in Supabase migration history).
- Renamed `public.murmur_error_logs.firebase_uid` to `actor_key` and renamed its supporting index. All 115 existing error records were preserved.
- Updated the error-log Edge Function and admin API to use `actor_key`; new authenticated records identify users as `supabase:<uuid>`. The 103 historical unprefixed actor identifiers were anonymized to `legacy:anonymous`; the 12 current `supabase:<uuid>` actor keys remain intact. All 115 error records were preserved.


## Supabase-only admin and visitor dashboard — 2026-11-21

- Applied migration `20261121133537_supabase_only_admin_views_and_device_ids`.
- Updated the service-role-only admin views to expose Supabase UUIDs and Murmur public IDs instead of Firebase identifiers. The private historical device-account rows remain preserved.
- Added the `visitor_analytics` action to `murmur-admin-supabase`: exact unique-device and event counts, today's counts, a 5,000-event sample for daily/page breakdowns, latest visits, and linked device/account summaries.
- Visitor events now broadcast `visitor-change` to the private `admin:visitors` Realtime channel after successful recording; only enabled Super Admins can receive that channel.
- Updated the separate `jian858/Admin` workspace to show the Supabase UUID and Murmur public ID, remove the obsolete Firebase identity view and Firebase password-reset tools, display `actor_key` in error logs, and use the Supabase visitor analytics response.
- Removed the client-side hardcoded admin email check. The server-side Supabase Auth allowlist remains the actual authorization boundary.
- Password resets are handled by Supabase Auth's native recovery flow; the retired Firebase bulk/single reset controls are no longer shown.


## Final Firebase identity removal — 2026-11-21

- Applied migration `20261121133952_remove_firebase_identity_artifacts`.
- Removed the Firebase-only identity RPCs and empty admin identity tables.
- Renamed the two-row private Firebase link table to `private.murmur_legacy_account_archive`, removed the Firebase UID column, and retained its two archived Supabase-ID references plus profile metadata for historical recovery. These IDs do not correspond to active Supabase Auth users.
- Removed the Firebase UID column from `private.murmur_device_accounts` and changed its primary key to `(visitor_id, supabase_id)`; all three device-account association rows remain.
- Applied migration `20261121134128_anonymize_legacy_error_log_actors`; historical error records remain, but 103 unprefixed legacy actor identifiers were replaced with `legacy:anonymous`. Twelve current `supabase:<uuid>` actor identifiers were preserved.
- Verified no Firebase-named tables or columns and no Firebase-referencing database functions remain in the `public` and `private` schemas.
- Updated the separate Admin app's error page to read `actor_key`, use Supabase/database terminology, and refreshed its script versions. Fixed malformed Announcements tab markup.


## Legacy archive index cleanup — 2026-11-21

- Applied migration `20261121134257_finalize_legacy_archive_keys`.
- Added a primary key on `private.murmur_legacy_account_archive.legacy_supabase_id`, removed an unused email index, and renamed the remaining username index to remove legacy Firebase naming.
- Verified no Firebase-named indexes remain in the `public` or `private` schemas.


## Anonymous social grants cleanup — 2026-11-21

- Applied migration `20261121134512_revoke_legacy_anonymous_social_grants`.
- Revoked all `anon` privileges from `public.reels` and `public.user_notes`. Both tables retain their authenticated RLS policies; no rows were deleted.

## Profile privacy hardening — 2026-11-21

- Applied migration `20261121134635_limit_full_profile_reads_to_owner`, restricting full `profiles` rows to their owner.
- The initial security-barrier view was replaced by a normal RLS-protected `public.murmur_public_profiles` projection table in migration `20261121134816_replace_profile_view_with_safe_directory_table`, avoiding a SECURITY DEFINER view warning.
- The directory contains only `id`, `public_id`, `username`, `display_name`, `bio`, `avatar_url`, `cover_url`, and `created_at`. It is readable by authenticated users and has no client write privileges.
- A private-schema trigger synchronizes those public fields when a profile is inserted or updated. Full profile reads remain owner-only, so fields such as phone, birthday, and gender are not exposed through social discovery.
- Updated profile search, friend lists, and feed author lookup to read the public projection table.
