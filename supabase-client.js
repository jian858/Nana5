/* Murmur Supabase client — public browser configuration only.
   Never put a service-role key in this file. */
// Load the Supabase SDK from two independent CDNs in parallel. A stalled CDN
// must not prevent the login screen from starting on slower mobile connections.
async function importWithTimeout(url, label) {
  return Promise.race([
    import(url),
    new Promise((_, reject) => setTimeout(() => reject(new Error(label + " did not respond in time")), 7000))
  ]);
}
let supabaseSdk;
try {
  supabaseSdk = await Promise.any([
    importWithTimeout("https://esm.sh/@supabase/supabase-js@2.117.3", "Primary Supabase CDN"),
    importWithTimeout("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm", "Backup Supabase CDN")
  ]);
} catch (error) {
  console.error("[Murmur SDK load]", error);
  throw new Error("Murmur could not load its secure connection library. Check your internet connection, then reload.");
}
const { createClient } = supabaseSdk;

const SUPABASE_URL = "https://pkadftvqslkykehcqedj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_etoHiUGbJ96MUPzJABL12A_UiTWVxok";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce"
  },
  realtime: {
    params: { eventsPerSecond: 10 }
  }
});

export async function requireUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    const message = String(error.message || "");
    const code = String(error.code || "");
    const invalidJwt = code === "bad_jwt" || /invalid JWT|token signature is invalid|signing method RS256 is invalid/i.test(message);
    const invalidRefresh = code === "refresh_token_not_found" ||
      /invalid refresh token|refresh token.*(not found|invalid|already used)/i.test(message);
    if (invalidJwt || invalidRefresh) {
      // Clear only the broken Supabase Auth session; keep Murmur profile/offline data intact.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      throw new Error("Your saved sign-in session expired. Please sign in again with your Murmur account.");
    }
    throw error;
  }
  if (!data.user) throw new Error("Please sign in to continue.");
  return data.user;
}

export async function consumeManualRefresh() {
  await requireUser();
  const { data, error } = await supabase.rpc("consume_murmur_manual_refresh");
  if (error) throw error;
  if (!data?.allowed) {
    const seconds = Math.max(0, Number(data?.retry_after_seconds || 0));
    const minutes = Math.ceil(seconds / 60);
    throw new Error("You can refresh once every five minutes. Try again in " + minutes + " minute(s).");
  }
  return data;
}

export function getPublicConfig() {
  return Object.freeze({ url: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY });
}

// Expose the same configured client to the legacy classic-script modules.
window.murmurSupabase = supabase;
window.dispatchEvent(new Event("murmur:supabase-client-ready"));


/* First-party Murmur account API. All credentials and sessions belong to Supabase Auth. */
async function murmurSupabaseSignUp({ email, password, profile = {} }) {
  const { data, error } = await supabase.auth.signUp({
    email: String(email || "").trim().toLowerCase(),
    password,
    options: {
      data: {
        full_name: String(profile.name || profile.display_name || "").trim(),
        username: String(profile.username || "").replace(/^@/, "").trim().toLowerCase(),
        avatar_url: profile.photo || profile.avatar_url || ""
      },
      emailRedirectTo: window.location.origin + "/"
    }
  });
  if (error) throw error;
  if (data.user && data.session) {
    const saved = await murmurSupabaseSaveProfile(data.user, profile);
    if (saved.error) throw saved.error;
  }
  return data;
}

async function murmurSupabaseSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(email || "").trim().toLowerCase(), password
  });
  if (error) throw error;
  return data;
}

async function murmurSupabaseGoogleSignIn() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin + "/", queryParams: { prompt: "select_account" } }
  });
  if (error) throw error;
  return data;
}

async function murmurSupabaseSaveProfile(user, profile = {}) {
  if (!user?.id) throw new Error("A signed-in Murmur account is required.");
  const interests = Array.isArray(profile.interests) ? profile.interests : [];
  const username = String(profile.username || "").replace(/^@/, "").trim().toLowerCase();
  const payload = {
    id: user.id,
    display_name: String(profile.name || profile.display_name || user.user_metadata?.full_name || "").trim(),
    bio: String(profile.bio || "").slice(0, 240),
    school: String(profile.school || "").slice(0, 100),
    location: String(profile.location || "").slice(0, 100),
    work: String(profile.work || "").slice(0, 100),
    hometown: String(profile.hometown || "").slice(0, 100),
    phone: String(profile.phone || "").slice(0, 30),
    birthday: profile.birthday || null,
    gender: String(profile.gender || "").slice(0, 40),
    role: String(profile.role || "").slice(0, 80),
    interests,
    avatar_url: profile.photo || profile.avatar_url || null,
    cover_url: profile.cover || profile.cover_url || null,
    updated_at: new Date().toISOString()
  };
  if (username) payload.username = username;
  const { data, error } = await supabase.from("profiles").upsert(payload, { onConflict: "id" }).select().single();
  return { data, error };
}

async function murmurSupabaseGetProfile(userId) {
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function murmurSupabaseResetPassword(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    String(email || "").trim().toLowerCase(),
    { redirectTo: window.location.origin + "/?password-reset=1" }
  );
  if (error) throw error;
}

async function murmurSupabaseUpdatePassword(password) {
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  return data;
}

window.MurmurSupabaseAuth = Object.freeze({
  client: supabase,
  signUp: murmurSupabaseSignUp,
  signIn: murmurSupabaseSignIn,
  signInWithGoogle: murmurSupabaseGoogleSignIn,
  saveProfile: murmurSupabaseSaveProfile,
  getProfile: murmurSupabaseGetProfile,
  resetPassword: murmurSupabaseResetPassword,
  updatePassword: murmurSupabaseUpdatePassword,
  signOut: () => supabase.auth.signOut(),
  onAuthStateChange: callback => supabase.auth.onAuthStateChange(callback)
});
