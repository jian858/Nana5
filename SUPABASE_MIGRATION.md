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
- Live app functions now use Supabase for the home feed, friend requests, conversation creation, messages, stories, reels, notes and notifications.
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
