# Murmur — SOLID and Supabase-only engineering rules

These rules are mandatory for all future changes to the main Murmur app.

## Non-negotiable backend rule

Supabase is the only backend and source of truth for Murmur.
- Supabase Auth: email/password, Google OAuth, sessions, password recovery and email changes.
- Supabase Postgres: profiles, posts, comments, friendships, conversations, messages, stories, reels, notes, notifications, blocks, reports, moderation and visitor analytics.
- Supabase Storage: avatars, covers, post media, story media and reel media.
- Supabase Realtime: live feed, messaging, presence and notifications where appropriate.
- Supabase Edge Functions / secure database functions: privileged operations and admin actions.
- Use the Supabase Auth UUID (`auth.uid()`) as the canonical Murmur user ID.
- Use only the Supabase publishable key in browser code. Never expose a service-role or secret key.
- Enforce authorization with RLS and server-side checks. A hidden UI button is not authorization.

## Absolute Firebase removal requirement

Firebase must not be used by the shipped Murmur application:
- No Firebase SDK imports, CDN scripts, initialization, configuration, API calls or runtime globals.
- No Firebase Authentication, Realtime Database, Storage, Hosting or Firebase-token identity bridge.
- No dual writes, background synchronization, Firebase fallback or Firebase-based account lookup.
- Remove Firebase-only rules, configuration, scripts, documentation, dependencies and obsolete migration artifacts after their responsibilities have been replaced in Supabase.
- Search the entire repository for Firebase references before declaring removal complete.
- Do not delete or modify existing Supabase Auth users as part of this code migration.

## SOLID rules

### S — Single Responsibility
Each module owns one feature or service. UI rendering, validation, persistence and authorization must not be tangled together.

### O — Open/Closed
Add new feature behavior through small extensions, adapters and event handlers rather than repeatedly rewriting stable core modules.

### L — Liskov Substitution
Implementations behind a shared service contract must be interchangeable without changing feature behavior. Test each implementation against the same contract.

### I — Interface Segregation
Features receive only the service methods they use. For example, the feed receives post and media services, not admin or account-deletion privileges.

### D — Dependency Inversion
Feature modules depend on documented interfaces such as AuthService, ProfileRepository, PostRepository, MessageRepository and MediaStorage. Supabase-specific queries stay inside infrastructure adapters.

## Suggested structure

```text
src/
  core/
    auth/
    database/
    storage/
    realtime/
    errors/
  features/
    accounts/
    profiles/
    feed/
    friends/
    messaging/
    stories/
    reels/
    notifications/
    visitors/
    moderation/
  shared/
    components/
    validation/
    utilities/
  app/
```

Keep the main Murmur website and Murmur Admin website in their separate repositories. They may use the same Supabase project, but admin permissions must be verified server-side and never inferred from user-editable profile metadata.

## Completion gate

Do not label Murmur Supabase-only, remove the remaining legacy runtime entrypoints, or deploy publicly until all of the following pass:
1. Repository-wide scan finds no Firebase runtime imports, identifiers, configuration, endpoints or Firebase-only files.
2. Every feature reads and writes its Supabase table or Storage bucket.
3. Realtime subscriptions and cleanup work without Firebase listeners.
4. RLS tests pass for anonymous, normal authenticated and authorized admin users.
5. Email signup, login, Google OAuth, logout, password reset, session refresh and profile editing pass end-to-end tests.
6. Feed, friends, chat, stories, reels, notifications, blocks, reports, visitor tracking and moderation pass end-to-end tests.
7. No browser bundle contains a service-role key or other server secret.

A code change is not complete just because Firebase strings or script tags were deleted: all dependent features must continue to work using Supabase.