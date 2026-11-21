# Murmur Update Guide

This file is the maintenance map for the **main Murmur app** repository. Keep the Admin project separate.

## Where to put each update

| What you want to change | File(s) to edit |
| --- | --- |
| Firebase keys and app-wide settings (limits, labels, timings) | `config.js` |
| Firebase SDK imports/exports only | `firebase.js` |
| Main app state, shared helpers, Supabase identity sync | `app.js` |
| Home feed and post feed rendering | `home-feed.js` |
| Friends and friend requests | `friends.js` |
| Chat interface and chat behavior | `chat.js`, `messaging.js` |
| Alerts and notifications UI | `alerts.js` |
| Online status / presence | `presence.js` |
| Main tab/view navigation | `navigation.js` |
| Registration and account creation | `registration.js` |
| Login | `login.js` |
| Forgot/reset password | `password-reset.js` |
| Terms, Privacy, Cookie Policy overlay content | `legal.js` |
| Public standalone legal pages | `terms.html`, `privacy.html`, `cookies.html` |
| Stories | `stories.js` |
| Comments | `comments.js` |
| Create posts / composer | `post-composer.js` |
| Notes | `notes.js` |
| Session and sign-out handling | `session.js` |
| Reels | `reels.js` |
| Menu, settings, report a problem, customer support | `menu.js`, with styles in `support.css` |
| User profile | `profile.js` |
| Account recovery | `account-recovery.js` |
| Blocking users | `blocking.js` |
| Security and safety UI | `security.js` |
| Visitor tracking (anonymous browser token and page events) | `visitor-tracking.js` |
| Responsive layout | `responsive.css` |
| General visual design | `styles.css` |
| Performance and reduced-motion styling | `performance.css` |
| Legal and authentication styling | `legal-auth.css` |
| Offline / install experience | `pwa.js`, `service-worker.js` |
| App icon, install metadata | `manifest.json`, `murmur-icon.svg` |
| Support modal styling | `support.css` |
| Firebase database access rules | `database.rules.json` (deploy to Firebase separately) |
| Supabase database/functions | `supabase/` (migrations and Edge Functions; deployment is separate) |
| Hosting routes and security headers | `vercel.json` |
| Main page structure and script/style links | `index.html` |
| Script loading order | `app-loader.js` |

## How the split JavaScript app loads

1. `index.html` loads the Firebase bridge and settings.
2. `app-loader.js` loads feature scripts in order.
3. Feature scripts are classic scripts and share the same page-level global scope. Keep cross-file declarations compatible; avoid redeclaring existing top-level `const` or `let` names.
4. `pwa.js` loads after the feature scripts.

When adding a new feature JavaScript file:
- Add it to `MURMUR_FEATURE_FILES` in `app-loader.js` in the correct dependency order.
- Add it to `APP_SHELL` in `service-worker.js` so it can be cached for offline startup.
- Increase the query version in `app-loader.js` when you need browsers/CDNs to fetch changed feature scripts.
- Increase `CACHE_NAME` in `service-worker.js` whenever its cached shell list or assets change.

When adding a stylesheet:
- Link it in `index.html`.
- Add the same URL (including its query version) to `APP_SHELL` in `service-worker.js`.

## Safe update checklist

1. Fetch the latest version of every file before editing it; never overwrite a newer change with an old copy.
2. Change only the file(s) responsible for the feature. Keep Admin code in the Admin repository.
3. Check JavaScript syntax for every changed `.js` file.
4. Check that every local `src` and `href` in `index.html` points to an existing file or a deliberate Vercel route.
5. Check that every script loaded by `app-loader.js` is also included in the service-worker app shell.
6. Check JSON syntax in `manifest.json`, `vercel.json`, and `database.rules.json`.
7. Test the changed feature in a real browser on a phone and desktop. Test signed-out and signed-in states where relevant.
8. Test offline startup after the service worker has installed and refreshed.
9. Confirm the Vercel production deployment succeeded before telling users the live site is fixed.
10. For Firebase rules and Supabase migrations/functions, deploy and test those systems separately; a GitHub commit alone does not deploy them.

## Important boundaries

- Firebase web API configuration is public by design; enforce access with Firebase Security Rules and App Check where appropriate. Never commit service-role keys, private keys, passwords, or admin tokens.
- The visitor ID is a random first-party browser identifier, not a guaranteed physical-phone identifier. Clearing browser data or using another browser can create another ID.
- A browser cache or service worker cannot make Firebase/Supabase-backed chat, account creation, uploads, or live data work without a network connection.
- GitHub commits do not prove that Vercel, Firebase, or Supabase has deployed the changes.
- Keep user-facing app UI free of emoji; follow the existing Murmur visual style.

## Current audit notes

- The service worker previously cached an old monolithic `app.js` and did not list the split feature scripts, which could break offline startup. The shell list has now been updated to include the split files and current styles.
- The legal routes are mapped to the standalone `terms.html`, `privacy.html`, and `cookies.html` files. Keep these pages in sync with the legal content in `legal.js`.
- Browser runtime, actual offline behavior, Firebase permissions, Supabase visitor writes, and production deployment still require live testing. Do not mark them as verified based on a syntax or GitHub check alone.
