# Murmur Supabase-only migration audit

This file is the verified migration checklist for `main`. It follows the repository rules:

- **Rule 1:** clean the code a feature uses before adding or migrating that feature.
- **Rule 2:** keep code readable, consistent, organized, and free of dead or duplicate code; preserve behavior and verify changes.

## Current verified state

- The Admin site uses Supabase Auth and the `murmur-admin-supabase` Edge Function.
- The main app is **not yet Supabase-only**. `index.html` still loads `config.js`, `firebase.js`, and `app.js`.
- `app.js` still initializes Firebase Auth, Realtime Database, and Storage. It contains 67 Realtime Database reference call sites.
- `supabase-client.js` and `supabase-data.js` are a foundation, but the main app does not yet use them as its complete data/auth implementation.
- Do not remove the Firebase scripts, configuration, or legacy Edge Functions until all call sites are migrated and verified.

## Verified legacy Realtime Database path families

The current main app reads or writes these Firebase paths. Preserve the behavior and access rules when migrating:

| Feature | Existing paths |
|---|---|
| Accounts and profiles | `users/{uid}`, `profiles/{uid}`, `profiles/{uid}/photo`, `profiles/{uid}/code`, `codes/{code}` |
| Feed and saved posts | `posts`, `posts/{postId}/likes/{uid}`, `savedPosts/{uid}/{postId}` |
| Friends and presence | `friends/{uid}`, `presence/{uid}`, `blocks/{uid}` |
| Chat | `chats/{chatId}/messages`, `chats/{chatId}/typing/{uid}`, `chats/{chatId}/seen/{uid}`, message reactions |
| Stories | `stories/{uid}`, story views, story notifications |
| Comments | `comments/{postOrReelId}` |
| Reels | `reels`, `reels/{reelId}/likes/{uid}`, `saved/{uid}/{reelId}` |
| Notifications and announcements | `notifications/{uid}`, `announcements` |
| Safety and account state | `reports`, `suspended/{uid}`, `appeals/{uid}` |
| Private profile notes | `notes/{uid}` |

The app also uses Firebase Storage for profile photos, reel media, and audio messages. These must move to Supabase Storage with correct public/private bucket behavior and signed URLs.

## Existing Supabase destination candidates

These are confirmed from the existing project schema or previous migrations; validate columns and RLS before wiring each feature:

- `profiles`, `posts`, `comments`, `messages`, `friendships`, `stories`, `reports`, `reels`
- `notifications`, `announcements`, `account_restrictions`, `account_appeals`, `user_notes`
- Storage buckets: `murmur-avatars` (public) and `murmur-media` (private)

Some legacy RTDB concepts do not have a confirmed one-to-one destination yet, notably typing indicators, presence, saved-post/reel relations, story views, and the legacy user/code lookup. Do not silently discard these features or invent table columns.

## Migration order

1. **Auth and identity:** move sign-up, sign-in, password reset, session restore, account deletion, and identity checks to Supabase Auth. Resolve ownership/ID mapping before touching user data.
2. **Profiles and discovery:** migrate profile reads/writes, username lookup, and account-code lookup with unique constraints and RLS.
3. **Feed and social graph:** migrate posts, likes, saved posts, comments, friends, and blocks.
4. **Messaging and presence:** migrate messages, reactions, typing, seen state, and presence using Realtime channels and bounded subscriptions.
5. **Stories and reels:** migrate media uploads, views, likes, saves, comments, and expiry behavior.
6. **Notifications and safety:** migrate notifications, announcements, reports, restrictions, appeals, and private notes.
7. **Storage and cleanup:** verify ownership policies and signed URLs, then remove Firebase SDK imports, config, scripts, error logging, and legacy Edge Functions/RPCs only after repository-wide reference checks.

## Verification required before declaring completion

