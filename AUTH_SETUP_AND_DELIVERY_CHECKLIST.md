# Murmur Email Authentication and Delivery Checklist

Murmur uses Supabase Auth with email and password. Google sign-in/sign-up and phone-number login or profile fields are intentionally not part of the app.

## Production app

- App origin: `https://murmur-app-7jm.pages.dev`
- Supabase project: `pkadftvqslkykehcqedj`
- Supabase URL: `https://pkadftvqslkykehcqedj.supabase.co`

Keep the Supabase Auth Site URL set to the production app origin. Add the exact production redirect URL `https://murmur-app-7jm.pages.dev/` and the password-recovery redirect `https://murmur-app-7jm.pages.dev/?password-reset=1`. Add local development URLs only when actively needed; do not use broad production wildcards.

## Email delivery

Supabase's built-in email sender is intended for development and testing, not reliable production delivery. Configure custom SMTP using a verified domain and provider.

1. Verify the sending domain with the SMTP provider.
2. Publish the provider's SPF and DKIM DNS records; configure DMARC.
3. In Supabase Auth SMTP settings, enable custom SMTP and enter the provider's host, port, username, password, sender address, and sender name.
4. Use `Murmur` as the sender name and a sender address on the verified domain.
5. Keep SMTP credentials in the Supabase dashboard's secret fields only. Never commit them to GitHub or browser code.
6. Disable click-tracking and link rewriting for authentication messages.

## Email templates

Review confirmation signup, password recovery, and change-email templates. Use Supabase's `{{ .ConfirmationURL }}` unless a deliberately implemented custom token-verification route is in use. Keep the recovery redirect on the Murmur production origin.

## Password recovery implementation

The app's recovery flow:
- accepts an email address only;
- checks account eligibility through the server-side `murmur-password-reset-check` Edge Function;
- rate-limits requests by IP and hashed email;
- does not return account IDs or profile data;
- blocks recovery for suspended, terminated, scheduled-for-deletion, or permanently deleted accounts;
- redirects eligible recovery links to `/?password-reset=1`;
- requires a valid Supabase recovery session before showing the new-password form;
- updates the password through Supabase Auth and signs out after success.

Do not reveal whether an email is registered in public-facing recovery responses unless the product intentionally accepts that account-enumeration risk. Review the current response wording before changing it.

## Required live tests

- [ ] Sign up with an email address and verify that a confirmation message arrives.
- [ ] Confirm the link opens the production Murmur site and establishes a session.
- [ ] Attempt password login before confirming the email; verify the resend-confirmation action appears.
- [ ] Resend confirmation and verify delivery.
- [ ] Request password recovery from a real mailbox that you control.
- [ ] Open the email link on the production app and confirm the new-password form appears.
- [ ] Submit a new password, verify success, then sign in with the new password.
- [ ] Verify expired, reused, malformed, and wrong-origin recovery links are rejected.
- [ ] Verify suspended and terminated accounts cannot use password recovery.
- [ ] Check Supabase Auth logs and SMTP provider delivery/bounce events.

A successful API response does not prove inbox delivery. Verify receipt in the mailbox and provider delivery events, including spam/junk.
