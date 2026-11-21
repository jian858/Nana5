## Murmur change summary

<!-- Describe the user-visible change and the files or database objects affected. -->

## Required project standards

- [ ] Followed **Chatly-100-Rules.md** (database, RLS, auth, storage, Realtime, client, performance, secrets, clean code, testing, release and user safety).
- [ ] Followed **Chatly-App-Description-and-Supabase-Guide.md** (Supabase-first architecture and implementation patterns).
- [ ] The live application uses Supabase only; no Firebase SDK, identity provider, database, or storage path was added.
- [ ] No service-role key or secret was added to browser code, repository files, logs, or client-visible environment variables.
- [ ] Every changed exposed table has RLS enabled and action-specific policies with ownership or membership checks.
- [ ] INSERT and UPDATE policies include appropriate WITH CHECK; UPDATE also has a matching SELECT policy.
- [ ] Database changes are additive, reviewed SQL migrations; previously applied migrations were not edited.
- [ ] Storage paths and policies enforce owner or conversation membership as required.
- [ ] Realtime subscriptions are cleaned up on unmount, screen change, and sign-out.
- [ ] UI includes loading, empty, error, and success states; inputs are validated and user text is rendered safely.
- [ ] Queries select only needed columns, paginate large collections, and use appropriate indexes.
- [ ] Tests cover anonymous access and at least two separate user accounts, including forbidden access attempts.
- [ ] Security and performance advisors were reviewed; unresolved warnings are documented.

## Verification

- [ ] Architecture guard workflow passes.
- [ ] Relevant automated tests pass.
- [ ] Manual mobile and desktop checks completed.
- [ ] No production deployment is claimed until required dashboard settings and end-to-end tests are verified.

## Known risks / follow-up

<!-- List dashboard-only settings, unverified policies, migration steps, and follow-up work. -->
