# Murmur — Supabase-first migration status

Last updated: 2026-11-21

## Target architecture
- Supabase Auth is the only account identity provider (email/password and Google OAuth).
- `auth.users.id` is the canonical Murmur user ID.
- `public.profiles.id` is the same UUID and is created by the Auth trigger.
- Public profile fields live in `public.profiles`; private credentials stay in Supabase Auth.
- Firebase Authentication and Firebase Realtime Database must not be used for new account creation, sign-in, password reset, or profile writes.

## Completed in this staging pass
- Supabase browser client is initialized from the public project URL and publishable key only.
- Added a shared `window.MurmurSupabaseAuth` API for Supabase email signup/sign-in, Google OAuth, profile save/read, password reset, password update, sign-out, and auth-state subscription.
- Updated the database identity helper so RLS resolves the current user directly from `auth.uid()`; Firebase token-to-user mapping is no longer used by the new database policy helper.
- Added case-insensitive username uniqueness.
- Recreated the Auth-user profile trigger and own-profile RLS policies.

## Not launch-ready yet
The current feature layer still contains Firebase Realtime Database and Firebase Storage calls for feed listeners, chats, friends, stories, notifications, account restrictions, media uploads, and profile editing. Changing only the login provider would leave those features unauthenticated or partially broken. The app must remain offline/private until these modules are moved to the matching Supabase tables and Storage buckets and tested under RLS.

## Remaining migration work
1. Replace Firebase auth/session initialization in `app.js` with Supabase session restoration and Supabase auth-state events.
2. Wire the registration, login, Google sign-in, logout, password-reset completion, account deletion, and email-change screens to `window.MurmurSupabaseAuth`.
3. Move profile reads/writes and image uploads to Supabase profiles/Storage.
4. Move feed, friends, chats, stories, reels, notes, notifications, blocks, reports, and moderation actions to their Supabase tables/RPCs; remove Firebase listeners and Firebase-token Edge Function calls.
5. Review and test every RLS policy with separate anonymous, authenticated, and admin test accounts.
6. Test email confirmation, password recovery, Google OAuth, refresh/reopen session, profile editing, and deletion before deployment.

## Required dashboard setup
- Supabase Authentication → URL Configuration: set the production Site URL and add the exact Murmur preview/production callback URLs.
- Supabase Authentication → Providers → Google: enable Google and configure the OAuth Client ID and Client Secret. Keep the secret in Supabase dashboard only; never commit it to GitHub or frontend code.
- Confirm email SMTP and reset/confirmation templates use Murmur branding.
- Existing Firebase passwords cannot be copied as plaintext. Since Murmur has no live users, create fresh test accounts in Supabase for validation.

## Safety
Do not deploy this unfinished migration publicly. Do not put a service-role key in browser code. Only the Supabase publishable key belongs in the frontend.
