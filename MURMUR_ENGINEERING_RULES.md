# Murmur engineering rules

This repository adopts the two Chatly project references as mandatory implementation standards:

1. **Chatly-100-Rules.md** — the 100 rules covering database design, Row Level Security, functions, authentication, Storage, Realtime, client code, performance, secrets, clean code, testing, release and user safety.
2. **Chatly-App-Description-and-Supabase-Guide.md** — the Supabase-first architecture and implementation guide.

These source documents are the authority for detailed requirements. This file does not replace or rewrite them.

## Architecture boundary

- Supabase Auth is the only identity provider.
- Supabase Postgres is the only application database.
- Supabase Storage is the only application media store.
- Supabase Realtime is the live event transport.
- The browser may use only the project URL and publishable key.
- Never add Firebase SDK imports, Firebase Auth, Firebase Realtime Database, Firebase Storage, Firebase identity bridges, or Firebase-backed application data to the live app.
- The live startup modules are listed in `index.html`. Old, inactive source files must never be reconnected to the live startup path. Retire them only after checking all routes and references.

## Database and security

- Put every schema change in a new, clearly named Supabase SQL migration. Never rewrite an applied migration.
- Enable RLS on every table in an exposed schema in the same migration that creates it.
- Design action-specific policies. Use `(select auth.uid())` for ownership checks, and validate both `USING` and `WITH CHECK` for updates.
- Do not use user-editable metadata for authorization.
- Do not use a service-role or secret key in browser code.
- Treat views, functions, Storage policies, Realtime authorization and admin operations as security-sensitive code.
- Do not silence a security advisor warning by adding blanket policies. Investigate the data access model first.

## Client implementation

- Keep one shared Supabase client.
- Keep data access in Supabase data modules; keep UI modules focused on presentation and interaction.
- Check every Supabase result for errors and provide a friendly UI state.
- Provide loading, empty, error and success states.
- Validate and constrain user input in the client, while enforcing the real rules in Postgres.
- Render user-authored content as text; do not inject untrusted HTML.
- Paginate feeds and message histories; do not fetch unbounded collections.
- Clean up Realtime channels when a view changes or a user signs out.
- Keep offline, reconnect, duplicate-event and retry behavior explicit.

## Required verification

- Run the architecture guard workflow.
- Test database permissions as anonymous and as two different signed-in users.
- Verify that users cannot read or mutate another user's private rows or conversations they do not belong to.
- Test Auth, Google OAuth, password reset, Storage uploads, Realtime subscriptions, and session restoration when those areas change.
- Review Supabase security and performance advisors after database changes.
- Record dashboard-only requirements and anything that could not be verified.

## Change notes

For every meaningful change, update the relevant feature documentation and explain:
- what changed;
- which files and migrations changed;
- where the change belongs in the project;
- how it was tested;
- what remains unverified.

The project is not launch-ready merely because a code change or migration succeeds. Required security, account, mobile, desktop and deployment checks must pass first.
