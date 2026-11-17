# Password-reset session revocation

Murmur keeps Firebase Authentication as the password provider and keeps the separate Supabase/Murmur account ID unchanged.

## Required Firebase Console setup

The custom reset handler must be used by Firebase's password-reset emails. Otherwise Firebase's default hosted action page changes the password without writing Murmur's database revocation marker.

1. Open Firebase Console for project `murmur-fc430`.
2. Go to **Authentication → Settings → Authorized domains** and make sure `murmurrr.vercel.app` is listed.
3. Go to **Authentication → Templates → Password reset**.
4. Open the action URL customization control and set the action handler URL to:
   `https://murmurrr.vercel.app/reset-password.html`
5. Save the template. Send a new password-reset email and verify that its link opens the Murmur reset page with the reset code.

## What the handler does

- Verifies the Firebase password-reset code.
- Applies the new password through Firebase Authentication.
- Signs in once with the new password to obtain its Firebase `auth_time`.
- Writes `security/{firebaseUid}/minAuthTime` using that signed-in token.
- Signs out the reset device.

Realtime Database rules compare every protected read/write token's `auth_time` with that marker. Older sessions are denied even if their browser still displays a cached signed-in screen. The marker can only move forward, and a client can only set it to the `auth_time` in its own verified Firebase token.

## Important deployment notes

- Publish `database.rules.json` to **Firebase Realtime Database → Rules** after reviewing it. GitHub/Vercel deployment does not publish Firebase rules.
- Deploy the GitHub change to Vercel so `reset-password.html` is live.
- Test with two devices: sign in on both, reset the password from one device using a new reset email, then verify that the other device cannot read/write posts, comments, chats, or other protected Realtime Database paths. It must sign in again with the new password.
- Existing accounts without a `security/{uid}/minAuthTime` marker keep their current behavior until that account completes a password reset through this custom handler.
- Firebase Storage has its own separate rules. This change protects Realtime Database access (including feed posts and chats); review Storage rules separately if old sessions must also be blocked from uploads/downloads.
