# Murmur code rules

These rules apply to every change in the Murmur application.

## Rule 1 — Clean before changing

Before adding a feature or changing behavior, clean the code that the change touches. Improve the names, structure, and readability of the affected functions first. Do not build a new feature on top of confusing or duplicated code.

## Rule 2 — Keep the codebase clean

Keep code readable, consistent, organized, and free of dead or duplicate code. Refactor in small, reviewable steps. Preserve existing behavior unless a behavior change is explicitly requested, and verify each change before deployment.

## Project boundaries

- The Murmur application lives in this repository. Keep the separate Admin project separate; do not edit its repository as part of Murmur cleanup.
- Keep the main HTML entry point separate from JavaScript and CSS assets.
- Preserve existing Murmur features, account data, and user-facing flows while refactoring.
- Firebase remains the authentication provider. Supabase keeps its own independent UUID. Link both IDs to the same account; do not merge or replace either ID.
- Never expose the two account IDs to ordinary users. Admin-only identity access must be enforced server-side, not merely hidden in the interface.
- Keep refresh operations limited to one every five minutes where the existing refresh policy applies.
- Do not add emoji to the app interface.
- Never put service-role keys, passwords, or other server secrets in browser files.

## Safe change process

1. Inspect the complete code path and its callers before editing.
2. Remove duplication only after confirming that the duplicated code has the same behavior and dependencies.
3. Keep each change focused; do not mass-format or rewrite large files without a behavior-preserving check.
4. Validate JavaScript syntax, JSON, asset paths, and relevant database rules.
5. Test authentication, Firebase/Supabase identity linking, profiles, friend requests, posts, stories, reels, chat, notifications, and account restrictions when their code is touched.
6. Deploy only after the branch has been reviewed and the relevant tests pass.
