import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Authentication required" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);
    const user = authData.user;
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const body = await req.json();
    const action = String(body?.action || "");

    if (action === "subscribe") {
      const subscription = body?.subscription;
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return json({ error: "Invalid push subscription" }, 400);
      }
      const { error } = await admin.from("murmur_push_subscriptions").upsert({
        user_id: user.id,
        endpoint: subscription.endpoint,
        subscription,
        device_label: String(body?.device_label || "").slice(0, 180),
        updated_at: new Date().toISOString()
      }, { onConflict: "endpoint" });
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "unsubscribe") {
      const endpoint = String(body?.endpoint || "");
      if (!endpoint) return json({ error: "Subscription endpoint required" }, 400);
      const { error } = await admin.from("murmur_push_subscriptions")
        .delete().eq("user_id", user.id).eq("endpoint", endpoint);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === "notify") {
      const conversationId = String(body?.conversation_id || "");
      if (!conversationId) return json({ error: "Conversation ID required" }, 400);

      const { data: members, error: memberError } = await admin
        .from("conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId);
      if (memberError) throw memberError;
      const memberIds = (members || []).map((row: { user_id: string }) => row.user_id);
      if (!memberIds.includes(user.id)) return json({ error: "Not a conversation member" }, 403);

      const { data: latestMessage, error: messageError } = await admin
        .from("messages")
        .select("id,content,sender_id,created_at")
        .eq("conversation_id", conversationId)
        .eq("sender_id", user.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (messageError) throw messageError;
      if (!latestMessage) return json({ ok: true, sent: 0 });

      const { error: claimError } = await admin.from("murmur_push_delivery_claims")
        .insert({ message_id: latestMessage.id });
      if (claimError?.code === "23505") return json({ ok: true, sent: 0, duplicate: true });
      if (claimError) throw claimError;

      const recipientIds = memberIds.filter((id: string) => id !== user.id);
      if (!recipientIds.length) return json({ ok: true, sent: 0 });

      const [{ data: config, error: configError }, { data: subscriptions, error: subscriptionError }, { data: sender, error: senderError }] = await Promise.all([
        admin.rpc("get_murmur_push_config").maybeSingle(),
        admin.from("murmur_push_subscriptions")
          .select("id,user_id,endpoint,subscription")
          .in("user_id", recipientIds),
        admin.from("murmur_public_profiles")
          .select("display_name,username").eq("id", user.id).maybeSingle()
      ]);
      if (configError) throw configError;
      if (subscriptionError) throw subscriptionError;
      if (senderError) throw senderError;
      if (!config?.vapid_public_key || !config?.vapid_private_key) {
        throw new Error("Push delivery is not configured");
      }

      webpush.setVapidDetails(config.vapid_subject || "mailto:notifications@murmur.app",
        config.vapid_public_key, config.vapid_private_key);

      const senderName = sender?.display_name || (sender?.username ? "@" + sender.username : "Murmur");
      const payload = JSON.stringify({
        title: senderName,
        body: String(latestMessage.content || "Sent you an attachment").slice(0, 120),
        icon: "/murmur-icon.svg",
        badge: "/murmur-icon.svg",
        tag: "murmur-message-" + conversationId,
        data: { url: "/", conversation_id: conversationId }
      });

      let sent = 0;
      const staleIds: string[] = [];
      await Promise.all((subscriptions || []).map(async (row: { id: string; subscription: Record<string, unknown> }) => {
        try {
          await webpush.sendNotification(row.subscription as any, payload, { TTL: 3600 });
          sent++;
        } catch (error: any) {
          if (error?.statusCode === 404 || error?.statusCode === 410) staleIds.push(row.id);
          else console.warn("[Murmur push] Delivery failed:", error?.statusCode || error?.message);
        }
      }));
      if (staleIds.length) {
        await admin.from("murmur_push_subscriptions").delete().in("id", staleIds);
      }
      return json({ ok: true, sent });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error("[Murmur push]", error);
    return json({ error: error?.message || "Push request failed" }, 500);
  }
});
