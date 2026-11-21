/* Deprecated compatibility entry point.
 * The live index loads supabase-app.js directly. This file intentionally never
 * loads any retired legacy feature scripts.
 */
import("./supabase-app.js").catch(error => {
  console.error("[Murmur Supabase loader]", error);
  const splash = document.getElementById("splash");
  if (splash) {
    splash.textContent = "Murmur could not load. Please refresh and try again.";
    splash.setAttribute("role", "alert");
  }
});
