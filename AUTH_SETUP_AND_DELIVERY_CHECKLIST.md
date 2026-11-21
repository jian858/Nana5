# Murmur Google OAuth and Email Delivery Setup

This project uses Supabase Auth only. Do not add Firebase authentication or place provider secrets in the browser bundle or Git repository.

## Current application values

- App origin: `https://murmur-app-7jm.pages.dev`
- Supabase project: `pkadftvqslkykehcqedj`
- Supabase project URL: `https://pkadftvqslkykehcqedj.supabase.co`
- Google OAuth callback URI: `https://pkadftvqslkykehcqedj.supabase.co/auth/v1/callback`
- App redirect after OAuth/email confirmation: `https://murmur-app-7jm.pages.dev/`

## 1. Google OAuth provider

**Current status (2026-11-21): Google provider is disabled in this Supabase project.** The app now disables the Google button until provider credentials are configured. Email/password sign-in remains the supported login method. To enable Google later, complete every step below and then re-enable the button in `supabase-app.js`.

1. Open [Google Cloud Console](https://console.cloud.google.com/).
2. Create/select the Murmur Google Cloud project and configure the OAuth consent screen.
3. Create an OAuth Client ID with application type **Web application**.
4. Add this Authorized JavaScript origin:
   `https://murmur-app-7jm.pages.dev`
5. Add this Authorized redirect URI exactly:
   `https://pkadftvqslkykehcqedj.supabase.co/auth/v1/callback`
6. Copy the Google Client ID and Client Secret.
7. Open [Murmur Supabase Auth Providers](https://supabase.com/dashboard/project/pkadftvqslkykehcqedj/auth/providers).
8. Open Google, enable the provider, paste the Client ID and Client Secret, and save.
9. Never paste the Client Secret into GitHub, `index.html`, `supabase-client.js`, or any browser-visible file.

## 2. Supabase URL configuration

Open [Supabase Auth URL Configuration](https://supabase.com/dashboard/project/pkadftvqslkykehcqedj/auth/url-configuration).

Set **Site URL** to:
`https://murmur-app-7jm.pages.dev`

Add this exact production Redirect URL:
`https://murmur-app-7jm.pages.dev/`

For local development only, add the exact local origin used by the developer, such as `http://localhost:3000/`; remove it from production allow-lists if no longer needed. Do not use a broad wildcard for production.

The app currently sends the app root as the redirect target for Google OAuth, signup confirmation, and resend-confirmation requests. Password recovery uses `/?password-reset=1`.

## 3. Email delivery

Supabase's built-in email sender is for development/testing only. Current Supabase documentation says it is limited to addresses belonging to the project's organization and currently permits only about 2 messages per hour; limits may change. It is not a production delivery service.

For real users:

1. Choose an SMTP provider (for example Resend, Brevo, Postmark, SendGrid, or AWS SES).
2. Verify a sending domain you control with that provider.
3. Publish the provider's required SPF and DKIM DNS records; add DMARC for the domain.
4. Obtain SMTP host, port, username, password, and a sender address on the verified domain.
5. Open [Supabase Auth SMTP settings](https://supabase.com/dashboard/project/pkadftvqslkykehcqedj/auth/smtp).
6. Enable custom SMTP and enter the provider's values. Use the provider's recommended TLS/STARTTLS port and settings.
7. Set a sender name such as `Murmur` and a sender address such as `no-reply@auth.your-domain`.
8. Save the settings and review Supabase Auth logs and the provider's delivery/bounce logs.

Do not commit SMTP credentials or send them in chat. Enter them only into the Supabase dashboard's secret fields.

## 4. Email templates

In [Supabase Email Templates](https://supabase.com/dashboard/project/pkadftvqslkykehcqedj/auth/templates), review:

- Confirm signup
- Reset password
- Change email address
- Magic link (if enabled)

Use Supabase's `{{ .ConfirmationURL }}` in the confirmation and recovery templates unless you have deliberately built a custom token-verification route. Keep the links intact. If a custom template constructs a redirect itself, make sure it follows Supabase's current Redirect URL guidance and uses the intended redirect target safely.

Keep authentication emails short and transactional. Disable click-tracking/link rewriting for authentication messages at the email provider because it can break verification links.

## 5. Required verification tests

Use a real mailbox that you control and a separate Google account you control.

- [ ] Email signup creates a Supabase Auth user and sends a confirmation email.
- [ ] Confirmation link opens Murmur at `https://murmur-app-7jm.pages.dev/` and the session is established.
- [ ] An unconfirmed password login is rejected and exposes the resend-confirmation action.
- [ ] Resend confirmation returns a generic success message and a new email arrives.
- [ ] Password recovery email arrives and its link opens Murmur's password-reset flow.
- [ ] Google sign-in opens Google's account chooser, returns through the Supabase callback, and signs the user into Murmur.
- [ ] Google-created user receives a Murmur profile with the Google name/avatar metadata.
- [ ] A wrong redirect URI is rejected; production redirects remain on the Murmur origin.
- [ ] Check Supabase Auth logs and SMTP-provider events for accepted, delivered, bounced, or rejected messages.

Do not treat a successful API response as proof of inbox delivery. Verify receipt in the mailbox and the provider's delivery events. Check spam/junk as well.

## 6. Current implementation status

The web client already uses Supabase PKCE auth and includes the Google OAuth sign-in call. The application code has been updated to:

- expose a resend-confirmation action after signup;
- show the resend action when password login reports an unconfirmed email;
- use the Murmur origin as the redirect target;
- surface OAuth callback error details returned by Supabase.

Provider enablement, Google credentials, SMTP credentials, DNS authentication, and real mailbox delivery must still be completed in the external dashboards before the flow can be declared verified.
