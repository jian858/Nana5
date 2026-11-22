import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}
const makeDb = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Server configuration is incomplete.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};
async function rateLimit(db: ReturnType<typeof makeDb>, key: string, limit: number) {
  const { data, error } = await db.rpc("consume_edge_rate_limit", {
    p_key: key, p_limit: limit, p_window_seconds: 300,
  });
  if (error) throw error;
  return data === true;
}
async function audit(db: ReturnType<typeof makeDb>, adminId: string, action: string, targetUserId: string | null, reason = "", metadata = {}) {
  const { error } = await db.from("admin_audit_log").insert({
    admin_id: adminId, action, target_user_id: targetUserId, reason, metadata,
  });
  if (error) throw error;
}

async function notifyAccountRecovered(db: ReturnType<typeof makeDb>, userId: string, caseId: string | null = null) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data: recent, error: recentError } = await db.from("notifications")
    .select("id")
    .eq("recipient_id", userId)
    .eq("kind", "account_recovered")
    .gte("created_at", since)
    .limit(1);
  if (recentError) throw recentError;
  if (recent?.length) return;

  const restoredAt = new Date();
  const when = restoredAt.toLocaleString("en-US", {
    timeZone: "UTC", dateStyle: "long", timeStyle: "short"
  });
  const caseText = caseId ? " Case ID: " + caseId : "";
  const { error } = await db.from("notifications").insert({
    recipient_id: userId,
    actor_id: null,
    kind: "account_recovered",
    entity_id: caseId,
    content: "Your Murmur account was restored on " + when +
      " UTC. All account restrictions have been lifted, and you can now sign in and use Murmur again." + caseText
  });
  if (error) throw error;
}
async function recordModerationCase(
  db: ReturnType<typeof makeDb>,
  adminId: string,
  targetUserId: string,
  type: "suspension" | "ban" | "termination",
  reason: string,
  restrictionId: string,
  expiresAt: string | null
) {
  const { data, error } = await db.from("moderation_actions").insert({
    user_id: targetUserId,
    type,
    reason,
    expires_at: expiresAt,
    appealable: type !== "termination",
    issued_by: adminId,
    restriction_id: restrictionId,
  }).select("id").single();
  if (error) throw error;
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed." });
  try {
    const db = makeDb();
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return reply(401, { error: "Sign in with your Supabase admin account." });
    const { data: authData, error: authError } = await db.auth.getUser(token);
    const user = authData.user;
    if (authError || !user) return reply(401, { error: "Your Supabase session is invalid or expired." });

    const ip = (req.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 80);
    if (!await rateLimit(db, "murmur-admin-ip:" + ip, 100) ||
        !await rateLimit(db, "murmur-admin-user:" + user.id, 60)) {
      return new Response(JSON.stringify({ error: "Too many requests. Try again in five minutes." }), {
        status: 429, headers: { ...cors, "Retry-After": "300" },
      });
    }

    const { data: admin, error: adminError } = await db.from("murmur_admin_allowlist")
      .select("user_id,email,role,enabled").eq("user_id", user.id).eq("enabled", true).maybeSingle();
    if (adminError) throw adminError;
    if (!admin || admin.email?.toLowerCase() !== user.email?.toLowerCase()) {
      return reply(403, { error: "This Supabase account is not authorized as a Murmur administrator." });
    }
    // Full dashboard control is reserved for the explicitly enabled super_admin role.
    if (admin.role !== "super_admin") {
      return reply(403, { error: "Super Admin permission is required for this control panel." });
    }

    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "overview";

    if (action === "refresh") {
      const { data, error } = await db.rpc("consume_murmur_manual_refresh_for_user", {
        p_user_id: user.id,
      });
      if (error) throw error;
      return reply(200, data || { allowed: false, retry_after_seconds: 0 });
    }

    if (action === "overview") {
      const tables = ["profiles", "posts", "messages", "reports", "comments", "stories", "reels", "account_appeals"];
      const counts = await Promise.all(tables.map(async (table) => {
        const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
        if (error) throw error;
        return [table, count || 0] as const;
      }));
      return reply(200, { admin: { id: user.id, email: user.email, role: admin.role }, counts: Object.fromEntries(counts) });
    }

    if (action === "identities") {
      return reply(410, { error: "The legacy identity view has been retired. Use the Supabase UUID and Murmur public ID in the Users section." });
    }

    if (action === "users") {
      const page = Number.isInteger(body.page) ? Math.max(1, Math.min(body.page, 100000)) : 1;
      const pageSize = 50;
      const from = (page - 1) * pageSize;
      const search = typeof body.q === "string" ? body.q.trim().slice(0, 80) : "";
      const status = ["all","active","suspended"].includes(body.status) ? body.status : "all";
      let usersQuery = db.from("profiles")
        .select("id,public_id,username,display_name,bio,avatar_url,created_at,is_suspended,suspension_reason,is_verified", { count: "exact" });
      if (search) {
        if (search.includes("@")) {
          const { data: authUsers, error: authUsersError } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
          if (authUsersError) throw authUsersError;
          const match = (authUsers.users || []).find((candidate: any) => (candidate.email || "").toLowerCase() === search.toLowerCase());
          if (!match) return reply(200, { users: [], page, page_size: pageSize, total: 0, total_pages: 1 });
          usersQuery = usersQuery.eq("id", match.id);
        } else if (/^[0-9a-f-]{36}$/i.test(search)) usersQuery = usersQuery.eq("id", search);
        else {
          const safeSearch = search.replace(/[^a-zA-Z0-9 _.-]/g, " ").trim().slice(0, 80);
          if (safeSearch) usersQuery = usersQuery.or("username.ilike.%"+safeSearch+"%,display_name.ilike.%"+safeSearch+"%,public_id.ilike.%"+safeSearch+"%");
        }
      }
      if (status === "active") usersQuery = usersQuery.eq("is_suspended", false);
      if (status === "suspended") usersQuery = usersQuery.eq("is_suspended", true);
      const { data, error, count } = await usersQuery
        .order("created_at", { ascending: false }).order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const total = count || 0;
      const users = await Promise.all((data || []).map(async (profile: any) => {
        const [{ data: authResult, error: authLookupError }, { data: terminated, error: restrictionError }] = await Promise.all([
          db.auth.admin.getUserById(profile.id),
          db.from("account_restrictions").select("id").eq("user_id", profile.id).eq("status", "terminated").limit(1).maybeSingle()
        ]);
        if (authLookupError) throw authLookupError;
        if (restrictionError) throw restrictionError;
        const bannedUntil = authResult.user?.banned_until || null;
        return { ...profile, email: authResult.user?.email || null, is_terminated: !!terminated, is_banned: !!bannedUntil && new Date(bannedUntil).getTime() > Date.now(), banned_until: bannedUntil };
      }));
      return reply(200, { users, page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) });
    }

    if (action === "set_user_verified") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const verified = body.verified === true;
      if (!userId || userId === user.id) return reply(400, { error: "Choose a valid account. You cannot change your own admin badge here." });
      const { data, error } = await db.from("profiles")
        .update({ is_verified: verified, updated_at: new Date().toISOString() })
        .eq("id", userId).select("id,is_verified").maybeSingle();
      if (error) throw error;
      if (!data) return reply(404, { error: "User profile not found." });
      await audit(db, user.id, verified ? "verify_user" : "unverify_user", userId,
        verified ? "Granted official Verified by Murmur badge" : "Removed Verified by Murmur badge",
        { is_verified: verified });
      return reply(200, { ok: true, user: data });
    }

    if (action === "ban_user") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const reasonCode = typeof body.reason_code === "string" ? body.reason_code : "";
      const allowed = ["spam","harassment","hate_speech","impersonation","fraud","sexual_content","violence","child_safety","repeated_violations","other"];
      const policyHours: Record<string, number> = { spam: 24, harassment: 72, hate_speech: 168, impersonation: 168, fraud: 720, sexual_content: 168, violence: 720, child_safety: 876000, repeated_violations: 720, other: 24 };
      const reasonLabels: Record<string, string> = { spam: "Spam or fake engagement", harassment: "Harassment or bullying", hate_speech: "Hate speech or discriminatory content", impersonation: "Impersonation", fraud: "Scams or fraud", sexual_content: "Sexual or explicit content", violence: "Violence or threats", child_safety: "Child safety concern", repeated_violations: "Repeated policy violations", other: "Other policy violation" };
      const hours = policyHours[reasonCode] || 0;
      const reason = "Automated moderation: " + (reasonLabels[reasonCode] || "Policy violation") + ".";
      if (!userId || userId === user.id) return reply(400, { error: "Choose a valid user. You cannot ban your own admin account." });
      if (!reason || !allowed.includes(reasonCode) || !Number.isFinite(hours) || hours <= 0 || hours > 876000) return reply(400, { error: "Choose a valid ban duration and one of the approved reasons." });
      const { data: targetAdmin, error: targetAdminError } = await db.from("murmur_admin_allowlist").select("user_id").eq("user_id", userId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply(400, { error: "Administrator accounts cannot be banned here." });
      const { data: terminated, error: terminatedError } = await db.from("account_restrictions").select("id").eq("user_id", userId).eq("status", "terminated").limit(1).maybeSingle();
      if (terminatedError) throw terminatedError;
      if (terminated) return reply(409, { error: "This account is already terminated." });
      const now = new Date();
      const nowIso = now.toISOString();
      const endsAt = new Date(now.getTime() + hours * 3600000).toISOString();
      const { data: authResult, error: authError } = await db.auth.admin.updateUserById(userId, { ban_duration: hours >= 876000 ? "876000h" : hours + "h" });
      if (authError || !authResult?.user) return reply(400, { error: authError?.message || "Supabase Auth could not apply the ban." });
      const { error: liftError } = await db.from("account_restrictions").update({ status: "lifted", lifted_at: nowIso }).eq("user_id", userId).in("status", ["suspended","scheduled_deletion"]);
      if (liftError) throw liftError;
      const { data: restriction, error: restrictionError } = await db.from("account_restrictions").insert({
        user_id: userId, status: "suspended", reason_code: reasonCode, reason,
        starts_at: nowIso, ends_at: endsAt, created_by: user.id
      }).select("id").single();
      if (restrictionError) throw restrictionError;
      await recordModerationCase(db, user.id, userId, "ban", reason, restriction.id, endsAt);
      const { data: profile, error: profileError } = await db.from("profiles").update({
        is_suspended: true, suspension_reason: reason, updated_at: nowIso
      }).eq("id", userId).select("id").maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return reply(404, { error: "User profile not found; no profile restriction was saved." });
      await audit(db, user.id, "ban_user", userId, reason, { reason_code: reasonCode, duration_hours: hours, ends_at: endsAt });
      return reply(200, { ok: true, banned: true, ends_at: endsAt });
    }

    if (action === "unban_user") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      if (!userId || userId === user.id) return reply(400, { error: "Choose a valid user." });
      const { data: targetAdmin, error: targetAdminError } = await db.from("murmur_admin_allowlist").select("user_id").eq("user_id", userId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply(400, { error: "Administrator accounts cannot be changed here." });
      const { data: terminated, error: terminatedError } = await db.from("account_restrictions").select("id").eq("user_id", userId).eq("status", "terminated").limit(1).maybeSingle();
      if (terminatedError) throw terminatedError;
      if (terminated) return reply(409, { error: "A terminated account cannot be restored using Unban." });
      const nowIso = new Date().toISOString();
      const { error: moderationLiftError } = await db.from("moderation_actions").update({ revoked_at: nowIso })
        .eq("user_id", userId).in("type", ["suspension","ban"]).is("revoked_at", null);
      if (moderationLiftError) throw moderationLiftError;
      const { error: restrictionError } = await db.from("account_restrictions").update({ status: "lifted", lifted_at: nowIso }).eq("user_id", userId).eq("status", "suspended");
      if (restrictionError) throw restrictionError;
      const { error: profileError } = await db.from("profiles").update({
        is_suspended: false, suspension_reason: null, updated_at: nowIso
      }).eq("id", userId);
      if (profileError) throw profileError;
      const { error: authError } = await db.auth.admin.updateUserById(userId, { ban_duration: "none" });
      if (authError) return reply(400, { error: authError.message || "The app restriction was removed, but Supabase Auth could not clear the ban." });
      const [{ data: remainingRestrictions, error: remainingRestrictionsError }, { data: remainingActions, error: remainingActionsError }] = await Promise.all([
        db.from("account_restrictions").select("id").eq("user_id", userId).is("lifted_at", null)
          .in("status", ["suspended","terminated","scheduled_deletion","deleted"]).lte("starts_at", nowIso)
          .or("ends_at.is.null,ends_at.gt." + nowIso).limit(1),
        db.from("moderation_actions").select("id").eq("user_id", userId).is("revoked_at", null)
          .in("type", ["suspension","ban","termination"]).or("expires_at.is.null,expires_at.gt." + nowIso).limit(1)
      ]);
      if (remainingRestrictionsError) throw remainingRestrictionsError;
      if (remainingActionsError) throw remainingActionsError;
      if (!remainingRestrictions?.length && !remainingActions?.length) {
        // The database trigger handles restriction rows; this also covers legacy ban-only cases.
        await notifyAccountRecovered(db, userId);
      }
      await audit(db, user.id, "unban_user", userId, "Removed account ban and app restriction");
      return reply(200, { ok: true });
    }

    if (action === "delete_user") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      if (!userId || userId === user.id || body.confirm !== "DELETE") return reply(400, { error: "A valid target and DELETE confirmation are required." });
      const { data: targetAdmin, error: targetAdminError } = await db.from("murmur_admin_allowlist").select("user_id").eq("user_id", userId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply(400, { error: "Administrator accounts cannot be terminated here." });
      const { data: target, error: targetError } = await db.auth.admin.getUserById(userId);
      if (targetError || !target.user) return reply(404, { error: "Auth user not found." });
      const { data: existing, error: existingError } = await db.from("account_restrictions").select("id").eq("user_id", userId).eq("status", "terminated").limit(1).maybeSingle();
      if (existingError) throw existingError;
      if (existing) return reply(409, { error: "This account is already terminated." });
      const nowIso = new Date().toISOString();
      const reasonCode = typeof body.reason_code === "string" ? body.reason_code : "other";
      const policyHours: Record<string, number> = { spam: 24, harassment: 72, hate_speech: 168, impersonation: 168, fraud: 720, sexual_content: 168, violence: 720, child_safety: 876000, repeated_violations: 720, other: 24 };
      const reasonLabels: Record<string, string> = { spam: "Spam or fake engagement", harassment: "Harassment or bullying", hate_speech: "Hate speech or discriminatory content", impersonation: "Impersonation", fraud: "Scams or fraud", sexual_content: "Sexual or explicit content", violence: "Violence or threats", child_safety: "Child safety concern", repeated_violations: "Repeated policy violations", other: "Other policy violation" };
      if (!Object.prototype.hasOwnProperty.call(reasonLabels, reasonCode)) return reply(400, { error: "Choose a valid termination reason." });
      const reason = "Permanently terminated by Murmur Admin. Reason: " + reasonLabels[reasonCode] + ".";
      const { error: authError } = await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (authError) return reply(400, { error: authError.message || "Supabase Auth could not disable this account." });
      const { error: liftError } = await db.from("account_restrictions").update({ status: "lifted", lifted_at: nowIso }).eq("user_id", userId).in("status", ["suspended","scheduled_deletion"]);
      if (liftError) throw liftError;
      const { data: restriction, error: restrictionError } = await db.from("account_restrictions").insert({
        user_id: userId, status: "terminated", reason_code: reasonCode, reason,
        starts_at: nowIso, created_by: user.id
      }).select("id").single();
      if (restrictionError) throw restrictionError;
      await recordModerationCase(db, user.id, userId, "termination", reason, restriction.id, null);
      const { data: profile, error: profileError } = await db.from("profiles").update({
        is_suspended: true, suspension_reason: reason, updated_at: nowIso
      }).eq("id", userId).select("id").maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return reply(404, { error: "User profile not found." });
      await audit(db, user.id, "terminate_user", userId, reason, { preserves_content_for_audit: true });
      return reply(200, { ok: true, terminated: true });
    }

    if (action === "set_user_status") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const suspended = body.suspended === true;
      const reasonCode = typeof body.reason_code === "string" ? body.reason_code : "";
      const allowed = ["spam","harassment","hate_speech","impersonation","fraud","sexual_content","violence","child_safety","repeated_violations","other"];
      const policyHours: Record<string, number> = { spam: 24, harassment: 72, hate_speech: 168, impersonation: 168, fraud: 720, sexual_content: 168, violence: 720, child_safety: 8760, repeated_violations: 720, other: 24 };
      const reasonLabels: Record<string, string> = { spam: "Spam or fake engagement", harassment: "Harassment or bullying", hate_speech: "Hate speech or discriminatory content", impersonation: "Impersonation", fraud: "Scams or fraud", sexual_content: "Sexual or explicit content", violence: "Violence or threats", child_safety: "Child safety concern", repeated_violations: "Repeated policy violations", other: "Other policy violation" };
      const hours = policyHours[reasonCode] || null;
      const reason = "Automated moderation: " + (reasonLabels[reasonCode] || "Policy violation") + ".";
      if (!userId || userId === user.id) return reply(400, { error: "Choose a valid user." });
      const { data: targetAdmin, error: targetAdminError } = await db.from("murmur_admin_allowlist").select("user_id").eq("user_id", userId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply(400, { error: "Administrator accounts cannot be changed here." });
      const { data: terminated, error: terminatedError } = await db.from("account_restrictions").select("id").eq("user_id", userId).eq("status", "terminated").limit(1).maybeSingle();
      if (terminatedError) throw terminatedError;
      if (terminated) return reply(409, { error: "A terminated account cannot be restored or suspended again." });
      const nowIso = new Date().toISOString();
      if (suspended) {
        if (!reason || !allowed.includes(reasonCode) || !Number.isFinite(hours) || hours! <= 0 || hours! > 8760) {
          return reply(400, { error: "A valid reason and suspension duration between 1 and 8760 hours are required." });
        }
        const { error: authError } = await db.auth.admin.updateUserById(userId, { ban_duration: hours + "h" });
        if (authError) return reply(400, { error: authError.message || "Supabase Auth could not suspend this account." });
        const { error: liftError } = await db.from("account_restrictions").update({ status: "lifted", lifted_at: nowIso }).eq("user_id", userId).eq("status", "suspended");
        if (liftError) throw liftError;
        const suspensionEndsAt = new Date(Date.now() + hours! * 3600000).toISOString();
        const { data: restriction, error: insertError } = await db.from("account_restrictions").insert({
          user_id: userId, status: "suspended", reason_code: reasonCode, reason,
          starts_at: nowIso, ends_at: suspensionEndsAt, created_by: user.id
        }).select("id").single();
        if (insertError) throw insertError;
        await recordModerationCase(db, user.id, userId, "suspension", reason, restriction.id, suspensionEndsAt);
        const { data: profile, error: profileError } = await db.from("profiles").update({
          is_suspended: true, suspension_reason: reason, updated_at: nowIso
        }).eq("id", userId).select("id").maybeSingle();
        if (profileError) throw profileError;
        if (!profile) return reply(404, { error: "User profile not found." });
        await audit(db, user.id, "suspend_user", userId, reason, { reason_code: reasonCode, duration_hours: hours });
        return reply(200, { ok: true, suspended: true });
      }
      const { error: moderationLiftError } = await db.from("moderation_actions").update({ revoked_at: nowIso })
        .eq("user_id", userId).in("type", ["suspension","ban"]).is("revoked_at", null);
      if (moderationLiftError) throw moderationLiftError;
      const { error: authError } = await db.auth.admin.updateUserById(userId, { ban_duration: "none" });
      if (authError) return reply(400, { error: authError.message || "Supabase Auth could not restore this account." });
      const { error: liftError } = await db.from("account_restrictions").update({ status: "lifted", lifted_at: nowIso })
        .eq("user_id", userId).in("status", ["suspended","scheduled_deletion"]);
      if (liftError) throw liftError;
      const { data: profile, error: profileError } = await db.from("profiles").update({
        is_suspended: false, suspension_reason: null, updated_at: nowIso
      }).eq("id", userId).select("id").maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return reply(404, { error: "User profile not found." });
      await audit(db, user.id, "restore_user", userId, "Removed account suspension");
      return reply(200, { ok: true, suspended: false });
    }

    if (action === "schedule_delete") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const reasonCode = typeof body.reason_code === "string" ? body.reason_code : "";
      const allowed = ["spam","harassment","hate_speech","impersonation","fraud","sexual_content","violence","child_safety","repeated_violations","other"];
      const reasonLabels: Record<string, string> = { spam: "Spam or fake engagement", harassment: "Harassment or bullying", hate_speech: "Hate speech or discriminatory content", impersonation: "Impersonation", fraud: "Scams or fraud", sexual_content: "Sexual or explicit content", violence: "Violence or threats", child_safety: "Child safety concern", repeated_violations: "Repeated policy violations", other: "Other policy violation" };
      const deletionDays: Record<string, number> = { spam: 7, harassment: 14, hate_speech: 30, impersonation: 14, fraud: 7, sexual_content: 14, violence: 7, child_safety: 1, repeated_violations: 7, other: 30 };
      const reason = "Automated moderation: " + (reasonLabels[reasonCode] || "Policy violation") + ".";
      const deleteAt = allowed.includes(reasonCode) ? new Date(Date.now() + deletionDays[reasonCode] * 86400000) : null;
      if (!userId || userId === user.id || !deleteAt) {
        return reply(400, { error: "Choose a valid account and reason." });
      }
      const { data: targetAdmin, error: targetAdminError } = await db.from("murmur_admin_allowlist").select("user_id").eq("user_id", userId).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply(400, { error: "Administrator accounts cannot be scheduled for deletion here." });
      const { data: terminated, error: terminatedError } = await db.from("account_restrictions").select("id").eq("user_id", userId).eq("status", "terminated").limit(1).maybeSingle();
      if (terminatedError) throw terminatedError;
      if (terminated) return reply(409, { error: "This account is already terminated." });
      const nowIso = new Date().toISOString();
      const { error: authError } = await db.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
      if (authError) return reply(400, { error: authError.message || "Could not disable sign-in for this account." });
      const { error: liftError } = await db.from("account_restrictions").update({ status: "lifted", lifted_at: nowIso }).eq("user_id", userId).in("status", ["suspended","scheduled_deletion"]);
      if (liftError) throw liftError;
      const { error: insertError } = await db.from("account_restrictions").insert({
        user_id: userId, status: "scheduled_deletion", reason_code: reasonCode, reason,
        starts_at: nowIso, scheduled_delete_at: deleteAt.toISOString(), created_by: user.id
      });
      if (insertError) throw insertError;
      const { data: profile, error: profileError } = await db.from("profiles").update({
        is_suspended: true, suspension_reason: reason, updated_at: nowIso
      }).eq("id", userId).select("id").maybeSingle();
      if (profileError) throw profileError;
      if (!profile) return reply(404, { error: "User profile not found." });
      await audit(db, user.id, "schedule_delete", userId, reason, { reason_code: reasonCode, scheduled_delete_at: deleteAt.toISOString() });
      return reply(200, { ok: true, scheduled_delete_at: deleteAt.toISOString() });
    }

    if (action === "blocked_users") {
      const { data: blocks, error } = await db.from("blocks")
        .select("blocker_id,blocked_id,created_at")
        .order("created_at", { ascending: false }).limit(500);
      if (error) throw error;
      const ids = Array.from(new Set((blocks || []).flatMap((row: any) => [row.blocker_id, row.blocked_id])));
      const { data: profiles, error: profilesError } = ids.length
        ? await db.from("profiles").select("id,username,display_name").in("id", ids)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const byId = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
      return reply(200, { blocks: (blocks || []).map((row: any) => ({
        ...row, blocker: byId.get(row.blocker_id) || null, blocked: byId.get(row.blocked_id) || null,
      })) });
    }

    if (action === "remove_block") {
      const blockerId = typeof body.blocker_id === "string" ? body.blocker_id : "";
      const blockedId = typeof body.blocked_id === "string" ? body.blocked_id : "";
      if (!blockerId || !blockedId || blockerId === blockedId) {
        return reply(400, { error: "Choose a valid block record." });
      }
      const { data, error } = await db.from("blocks").delete()
        .eq("blocker_id", blockerId).eq("blocked_id", blockedId)
        .select("blocker_id,blocked_id").maybeSingle();
      if (error) throw error;
      if (!data) return reply(404, { error: "Block record not found." });
      await audit(db, user.id, "remove_block", blockedId, "Removed user block", {
        blocker_id: blockerId, blocked_id: blockedId,
      });
      return reply(200, { ok: true });
    }

    if (action === "reports") {
      const { data, error } = await db.from("reports")
        .select("id,reporter_id,reported_user_id,post_id,reason,details,status,created_at")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return reply(200, { reports: data || [] });
    }

    if (action === "update_report") {
      const reportId = typeof body.report_id === "string" ? body.report_id : "";
      const status = typeof body.status === "string" ? body.status : "";
      if (!reportId || !["open", "reviewing", "resolved", "dismissed"].includes(status)) return reply(400, { error: "A valid report ID and status are required." });
      const { data, error } = await db.from("reports").update({ status }).eq("id", reportId).select("id,status").maybeSingle();
      if (error) throw error;
      if (!data) return reply(404, { error: "Report not found." });
      await audit(db, user.id, "update_report", null, "", { report_id: reportId, status });
      return reply(200, { ok: true, report: data });
    }

    if (action === "posts") {
      const { data, error } = await db.from("posts").select("id,author_id,content,visibility,media_path,media_type,created_at").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return reply(200, { posts: data || [] });
    }
    if (action === "delete_post") {
      const postId = typeof body.post_id === "string" ? body.post_id : "";
      const reasonCode = typeof body.reason_code === "string" ? body.reason_code : "";
      if (!postId) return reply(400, { error: "A post ID is required." });
      const { data, error } = await db.rpc("admin_delete_post_with_notice", {
        p_admin_id: user.id, p_post_id: postId, p_reason_code: reasonCode,
      });
      if (error) {
        if (error.code === "P0002") return reply(404, { error: "Post not found." });
        if (error.code === "22023") return reply(400, { error: error.message });
        if (error.code === "42501") return reply(403, { error: "Super Admin permission is required." });
        throw error;
      }
      return reply(200, data || { ok: true });
    }

    if (action === "verified_requests") {
      const { data: requests, error } = await db.from("verified_badge_requests")
        .select("id,user_id,reason,evidence_url,status,reviewer_note,created_at,reviewed_at")
        .order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      const ids = Array.from(new Set((requests || []).map((item: any) => item.user_id)));
      const { data: profiles, error: profileError } = ids.length
        ? await db.from("profiles").select("id,username,display_name,avatar_url,is_verified").in("id", ids)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const byId = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
      return reply(200, { requests: (requests || []).map((item: any) => ({ ...item, profile: byId.get(item.user_id) || null })) });
    }
    if (action === "review_verified_request") {
      const requestId = typeof body.request_id === "string" ? body.request_id : "";
      const status = typeof body.status === "string" ? body.status : "";
      const reviewerNote = typeof body.reviewer_note === "string" ? body.reviewer_note.trim().slice(0, 1000) : "";
      if (!requestId || !["approved", "rejected"].includes(status)) {
        return reply(400, { error: "Choose a valid request and decision." });
      }
      const { data: request, error: requestError } = await db.from("verified_badge_requests")
        .select("id,user_id,status").eq("id", requestId).maybeSingle();
      if (requestError) throw requestError;
      if (!request) return reply(404, { error: "Verified badge request not found." });
      if (request.status !== "pending") return reply(409, { error: "This request has already been reviewed." });
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await db.from("verified_badge_requests")
        .update({ status, reviewer_id: user.id, reviewer_note: reviewerNote || null, reviewed_at: now })
        .eq("id", requestId).eq("status", "pending")
        .select("id,user_id,status").maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return reply(409, { error: "This request has already been reviewed." });
      if (status === "approved") {
        const { error: profileError } = await db.from("profiles")
          .update({ is_verified: true, updated_at: now }).eq("id", request.user_id);
        if (profileError) throw profileError;
        const { error: publicProfileError } = await db.from("murmur_public_profiles")
          .update({ is_verified: true }).eq("id", request.user_id);
        if (publicProfileError) throw publicProfileError;
      }
      const noticeText = status === "approved"
        ? "Your verified badge request was approved. Your Murmur profile is now verified."
        : "Your verified badge request was not approved. " + (reviewerNote || "You can update your information and apply again.");
      const { error: notificationError } = await db.from("notifications").insert({
        recipient_id: request.user_id, actor_id: user.id,
        kind: status === "approved" ? "verified_badge_approved" : "verified_badge_declined",
        content: noticeText
      });
      if (notificationError) throw notificationError;
      await audit(db, user.id, status === "approved" ? "approve_verified_badge_request" : "decline_verified_badge_request",
        request.user_id, reviewerNote, { request_id: requestId });
      return reply(200, { ok: true, request: updated });
    }

    if (action === "moderate_user") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const type = typeof body.type === "string" ? body.type : "";
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 2000) : "";
      const hours = body.duration_hours == null ? null : Number(body.duration_hours);
      const appealable = body.appealable !== false && type !== "termination";
      if (!userId || userId === user.id) return reply(400, { error: "Choose a valid account. You cannot moderate your own admin account." });
      if (!["warning","mute","suspension","ban","termination"].includes(type)) return reply(400, { error: "Choose a valid moderation action." });
      if (!reason) return reply(400, { error: "A moderation reason is required." });
      // Resolve the target by the immutable Supabase Auth UUID, never by username.
      const { data: targetAuth, error: targetAuthError } = await db.auth.admin.getUserById(userId);
      if (targetAuthError || !targetAuth?.user) return reply(404, { error: "The selected account ID was not found in Supabase Auth." });
      const targetEmail = targetAuth.user.email?.trim().toLowerCase() || null;
      if (type === "suspension" && (!Number.isInteger(hours) || hours < 1 || hours > 8760)) return reply(400, { error: "Suspensions must be between 1 and 8760 hours." });
      if (["mute","ban"].includes(type) && hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 876000)) return reply(400, { error: "Choose a valid duration in hours." });
      const { data: targetAdmin, error: targetAdminError } = await db.from("murmur_admin_allowlist").select("user_id").eq("user_id", userId).eq("enabled", true).maybeSingle();
      if (targetAdminError) throw targetAdminError;
      if (targetAdmin) return reply(403, { error: "Administrator accounts cannot be moderated here." });
      const now = new Date();
      const expiresAt = hours == null ? null : new Date(now.getTime() + hours * 3600000).toISOString();
      let restrictionId: string | null = null;
      if (["suspension","ban","termination"].includes(type)) {
        const { data: restriction, error: restrictionError } = await db.from("account_restrictions").insert({
          user_id: userId,
          status: type === "termination" ? "terminated" : "suspended",
          reason_code: typeof body.reason_code === "string" ? body.reason_code.slice(0, 80) : "other",
          reason,
          starts_at: now.toISOString(),
          ends_at: type === "termination" ? null : expiresAt,
          created_by: user.id
        }).select("id").single();
        if (restrictionError) throw restrictionError;
        restrictionId = restriction.id;
        const banDuration = type === "suspension" ? hours + "h" : (type === "ban" && hours != null ? hours + "h" : "876000h");
        const { error: authBanError } = await db.auth.admin.updateUserById(userId, { ban_duration: banDuration });
        if (authBanError) {
          await db.from("account_restrictions").update({ status: "lifted", lifted_at: new Date().toISOString() }).eq("id", restrictionId);
          throw authBanError;
        }
        const { error: profileError } = await db.from("profiles").update({
          is_suspended: true, suspension_reason: reason, updated_at: now.toISOString()
        }).eq("id", userId);
        if (profileError) throw profileError;
      }
      const { data: caseRow, error: caseError } = await db.from("moderation_actions").insert({
        user_id: userId, type, reason, expires_at: expiresAt, appealable,
        issued_by: user.id, restriction_id: restrictionId
      }).select("id,type,user_id,reason,expires_at,appealable,created_at").single();
      if (caseError) throw caseError;
      const noticeText = type === "warning"
        ? "Murmur has issued an account warning. Reason: " + reason
        : type === "mute"
          ? "Murmur has muted your account. Reason: " + reason + (expiresAt ? " This action ends at " + new Date(expiresAt).toLocaleString() + "." : "")
          : "Murmur has applied an account restriction. Reason: " + reason;
      const { error: notificationError } = await db.from("notifications").insert({
        recipient_id: userId, actor_id: user.id,
        kind: "moderation_" + type, content: noticeText + " Case ID: " + caseRow.id
      });
      if (notificationError) throw notificationError;
      await audit(db, user.id, "moderate_user", userId, reason, {
        case_id: caseRow.id, type, duration_hours: hours, appealable, target_email: targetEmail
      });
      return reply(200, { ok: true, case: caseRow, target: { user_id: userId, email: targetEmail } });
    }

    if (action === "lift_moderation_case") {
      const caseId = typeof body.case_id === "string" ? body.case_id : "";
      if (!caseId) return reply(400, { error: "A moderation case ID is required." });
      const { data: caseRow, error: caseError } = await db.from("moderation_actions")
        .select("id,user_id,type,restriction_id").eq("id", caseId).maybeSingle();
      if (caseError) throw caseError;
      if (!caseRow) return reply(404, { error: "Moderation case not found." });
      const nowIso = new Date().toISOString();
      const { error: revokeError } = await db.from("moderation_actions").update({ revoked_at: nowIso })
        .eq("id", caseId).is("revoked_at", null);
      if (revokeError) throw revokeError;
      if (caseRow.restriction_id) {
        const { error: liftError } = await db.from("account_restrictions").update({ status: "lifted", lifted_at: nowIso })
          .eq("id", caseRow.restriction_id);
        if (liftError) throw liftError;
      }
      const [{ data: restrictions, error: restrictionsError }, { data: actions, error: actionsError }] = await Promise.all([
        db.from("account_restrictions").select("id").eq("user_id", caseRow.user_id).is("lifted_at", null)
          .in("status", ["suspended","terminated","scheduled_deletion","deleted"]).lte("starts_at", nowIso)
          .or("ends_at.is.null,ends_at.gt." + nowIso).limit(1),
        db.from("moderation_actions").select("id").eq("user_id", caseRow.user_id).is("revoked_at", null)
          .in("type", ["suspension","ban","termination"]).or("expires_at.is.null,expires_at.gt." + nowIso).limit(1)
      ]);
      if (restrictionsError) throw restrictionsError;
      if (actionsError) throw actionsError;
      if (!restrictions?.length && !actions?.length) {
        const { error: unbanError } = await db.auth.admin.updateUserById(caseRow.user_id, { ban_duration: "none" });
        if (unbanError) throw unbanError;
        const { error: profileError } = await db.from("profiles").update({
          is_suspended: false, suspension_reason: null, updated_at: nowIso
        }).eq("id", caseRow.user_id);
        if (profileError) throw profileError;
        await notifyAccountRecovered(db, caseRow.user_id, caseId);
      }
      await audit(db, user.id, "lift_moderation_case", caseRow.user_id, "Moderation case lifted", { case_id: caseId });
      return reply(200, { ok: true });
    }

    if (action === "moderation_cases") {
      const { data: cases, error } = await db.from("moderation_actions")
        .select("id,user_id,type,reason,expires_at,appealable,issued_by,created_at,revoked_at,restriction_id")
        .order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      const ids = Array.from(new Set((cases || []).map((row: any) => row.user_id)));
      const { data: profiles, error: profileError } = ids.length
        ? await db.from("profiles").select("id,username,display_name").in("id", ids)
        : { data: [], error: null };
      if (profileError) throw profileError;
      const byId = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
      return reply(200, { cases: (cases || []).map((row: any) => ({ ...row, profile: byId.get(row.user_id) || null })) });
    }

    if (action === "review_moderation_appeal") {
      const appealId = typeof body.appeal_id === "string" ? body.appeal_id : "";
      const status = typeof body.status === "string" ? body.status : "";
      const note = typeof body.reviewer_note === "string" ? body.reviewer_note.trim().slice(0, 2000) : "";
      if (!appealId || !["approved","denied"].includes(status)) return reply(400, { error: "Choose a valid appeal decision." });
      const { data: appeal, error: appealError } = await db.from("appeals")
        .select("id,action_id,user_id,status").eq("id", appealId).maybeSingle();
      if (appealError) throw appealError;
      if (!appeal || appeal.status !== "pending") return reply(409, { error: "Appeal not found or already reviewed." });
      const nowIso = new Date().toISOString();
      const { data: updated, error: updateError } = await db.from("appeals").update({
        status, reviewer_note: note || null, reviewed_by: user.id, reviewed_at: nowIso
      }).eq("id", appealId).eq("status", "pending").select("id,status").maybeSingle();
      if (updateError) throw updateError;
      if (!updated) return reply(409, { error: "This appeal was already reviewed." });
      if (status === "approved") {
        const { data: actionRow, error: actionError } = await db.from("moderation_actions")
          .update({ revoked_at: nowIso }).eq("id", appeal.action_id)
          .select("id,user_id,restriction_id,type").single();
        if (actionError) throw actionError;
        if (actionRow.restriction_id) {
          const { error: liftError } = await db.from("account_restrictions")
            .update({ status: "lifted", lifted_at: nowIso }).eq("id", actionRow.restriction_id);
          if (liftError) throw liftError;
        }
        const [{ data: stillRestricted, error: restrictionCheckError }, { data: stillBanned, error: actionCheckError }] = await Promise.all([
          db.from("account_restrictions").select("id").eq("user_id", appeal.user_id).is("lifted_at", null)
            .in("status", ["suspended","terminated","scheduled_deletion","deleted"]).lte("starts_at", nowIso)
            .or("ends_at.is.null,ends_at.gt." + nowIso).limit(1),
          db.from("moderation_actions").select("id").eq("user_id", appeal.user_id).is("revoked_at", null)
            .in("type", ["suspension","ban","termination"]).or("expires_at.is.null,expires_at.gt." + nowIso).limit(1)
        ]);
        if (restrictionCheckError) throw restrictionCheckError;
        if (actionCheckError) throw actionCheckError;
        if (!(stillRestricted?.length) && !(stillBanned?.length)) {
          const { error: authUnbanError } = await db.auth.admin.updateUserById(appeal.user_id, { ban_duration: "none" });
          if (authUnbanError) throw authUnbanError;
          const { error: profileError } = await db.from("profiles").update({
            is_suspended: false, suspension_reason: null, updated_at: nowIso
          }).eq("id", appeal.user_id);
          if (profileError) throw profileError;
        }
      }
      await audit(db, user.id, "review_moderation_appeal", appeal.user_id, note, { appeal_id: appealId, status });
      return reply(200, { ok: true, appeal: updated });
    }

    if (action === "appeals") {
      const [{ data, error }, { data: moderationAppeals, error: moderationAppealError }] = await Promise.all([
        db.from("account_appeals").select("id,user_id,restriction_id,message,status,admin_response,created_at,reviewed_at").order("created_at", { ascending: false }).limit(200),
        db.from("appeals").select("id,user_id,action_id,message,status,reviewer_note,created_at,reviewed_at").order("created_at", { ascending: false }).limit(200)
      ]);
      if (error) throw error;
      if (moderationAppealError) throw moderationAppealError;
      return reply(200, { appeals: data || [], moderation_appeals: moderationAppeals || [] });
    }
    if (action === "update_appeal") {
      const appealId = typeof body.appeal_id === "string" ? body.appeal_id : "";
      const status = typeof body.status === "string" ? body.status : "";
      const response = typeof body.admin_response === "string" ? body.admin_response.trim().slice(0, 2000) : "";
      if (!appealId || !["reviewing", "approved", "rejected"].includes(status)) return reply(400, { error: "Choose a valid appeal status." });
      const { data, error } = await db.from("account_appeals").update({
        status, admin_response: response || null, reviewed_at: new Date().toISOString(),
      }).eq("id", appealId).select("id,status,admin_response").maybeSingle();
      if (error) throw error;
      if (!data) return reply(404, { error: "Appeal not found." });
      await audit(db, user.id, "review_appeal", null, response, { appeal_id: appealId, status });
      return reply(200, { ok: true, appeal: data });
    }

    if (action === "notifications") {
      const { data, error } = await db.from("notifications")
        .select("id,recipient_id,actor_id,kind,entity_id,content,read_at,created_at")
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      const ids = Array.from(new Set((data || []).map((item: any) => item.recipient_id).filter(Boolean)));
      const { data: profiles, error: profilesError } = ids.length
        ? await db.from("profiles").select("id,username,display_name").in("id", ids)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const byId = new Map((profiles || []).map((profile: any) => [profile.id, profile]));
      return reply(200, { notifications: (data || []).map((item: any) => ({
        ...item, recipient: byId.get(item.recipient_id) || null,
      })) });
    }
    if (action === "delete_notification") {
      const id = typeof body.notification_id === "string" ? body.notification_id : "";
      if (!id) return reply(400, { error: "A notification ID is required." });
      const { data, error } = await db.from("notifications").delete().eq("id", id).select("id,recipient_id").maybeSingle();
      if (error) throw error;
      if (!data) return reply(404, { error: "Notification not found." });
      await audit(db, user.id, "delete_notification", data.recipient_id, "Deleted a user notification", { notification_id: id });
      return reply(200, { ok: true });
    }

    if (action === "announcements") {
      const { data, error } = await db.from("announcements").select("id,title,body,kind,is_pinned,published_at,expires_at,created_at").order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return reply(200, { announcements: data || [] });
    }
    if (action === "create_announcement") {
      const allowedTitles = ["Important Update", "New Feature", "Feature Update", "Maintenance Notice", "Service Update", "Security Notice", "Account Notice", "Community Guidelines", "Event Announcement", "General Announcement"];
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const content = typeof body.body === "string" ? body.body.trim().slice(0, 5000) : "";
      const kind = ["info", "warning", "success", "urgent"].includes(body.kind) ? body.kind : "info";
      if (!allowedTitles.includes(title)) return reply(400, { error: "Choose one of the 10 approved announcement titles." });
      if (!content) return reply(400, { error: "Announcement information is required." });
      const { data, error } = await db.from("announcements").insert({
        title, body: content, kind, is_pinned: false, created_by: user.id,
      }).select().single();
      if (error) throw error;
      await audit(db, user.id, "create_announcement", null, title, { announcement_id: data.id });
      return reply(200, { announcement: data });
    }
    if (action === "delete_announcement") {
      const id = typeof body.announcement_id === "string" ? body.announcement_id : "";
      if (!id) return reply(400, { error: "An announcement ID is required." });
      const { error } = await db.from("announcements").delete().eq("id", id);
      if (error) throw error;
      await audit(db, user.id, "delete_announcement", null, "", { announcement_id: id });
      return reply(200, { ok: true });
    }

    if (action === "visitor_analytics") {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      const [
        { count: uniqueVisitors, error: devicesError },
        { count: totalVisits, error: visitsError },
        { count: uniqueToday, error: todayDevicesError },
        { count: visitsToday, error: todayVisitsError },
        { data: eventRows, error: eventRowsError },
        { data: phoneDevices, error: phoneDevicesError },
      ] = await Promise.all([
        db.from("admin_murmur_visitor_devices").select("visitor_id", { count: "exact", head: true }),
        db.from("admin_murmur_visitor_events").select("id", { count: "exact", head: true }),
        db.from("admin_murmur_visitor_devices").select("visitor_id", { count: "exact", head: true })
          .gte("first_seen_at", todayStart.toISOString()),
        db.from("admin_murmur_visitor_events").select("id", { count: "exact", head: true })
          .gte("visited_at", todayStart.toISOString()),
        db.from("admin_murmur_visitor_events").select("id,visitor_id,page_path,visited_at")
          .order("visited_at", { ascending: false }).limit(5000),
        db.from("admin_murmur_phone_accounts").select("*")
          .order("last_seen_at", { ascending: false }).limit(100),
      ]);
      for (const error of [devicesError, visitsError, todayDevicesError, todayVisitsError, eventRowsError, phoneDevicesError]) {
        if (error) throw error;
      }

      const dailyMap = new Map<string, { visits: number; visitors: Set<string> }>();
      const pageMap = new Map<string, number>();
      for (const event of eventRows || []) {
        const day = new Date(event.visited_at).toISOString().slice(0, 10);
        if (!dailyMap.has(day)) dailyMap.set(day, { visits: 0, visitors: new Set<string>() });
        const dayData = dailyMap.get(day)!;
        dayData.visits += 1;
        dayData.visitors.add(event.visitor_id);
        pageMap.set(event.page_path, (pageMap.get(event.page_path) || 0) + 1);
      }
      const daily = Array.from(dailyMap.entries())
        .map(([date, value]) => ({ date, visits: value.visits, visitors: value.visitors.size }))
        .sort((left, right) => right.date.localeCompare(left.date)).slice(0, 30);
      const pages = Array.from(pageMap.entries())
        .map(([path, visits]) => ({ path, visits }))
        .sort((left, right) => right.visits - left.visits).slice(0, 50);
      return reply(200, {
        unique_visitors: uniqueVisitors || 0,
        total_visits: totalVisits || 0,
        unique_visitors_today: uniqueToday || 0,
        visits_today_sample: visitsToday || 0,
        sample_limited: (totalVisits || 0) > (eventRows || []).length,
        daily,
        pages,
        recent: (eventRows || []).slice(0, 50),
        phone_devices: phoneDevices || [],
      });
    }

    if (action === "errors") {
      const { data, error, count } = await db.from("murmur_error_logs")
        .select("id,actor_key,kind,message,code,source,line,column_number,page,stack,fingerprint,created_at", { count: "exact" })
        .order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return reply(200, { errors: data || [], total: count || 0 });
    }

    if (action === "system") {
      const tables = ["profiles","posts","comments","messages","reports","stories","reels","account_appeals"];
      const counts = await Promise.all(tables.map(async (table) => {
        const { count, error } = await db.from(table).select("*", { count: "exact", head: true });
        if (error) throw error;
        return [table, count || 0] as const;
      }));
      const [{ data: errors, error: errorsError }, { data: restrictions, error: restrictionsError }] = await Promise.all([
        db.from("murmur_error_logs").select("id,created_at,kind,message,code,source,line,page,fingerprint").order("created_at", { ascending: false }).limit(100),
        db.from("account_restrictions").select("id,user_id,status,reason_code,reason,starts_at,ends_at,scheduled_delete_at,created_at").in("status", ["suspended","scheduled_deletion"]).order("created_at", { ascending: false }).limit(100)
      ]);
      if (errorsError) throw errorsError;
      if (restrictionsError) throw restrictionsError;
      return reply(200, { counts: Object.fromEntries(counts), errors: errors || [], restrictions: restrictions || [] });
    }

    if (action === "activity") {
      const { data, error } = await db.from("admin_audit_log").select("id,admin_id,action,target_user_id,reason,metadata,created_at").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return reply(200, { activity: data || [] });
    }

    return reply(400, { error: "Unknown admin action." });
  } catch (error) {
    console.error("murmur-admin-supabase:", error);
    return reply(500, { error: "The admin request could not be completed." });
  }
});