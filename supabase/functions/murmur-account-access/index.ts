import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function normalizedStatus(status: string) {
  if (status === "terminated" || status === "termination") return "terminated";
  if (status === "ban" || status === "banned") return "banned";
  if (status === "deleted") return "deleted";
  if (status === "scheduled_deletion") return "scheduled_deletion";
  return "suspended";
}

function notice(restriction: {
  id: string;
  restriction_id?: string | null;
  case_id?: string | null;
  status: string;
  reason?: string | null;
  reason_code?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  scheduled_delete_at?: string | null;
  appealable?: boolean;
}) {
  const status = normalizedStatus(restriction.status);
  return {
    id: restriction.id,
    restriction_id: restriction.restriction_id || null,
    case_id: restriction.case_id || restriction.id,
    status,
    reason: restriction.reason || "This account is restricted by Murmur Admin.",
    policy: restriction.reason_code || null,
    date: restriction.starts_at || null,
    starts_at: restriction.starts_at || null,
    ends_at: restriction.ends_at || null,
    endsOn: restriction.ends_at || null,
    exportBy: status === "terminated" ? (restriction.scheduled_delete_at || null) : null,
    restoreBy: status === "deleted" || status === "scheduled_deletion"
      ? (restriction.scheduled_delete_at || null)
      : null,
    appealable: restriction.appealable !== false,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed." });

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) {
      console.error("[murmur-account-access] required server secrets are missing");
      return json(503, { error: "Secure account verification is not configured." });
    }

    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return json(401, { error: "A valid Murmur sign-in is required." });

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return json(401, { error: "Your Murmur session is invalid or expired." });

    const now = new Date().toISOString();
    const userId = authData.user.id;
    const { data: restriction, error } = await admin
      .from("account_restrictions")
      .select("id,status,reason_code,reason,starts_at,ends_at,scheduled_delete_at,created_at")
      .eq("user_id", userId)
      .in("status", ["suspended", "banned", "ban", "terminated", "termination", "scheduled_deletion", "deleted"])
      .is("lifted_at", null)
      .lte("starts_at", now)
      .or("ends_at.is.null,ends_at.gt." + now)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[murmur-account-access] restriction lookup failed", error);
      return json(503, { error: "Murmur could not verify account restrictions. Sign-in is blocked." });
    }

    if (restriction) {
      const { data: linkedCase, error: linkedCaseError } = await admin
        .from("moderation_actions")
        .select("id,type,appealable,created_at")
        .eq("restriction_id", restriction.id)
        .eq("user_id", userId)
        .maybeSingle();
      if (linkedCaseError) {
        console.error("[murmur-account-access] linked case lookup failed", linkedCaseError);
        return json(503, { error: "Murmur could not verify the moderation case. Sign-in is blocked." });
      }
      const result = notice({
        ...restriction,
        id: restriction.id,
        restriction_id: restriction.id,
        case_id: linkedCase?.id || restriction.id,
        status: linkedCase?.type || restriction.status,
        starts_at: restriction.starts_at || linkedCase?.created_at || restriction.created_at,
        appealable: linkedCase ? linkedCase.appealable : restriction.status !== "terminated",
      });
      return json(200, { allowed: false, restriction: result });
    }

    // Legacy profile-level suspension records are checked as a second source of truth.
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,is_suspended,suspension_reason")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("[murmur-account-access] profile restriction lookup failed", profileError);
      return json(503, { error: "Murmur could not verify the account profile status. Sign-in is blocked." });
    }

    if (profile?.is_suspended === true) {
      return json(200, {
        allowed: false,
        restriction: notice({
          id: "profile-restriction-" + userId,
          case_id: "profile-restriction-" + userId,
          status: "suspended",
          reason: profile.suspension_reason || "This account is suspended by Murmur Admin.",
          appealable: true,
        }),
      });
    }

    const { data: moderationCase, error: moderationError } = await admin
      .from("moderation_actions")
      .select("id,type,reason,expires_at,appealable,created_at,restriction_id")
      .eq("user_id", userId)
      .in("type", ["suspension", "ban", "termination"])
      .is("revoked_at", null)
      .or("expires_at.is.null,expires_at.gt." + now)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (moderationError) {
      console.error("[murmur-account-access] moderation lookup failed", moderationError);
      return json(503, { error: "Murmur could not verify moderation cases. Sign-in is blocked." });
    }

    if (moderationCase) {
      return json(200, {
        allowed: false,
        restriction: notice({
          id: moderationCase.id,
          restriction_id: moderationCase.restriction_id,
          case_id: moderationCase.id,
          status: moderationCase.type,
          reason: moderationCase.reason,
          starts_at: moderationCase.created_at,
          ends_at: moderationCase.expires_at,
          appealable: moderationCase.appealable,
        }),
      });
    }

    // Supabase Auth ban metadata is an independent backstop.
    const bannedUntil = authData.user.banned_until ? new Date(authData.user.banned_until).getTime() : 0;
    if (Number.isFinite(bannedUntil) && bannedUntil > Date.now()) {
      return json(200, {
        allowed: false,
        restriction: notice({
          id: "auth-ban-" + userId,
          case_id: "auth-ban-" + userId,
          status: "banned",
          reason: "This account is banned by Murmur Admin.",
          starts_at: null,
          ends_at: authData.user.banned_until,
          appealable: true,
        }),
      });
    }

    return json(200, { allowed: true });
  } catch (error) {
    console.error("[murmur-account-access] unexpected error", error);
    return json(503, { error: "Murmur could not verify account access. Sign-in is blocked." });
  }
});