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
- Removed the Firebase SDK file, Firebase project config file, Firebase Realtime Database rules file, and Firebase script imports from the live `index.html`.
- Replaced the live startup path with `supabase-app.js`; it no longer loads the Firebase-era classic-script modules.
- Added `supabase-runtime.js` and `supabase-social.js` as the shared Supabase application/data entry points.
- Supabase email/password sign-in, signup, Google OAuth initiation, sign-out, password reset, and password reset completion use Supabase Auth.
- Signup stores full name and username in Supabase Auth metadata; the database trigger creates the profile.
- Added and applied a database migration for a unique 16-character profile public ID. Existing Supabase Auth users were not deleted.
- Verified the existing profile has a 16-character public ID.
- Added Supabase Storage buckets for avatars, posts, stories and reels, with public-read and owner-folder upload/update/delete policies.
- Enabled Supabase Realtime publication for posts, notifications, stories and reels; messages were already enabled.
- Live app functions now use Supabase for the home feed, text/photo/video posts, friend search and requests, conversation creation, messages, stories with media, reels with video uploads, notes, notifications and admin announcements in Alerts.\n- Added Supabase profile editing and avatar uploads.\n- Added realtime subscriptions for posts, messages, notifications, stories and reels.\n- Added account restriction checks before opening the signed-in app.
- Updated public Privacy and Cookie pages to describe Supabase rather than Firebase.

## Important remaining work — do not deploy as finished
- The old Firebase-era feature source files still exist in the repository as inactive legacy code. They are not loaded by the live index, but must be replaced or retired after each corresponding Supabase feature is fully migrated.
- The new Supabase UI is an initial working slice, not a complete recreation of every previous screen. Remaining UI work includes full profile editing, message attachments/voice, message read receipts/typing, comments/reactions/saved posts, story media and views, richer reels controls, block/report flows, admin tools and device/visitor administration.
- Confirm Supabase Auth email-confirmation settings and Google OAuth provider credentials/redirect URLs in the dashboard.
- Validate every RLS policy and Storage policy with separate test accounts; the security advisor currently reports RLS-enabled private/admin tables with no direct policies (some are intentionally service-only) and warns that the anonymous visitor RPC is SECURITY DEFINER.
- Enable leaked-password protection in Supabase Auth settings.
- Verify the Supabase Realtime subscriptions and media uploads in a browser on both desktop and mobile.
- Test signup, login, Google OAuth, password reset, refresh/reopen session, posts, friend requests, chat, stories, reels, notes and notifications before public deployment.

## Current database setup
- Profile ID: UUID linked to Supabase Auth.
- Public account ID: unique 16-character lowercase hex string.
- Storage buckets: `murmur-avatars`, `murmur-posts`, `murmur-stories`, `murmur-reels`.
- Realtime publication: `posts`, `notifications`, `stories`, `reels`, and existing `messages`.

## Safety
- Do not delete the existing Supabase test account.
- Do not place a service-role key in any frontend or Admin file.
- Do not deploy this migration as complete until the remaining feature screens and RLS tests pass.


## Chatly standards enforcement pass — 2026-11-21

- Added `MURMUR_ENGINEERING_RULES.md` to make both Chatly reference documents mandatory for every Murmur code and database change.
- Added `.github/pull_request_template.md` with the security, RLS, migration, Realtime, performance, testing and release checklist.
- Added `.github/workflows/murmur-supabase-guard.yml` to reject Firebase references in the live entrypoint and active Supabase modules, and reject server-only secret patterns in browser modules.
- The guard is a static architecture check. It does not replace browser tests, two-user RLS tests, Supabase advisors or dashboard configuration checks.

## Verified Supabase security findings — 2026-11-21

A live security-advisor check found the following items. They are not silently treated as fixed:

- RLS is disabled on `private.murmur_visitor_events` and `private.murmur_visitor_devices`. The advisor explicitly warns not to enable RLS without first defining the intended access policies. These tables need a deliberate access-model review before remediation.
- The advisor reports 10 RLS-enabled tables with no direct policies, including private/admin tables. Confirm each is intentionally inaccessible to browser roles or add narrowly scoped policies where client access is required.
- `public.record_murmur_visit(p_visitor_id uuid, p_page_path text)` is a SECURITY DEFINER RPC executable by anon and authenticated. Review its input validation, rate limiting and write scope; preserve public visitor tracking only if its constrained behavior is intentional.
- Leaked-password protection is disabled in Supabase Auth and must be enabled in the project settings.

