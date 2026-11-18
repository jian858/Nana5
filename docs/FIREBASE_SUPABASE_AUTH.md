# Firebase Authentication and Supabase Third-Party Auth

## Required provider configuration

The production Supabase project must register Firebase project `murmur-fc430` under
Authentication → Third-Party Auth → Firebase. The Firebase ID token must contain
`role: "authenticated"`. The browser must supply the current Firebase ID token
using the Supabase client's `accessToken` callback.

## Firebase role claim rollout

This repository includes:

- `functions/index.js`: adds the required role claim to newly created Firebase users.
- `scripts/backfill-firebase-claims.js`: one-time backfill for existing users.

Deploy from a trusted workstation:

1. Install Firebase CLI and authenticate as a project administrator.
2. Run `cd functions && npm install`.
3. From the repository root, run `firebase use murmur-fc430`.
4. Deploy with `firebase deploy --only functions`.
5. Run the backfill script using a protected service-account credential file.
6. Force-refresh Firebase ID tokens after the claims are set.
7. Verify a test ID token has the expected issuer, audience and role claim.
8. Confirm the Firebase provider is enabled in the Supabase dashboard.

Do not commit service-account JSON, Firebase Admin credentials, or Supabase
service-role keys. The Firebase web API key is public configuration and is not
an administrative credential.

## Identity mapping migration blocker

The existing `ensure_murmur_user()` function writes an independently generated
UUID into `public.profiles.id`, but the production foreign key
`profiles_auth_user_fkey` still requires that UUID to exist in `auth.users`.
The existing two identity mappings also have no matching `auth.users` or
profile rows. Granting RPC execution alone does not solve this mismatch.

Before switching the app to the direct RPC, design and test a compatibility
migration for every application foreign key currently referencing
`auth.users`, plus the RLS identity expression used by Firebase JWTs. Do not
drop the profile foreign key or grant the RPC until the replacement identity
and ownership model is ready and tested against a production backup.

## Current transition state

The app still uses the legacy `murmur-identity` Edge Function. That function
calls `admin_ensure_firebase_link()`. The current UI no longer publishes the
Firebase/Supabase ID pair as `window.MURMUR_IDS` or writes it to the console.
This does not yet complete the direct `ensure_murmur_user()` integration.
