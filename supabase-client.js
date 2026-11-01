/* Murmur Supabase client — public browser configuration only.
   Never put a service-role key in this file. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  if (error) throw error;
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