- No Firebase SDK imports, globals, configuration, or Firebase network calls remain in either website.
- No Firebase-token verification remains in active Edge Functions.
- Every feature above has a Supabase implementation and tested RLS policies.
- Existing Supabase records remain intact.
- Sign-up, sign-in, recovery, feed, chat, stories, reels, media, reports, appeals, suspension, and admin actions are smoke-tested.
- The 5-minute manual refresh cooldown is enforced server-side, not only by a browser timer.
- Scheduled account deletion has a trusted server-side worker before it is described as automatic.

## Critical identity and authorization dependency discovered

The current RLS model is still mixed:

- Most social-table policies call `private.current_supabase_user_id()`.
- That helper currently maps a Firebase JWT subject through `private.firebase_user_links`, checks Firebase issuer/audience, and rejects suspended profiles.
- Reels and user-notes policies use `auth.uid()` directly.
- The five-minute refresh RPC also uses `auth.uid()`.

Therefore, simply swapping the browser login SDK would break social-table authorization until the RLS identity helper and the app's identity model are migrated together. Do not replace the helper prematurely while the current Firebase app is live.

Current database snapshot after the user-approved cleanup: 1 profile row, 1 Supabase Auth user, 0 unmatched profiles, 0 legacy Firebase identity links, 0 post rows, and 0 message rows. The five profile rows without matching Auth users and their three Firebase identity-link rows were deleted at the user's explicit instruction after checking that they had no linked social records. The one profile matching the active Supabase Auth account was preserved.

Identity inventory is now complete: one active Supabase Auth user maps to the one remaining profile, with no unmatched profiles and no legacy Firebase identity links. The next cutover tasks are:
1. Review every dependent RLS policy and helper, including block checks, suspension checks, reports, stories, conversations, and refresh cooldowns.
2. Replace the Firebase-token identity helper with a native `auth.uid()` implementation only after the app's Supabase Auth session lifecycle is ready to ship.
3. Test each policy using real authenticated Supabase sessions for at least two ordinary users and the admin account.
4. Migrate the browser's auth/session lifecycle and all remaining Firebase-backed feature paths together in tested stages.
5. Remove Firebase-token Edge Functions only after no deployed client calls them.

This is a required cutover dependency, not optional cleanup.

### Auth inventory result (latest audit)

- Supabase Auth currently has 1 user.
- There is 1 profile, and its ID matches that Auth user.
- There are 0 unmatched profile rows.
- There are 0 legacy Firebase-to-Supabase identity-link rows.
- The five unmatched profiles and three legacy identity-link rows were removed only after the user explicitly requested deletion and the database check found no linked social records for those profiles.

No additional profile cleanup is authorized or needed.


## Latest implementation update

- Hardened the existing `on_auth_user_created` trigger.
- Moved its trigger function from exposed `public` into the non-exposed `private` schema.
- Renamed it to `private.handle_new_murmur_user()` and revoked direct execution from `anon`, `authenticated`, and `public`.
- The trigger normalizes and validates optional username metadata against the actual `profiles_username_format` constraint, caps display names at 80 characters, and falls back to creating a profile without a username if the submitted username is invalid or already taken.
- Added `profiles_auth_user_fkey` from `public.profiles.id` to `auth.users.id` with `ON DELETE CASCADE`, preventing orphan profile rows when an Auth user is deleted.
- Ran a database-level signup-trigger test with two temporary Auth users: one valid username and one duplicate username. Both profile paths passed, and deleting the test Auth users cascaded their profiles. The temporary test rows were cleaned up; the live inventory remains 1 Auth user, 1 matching profile, and 0 unmatched profiles.
- Verified the trigger still points to the private function and that neither `anon` nor `authenticated` can execute it directly.
- Expanded `supabase-data.js` auth helpers with verified user/session retrieval and an unsubscribe-safe auth-state listener.
- These are Supabase Auth foundation changes; they do **not** switch the live main app away from Firebase or change the mixed RLS identity helper.

Security advisor items observed after this change (pre-existing and not silently altered): six RLS-enabled internal tables have no client policies; the five-minute refresh RPC is a SECURITY DEFINER function intentionally callable by authenticated users and must be reviewed against its internal `auth.uid()` checks; leaked-password protection is disabled in project Auth settings.
