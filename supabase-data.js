/* Murmur data access — explicit Postgres operations, no Firebase compatibility layer. */
import { supabase, requireUser } from "./supabase-client.js";

const PAGE_SIZE = 20;

function throwIfError(result) {
  if (result.error) throw result.error;
  return result.data;
}

function pageRange(page = 0, pageSize = PAGE_SIZE) {
  const safePage = Math.max(0, Math.floor(Number(page) || 0));
  const safeSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || PAGE_SIZE)));
  return [safePage * safeSize, safePage * safeSize + safeSize - 1];
}

export const auth = {
  signUp: async ({ email, password, username, displayName }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: displayName || username } }
    });
    if (error) throw error;
    return data;
  },
  signIn: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },
  getSession: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },
  getUser: async () => requireUser(),
  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
  resetPassword: async (email, redirectTo = location.origin) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw error;
  },
  onChange: (callback) => {
    const { data, error } = supabase.auth.onAuthStateChange(callback);
    if (error) throw error;
    return () => data.subscription.unsubscribe();
  }
};

export const profiles = {
  get: async (userId) => {
    const id = userId || (await requireUser()).id;
    return throwIfError(await supabase.from("profiles").select("*").eq("id", id).maybeSingle());
  },
  update: async (changes) => {
    const user = await requireUser();
    const allowed = ["username", "display_name", "bio", "school", "location", "interests", "avatar_url", "cover_url"];
    const patch = Object.fromEntries(Object.entries(changes || {}).filter(([key]) => allowed.includes(key)));
    return throwIfError(await supabase.from("profiles").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", user.id).select().single());
  },
  search: async (term, page = 0) => {
    const [from, to] = pageRange(page);
    const query = supabase.from("profiles").select("id,username,display_name,bio,avatar_url,created_at").order("created_at", { ascending: false }).range(from, to);
    if (term?.trim()) query.or("username.ilike.%" + term.trim().replace(/[%_,]/g, "") + "%,display_name.ilike.%" + term.trim().replace(/[%_,]/g, "") + "%");
    return throwIfError(await query);
  }
};

export const posts = {
  feed: async (page = 0) => {
    const [from, to] = pageRange(page);
    return throwIfError(await supabase.from("posts").select("id,author_id,content,visibility,media_url,media_type,metadata,created_at,updated_at")
      .order("created_at", { ascending: false }).range(from, to));
  },
  create: async ({ content, visibility = "public", mediaUrl = null, mediaType = null, metadata = {} }) => {
    const user = await requireUser();
    return throwIfError(await supabase.from("posts").insert({
      author_id: user.id, content: content || "", visibility, media_url: mediaUrl,
      media_type: mediaType, metadata
    }).select().single());
  },
  remove: async (postId) => {
    await requireUser();
    return throwIfError(await supabase.from("posts").delete().eq("id", postId).select("id").single());
  }
};

export const comments = {
  list: async (postId, page = 0) => {
    const [from, to] = pageRange(page);
    return throwIfError(await supabase.from("comments").select("id,post_id,author_id,content,created_at")
      .eq("post_id", postId).order("created_at", { ascending: true }).range(from, to));
  },
  create: async (postId, content) => {
    const user = await requireUser();
    return throwIfError(await supabase.from("comments").insert({ post_id: postId, author_id: user.id, content: String(content).trim() }).select().single());
  },
  remove: async (commentId) => {
    await requireUser();
    return throwIfError(await supabase.from("comments").delete().eq("id", commentId).select("id").single());
  }
};

export const messages = {
  list: async (conversationId, page = 0) => {
    const [from, to] = pageRange(page);
    return throwIfError(await supabase.from("messages").select("id,conversation_id,sender_id,content,media_url,media_type,created_at,edited_at,deleted_at")
      .eq("conversation_id", conversationId).is("deleted_at", null)
      .order("created_at", { ascending: false }).range(from, to));
  },
  send: async ({ conversationId, content, mediaUrl = null, mediaType = null }) => {
    const user = await requireUser();
    return throwIfError(await supabase.from("messages").insert({
      conversation_id: conversationId, sender_id: user.id, content: content || "",
      media_url: mediaUrl, media_type: mediaType
    }).select().single());
  }
};

export const friendships = {
  list: async () => {
    const user = await requireUser();
    return throwIfError(await supabase.from("friendships").select("requester_id,addressee_id,status,created_at,updated_at")
      .or("requester_id.eq." + user.id + ",addressee_id.eq." + user.id).order("updated_at", { ascending: false }));
  },
  request: async (targetUserId) => {
    const user = await requireUser();
    if (targetUserId === user.id) throw new Error("You cannot send a friend request to yourself.");
    return throwIfError(await supabase.from("friendships").insert({ requester_id: user.id, addressee_id: targetUserId, status: "pending" }).select().single());
  },
  setStatus: async (requesterId, status) => {
    const user = await requireUser();
    if (!["accepted", "declined"].includes(status)) throw new Error("Friend requests can only be accepted or declined.");
    return throwIfError(await supabase.from("friendships").update({ status, updated_at: new Date().toISOString() })
      .eq("requester_id", requesterId).eq("addressee_id", user.id).select().single());
  }
};

export const stories = {
  list: async () => throwIfError(await supabase.from("stories").select("id,author_id,content,media_url,background,created_at,expires_at")
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(100)),
  create: async ({ content = "", mediaUrl = null, background = null, expiresAt }) => {
    const user = await requireUser();
    return throwIfError(await supabase.from("stories").insert({
      author_id: user.id, content, media_url: mediaUrl, background,
      expires_at: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }).select().single());
  }
};

export const reports = {
  create: async ({ reportedUserId = null, postId = null, reason, details = "" }) => {
    const user = await requireUser();
    return throwIfError(await supabase.from("reports").insert({
      reporter_id: user.id, reported_user_id: reportedUserId, post_id: postId,
      reason, details, status: "open"
    }).select().single());
  }
};

export const storage = {
  upload: async (file, { bucket, folder = "uploads" }) => {
    const user = await requireUser();
    if (!bucket) throw new Error("A configured Supabase Storage bucket is required.");
    const safeName = String(file.name || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = user.id + "/" + folder.replace(/^\/+|\/+$/g, "") + "/" + crypto.randomUUID() + "-" + safeName;
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type || "application/octet-stream"
    });
    if (error) throw error;
    if (bucket === "murmur-avatars") {
      const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(data.path);
      return { path: data.path, url: publicData.publicUrl, isPublic: true };
    }
    const { data: signedData, error: signedError } = await supabase.storage.from(bucket).createSignedUrl(data.path, 3600);
    if (signedError) throw signedError;
    return { path: data.path, url: signedData.signedUrl, isPublic: false, expiresIn: 3600 };
  },
  uploadAvatar: async (file) => storage.upload(file, { bucket: "murmur-avatars", folder: "profiles" }),
  uploadMedia: async (file, folder = "posts") => storage.upload(file, { bucket: "murmur-media", folder }),
  url: async (bucket, path, expiresIn = 3600) => {
    if (bucket === "murmur-avatars") {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return data.publicUrl;
    }
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },
  remove: async (bucket, paths) => {
    await requireUser();
    return throwIfError(await supabase.storage.from(bucket).remove(Array.isArray(paths) ? paths : [paths]));
  }
};