The live `index.html` loads the Supabase modules, but Firebase-era source and historical database artifacts remain in the repository/database. They are not proof of a fully completed Firebase removal. Do not reconnect legacy Firebase scripts. Audit and retire old source files and Firebase-named database objects through reviewed migrations, preserving required visitor/account data and never editing an already-applied migration.


## Visitor-table security remediation — 2026-11-21

- Applied Supabase migration `20261121130057_secure_private_visitor_tracking_tables` (repository file: `supabase/migrations/20261121140000_secure_private_visitor_tracking_tables.sql`).
- Enabled RLS on `private.murmur_visitor_devices` and `private.murmur_visitor_events`.
- Revoked direct table privileges from `PUBLIC`, `anon` and `authenticated`; verification confirms anonymous and signed-in browser roles cannot SELECT or INSERT directly.
- Preserved `public.record_murmur_visit(uuid, text)` for anonymous visitor tracking. It is owned by `postgres`, uses an empty search_path and schema-qualified table names, and remains SECURITY DEFINER because it is the controlled write path. The Supabase advisor will continue to flag this intentional public RPC; review abuse/rate-limiting controls before launch.
- No visitor rows were deleted or rewritten.

### Remaining security work after visitor-table remediation
- Review and explicitly classify the RLS-enabled/no-policy tables (including admin-only and private service tables); do not add broad policies merely to silence the advisor.
- Harden or formally accept the anonymous visitor RPC's abuse/rate-limit exposure.
- Enable leaked-password protection in Supabase Auth dashboard settings.
- Continue validating public application table policies with two separate accounts and anonymous access.


## Admin database and visitor RPC security review — 2026-11-21

- Reviewed admin tables: `public.admin_audit_log`, `public.murmur_admin_allowlist`, `public.murmur_admin_identity_map`, `public.murmur_admin_records`, `public.murmur_error_logs`, and `public.murmur_refresh_cooldowns`. All have RLS enabled. The `anon` and `authenticated` roles have no direct SELECT or INSERT privileges; the inspected table grants are limited to `service_role`.
- Reviewed admin RPC execution grants. The inspected account restriction and admin identity-list SECURITY DEFINER functions are executable by `service_role`, not `anon` or `authenticated`. Continue to keep the service-role key server-side only.
- Added and applied `20261121130300_rate_limit_public_visitor_recording`. The public visitor RPC now enforces a maximum of 40 events per visitor per five-minute window and, when a valid forwarded IP is available, 200 events per network address per five-minute window. The RPC returns `false` when throttled. It continues to write only to the private visitor tables.
- Verified the function definition and execution grants, verified the admin RPC grants, verified direct browser-role table privileges are absent, and confirmed a null visitor ID is rejected without writing an event.
- The Supabase advisor still flags the visitor RPC because it intentionally remains a public SECURITY DEFINER endpoint for anonymous visitor counting. Its privileged behavior is narrowly scoped, uses an empty search_path and schema-qualified private tables, and is rate-limited. Reassess before launch if anonymous visitor tracking is no longer needed.
- The advisor also continues to report RLS-enabled tables without policies. These are intentionally private/service-only tables or need further per-feature review; do not add broad client policies to clear informational findings.
- Leaked-password protection remains a dashboard setting and still needs to be enabled in Supabase Auth.


### RLS-without-policy classification

A follow-up privilege audit of every RLS-enabled table currently reported without a policy found that none grants direct `SELECT` or `INSERT` to `anon` or `authenticated`. The set includes private migration/device tables and public admin/system tables, plus `public.murmur_posts`. These are currently inaccessible through direct browser table access. Do not add user-facing policies unless a reviewed feature explicitly needs direct access; use the intended server-side/service-role or narrowly scoped RPC path. The `murmur_posts` table needs a separate legacy-use check before it is retired or exposed.
