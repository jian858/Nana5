/* Murmur feature loader
 * Loads ordered classic scripts after Firebase's module has initialized.
 * Classic scripts share the page's global lexical scope, preserving the
 * existing cross-feature functions and state while keeping files separate.
 */
const MURMUR_FEATURE_FILES = ["app.js","home-feed.js","friends.js","chat.js","alerts.js","presence.js","navigation.js","registration.js","login.js","google-auth.js","password-reset.js","legal.js","stories.js","comments.js","post-composer.js","notes.js","session.js","reels.js","menu.js","profile.js","profile-editor.js","messaging.js","account-recovery.js","blocking.js","security.js"];
async function loadMurmurScript(src) {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error("Could not load Murmur file: " + src));
    document.body.appendChild(script);
  });
}
(async function startMurmurFeatureFiles() {
  try {
    for (const file of MURMUR_FEATURE_FILES) {
      await loadMurmurScript("./" + file + "?v=20261121-23");
    }
    await loadMurmurScript("./pwa.js?v=20261102-2");
  } catch (error) {
    console.error("[Murmur loader]", error);
    const splash = document.getElementById("splash");
    if (splash) {
      splash.textContent = "Murmur could not load. Please refresh and try again.";
      splash.setAttribute("role", "alert");
    }
  }
})();
