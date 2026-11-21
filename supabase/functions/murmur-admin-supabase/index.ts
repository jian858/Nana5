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
        .select("id,public_id,username,display_name,bio,avatar_url,created_at,is_suspended,suspension_reason", { count: "exact" });
      if (search) {
        if (/^[0-9a-f-]{36}$/i.test(search)) usersQuery = usersQuery.eq("id", search);
        else {
          const safeSearch = search.replace(/[^a-zA-Z0-9 _.-]/g, " ").trim().slice(0, 80);
          if (safeSearch) usersQuery = usersQuery.or("username.ilike.%"+safeSearch+"%,display_name.ilike.%"+safeSearch+"%");
        }
      }
      if (status === "active") usersQuery = usersQuery.eq("is_suspended", false);
      if (status === "suspended") usersQuery = usersQuery.eq("is_suspended", true);
      const { data, error, count } = await usersQuery
        .order("created_at", { ascending: false }).order("id", { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const total = count || 0;
      return reply(200, { users: data || [], page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)) });
    }

    if (action === "set_user_status") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const suspended = body.suspended === true;
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      const reasonCode = typeof body.reason_code === "string" ? body.reason_code : "";
      const allowedReasonCodes = ["spam","harassment","hate_speech","impersonation","fraud","sexual_content","violence","child_safety","repeated_violations","other"];
      const hours = body.duration_hours == null || body.duration_hours === "" ? null : Number(body.duration_hours);
      if (!userId || userId === user.id) return reply(400, { error: "Choose a valid user. You cannot suspend your own admin account." });
      if (suspended && !reason) return reply(400, { error: "A suspension reason is required." });
      if (suspended && !allowedReasonCodes.includes(reasonCode)) return reply(400, { error: "Choose one of the ten approved restriction reasons." });
      if (suspended && (!Number.isFinite(hours) || hours <= 0 || hours > 8760)) {
        return reply(400, { error: "Choose a suspension duration between 1 and 8760 hours." });
      }
      const { data, error } = await db.rpc("admin_set_account_status", {
        p_admin_id: user.id, p_user_id: userId, p_suspended: suspended,
        p_reason: reason || null, p_duration_hours: suspended ? hours : null,
        p_reason_code: suspended ? reasonCode : "other",
      });
      if (error) {
        if (error.code === "P0002") return reply(404, { error: "User profile not found." });
        if (error.code === "22023") return reply(400, { error: error.message });
        throw error;
      }
      return reply(200, { ok: true, user: data });
    }

    if (action === "schedule_delete") {
      const userId = typeof body.user_id === "string" ? body.user_id : "";
      const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
      const reasonCode = typeof body.reason_code === "string" ? body.reason_code : "";
      const allowedReasonCodes = ["spam","harassment","hate_speech","impersonation","fraud","sexual_content","violence","child_safety","repeated_violations","other"];
      const deleteAt = typeof body.delete_at === "string" ? new Date(body.delete_at) : null;
      if (!userId || userId === user.id) return reply(400, { error: "Choose a valid user." });
      if (!reason || !allowedReasonCodes.includes(reasonCode) || !deleteAt || !Number.isFinite(deleteAt.getTime()) || deleteAt.getTime() <= Date.now()) {
        return reply(400, { error: "Choose a valid reason and a future deletion date." });
      }
      const { data, error } = await db.rpc("admin_schedule_account_deletion", {
        p_admin_id: user.id, p_user_id: userId, p_reason: reason,
        p_delete_at: deleteAt.toISOString(), p_reason_code: reasonCode,
      });
      if (error) {
        if (error.code === "P0002") return reply(404, { error: "User profile not found." });
        if (error.code === "22023") return reply(400, { error: error.message });
        throw error;
      }
      return reply(200, data);
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
      if (!postId) return reply(400, { error: "A post ID is required." });
      const { error } = await db.from("posts").delete().eq("id", postId);
      if (error) throw error;
      await audit(db, user.id, "delete_post", null, "", { post_id: postId });
      return reply(200, { ok: true });
    }

    if (action === "appeals") {
      const { data, error } = await db.from("account_appeals").select("id,user_id,restriction_id,message,status,admin_response,created_at,reviewed_at").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return reply(200, { appeals: data || [] });
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