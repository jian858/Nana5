# Murmur app permissions

The App permissions screen is implemented in `supabase-app.js` and opened from Menu → Settings & privacy → App permissions.

## Permission behavior

- **Notifications:** uses `Notification.requestPermission()` on HTTPS.
- **Camera and microphone:** calls `navigator.mediaDevices.getUserMedia()` only after the user presses the matching button. Any acquired media tracks are stopped immediately; opening the settings screen does not activate either device.
- **Location:** calls `navigator.geolocation.getCurrentPosition()` only after the user presses Allow location. The returned coordinates are discarded and are not stored or transmitted by this settings action.
- **Photos and files:** uses the browser file picker. The browser grants access only to files the user selects; this is not a persistent, app-wide permission. The settings action does not upload selected files.
- **Contacts:** uses the platform Contact Picker API where available. The user chooses individual contacts; this settings action discards the returned selection and does not save or transmit it. Browsers without the API show it as unsupported.

## Privacy and platform limits

- Permission prompts require a secure context (HTTPS) and a direct user gesture.
- The Permissions API is used to display current browser permission states where supported. If a browser cannot report a state, Murmur displays an on-use status rather than claiming permission was granted.
- A denied permission may need to be re-enabled in the browser or device site settings.
- A PWA cannot silently grant Android system permissions. The browser/OS owns the prompt and final permission state.
- Notification permission alone does not configure push subscriptions or guarantee that every in-app alert is delivered as a system notification.

## Verification still required

Test on a real Android device and desktop browser:
1. Open Menu → Settings & privacy → App permissions. Confirm no device permission prompt appears automatically.
2. Grant and deny camera, microphone, location and notifications individually; confirm the displayed status refreshes.
3. Confirm camera and microphone tracks stop immediately after the grant test.
4. Confirm the location test does not save or send coordinates.
5. Select a file and a contact; confirm the screen states that neither selection was uploaded or saved.
6. Revoke permissions in browser site settings and reopen the Murmur screen to confirm the status refreshes.

Browser/device integration tests have not been run by the code change alone.
