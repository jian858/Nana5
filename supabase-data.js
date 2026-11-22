/* Murmur data access — explicit Supabase Postgres operations. */
import { supabase, requireUser } from "./supabase-client.js?v=20261122-2";

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
    const query = supabase.from("murmur_public_profiles").select("id,username,display_name,bio,avatar_url,created_at").order("created_at", { ascending: false }).range(from, to);
    if (term?.trim()) query.or("username.ilike.%" + term.trim().replace(/[%_,]/g, "") + "%,display_name.ilike.%" + term.trim().replace(/[%_,]/g, "") + "%");
    return throwIfError(await query);
  }
};

export const posts = {
  feed: async (page = 0) => {
    const [from, to] = pageRange(page);
    return throwIfError(await supabase.from("posts").select("id,author_id,content,visibility,media_path,media_type,metadata,created_at,updated_at")
      .order("created_at", { ascending: false }).range(from, to));
  },
  create: async ({ content, visibility = "public", mediaPath = null, mediaType = null, metadata = {} }) => {
    const user = await requireUser();
    return throwIfError(await supabase.from("posts").insert({
      author_id: user.id, content: content || "", visibility, media_url: null, media_path: mediaPath,
      media_type: mediaType, metadata
    }).select().single());
  },
  remove: async (postId) => {
    const user = await requireUser();
    const existing = throwIfError(await supabase.from("posts").select("media_path")
      .eq("id", postId).eq("author_id", user.id).maybeSingle());
    const deleted = throwIfError(await supabase.from("posts").delete()
      .eq("id", postId).eq("author_id", user.id).select("id").single());
    if (existing?.media_path) await storage.remove("murmur-posts", existing.media_path).catch(() => null);
    return deleted;
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

export const postLikes = {
  listForPosts: async (postIds = []) => {
    const ids = [...new Set(postIds)].filter(Boolean);
    if (!ids.length) return [];
    return throwIfError(await supabase.from("post_likes")
      .select("post_id,user_id").in("post_id", ids));
  },
  toggle: async (postId) => {
    const user = await requireUser();
    const existing = throwIfError(await supabase.from("post_likes")
      .select("post_id").eq("post_id", postId).eq("user_id", user.id).maybeSingle());
    if (existing) {
      return throwIfError(await supabase.from("post_likes").delete()
        .eq("post_id", postId).eq("user_id", user.id).select("post_id").maybeSingle());
    }
    return throwIfError(await supabase.from("post_likes")
      .insert({ post_id: postId, user_id: user.id }).select("post_id").single());
  }
};

export const conversations = {
  list: async () => {
    const user = await requireUser();
    const memberships = throwIfError(await supabase.from("conversation_members")
      .select("conversation_id,joined_at,last_read_at")
      .eq("user_id", user.id)
      .order("joined_at", { ascending: false }));
    if (!memberships.length) return [];
    const ids = memberships.map(row => row.conversation_id);
    const rows = throwIfError(await supabase.from("conversations")
      .select("id,created_by,created_at")
      .in("id", ids)
      .order("created_at", { ascending: false }));
    const membershipById = new Map(memberships.map(row => [row.conversation_id, row]));
    return rows.map(row => ({ ...row, membership: membershipById.get(row.id) }));
  },
  members: async (conversationId) => {
    // getSession reads the already-persisted client session without an extra Auth network round-trip.
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData?.session?.user) throw new Error("Please sign in to continue.");
    return throwIfError(await supabase.from("conversation_members")
      .select("conversation_id,user_id,joined_at,last_read_at")
      .eq("conversation_id", conversationId)
      .order("joined_at", { ascending: true }));
  },
  markRead: async (conversationId) => {
    const user = await requireUser();
    return throwIfError(await supabase.from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", user.id)
      .select("conversation_id,last_read_at")
      .single());
  }
};

export const messages = {
  list: async (conversationId, page = 0) => {
    // RLS still authorizes every row; avoid a separate auth.getUser request before fetching.
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;
    if (!sessionData?.session?.user) throw new Error("Please sign in to continue.");
    const [from, to] = pageRange(page);
    return throwIfError(await supabase.from("messages").select("id,conversation_id,sender_id,content,media_url,media_type,created_at,edited_at,deleted_at")
      .eq("conversation_id", conversationId).is("deleted_at", null)
      .order("created_at", { ascending: false }).range(from, to));
  },
  send: async ({ conversationId, content, mediaUrl = null, mediaType = null }) => {
    const user = await requireUser();
    const cleanContent = String(content || "").trim();
    if (!cleanContent && !mediaUrl) throw new Error("Add a message or attachment before sending.");
    if (cleanContent.length > 5000) throw new Error("Messages must be 5,000 characters or fewer.");
    return throwIfError(await supabase.from("messages").insert({
      conversation_id: conversationId, sender_id: user.id, content: cleanContent,
      media_url: mediaUrl, media_type: mediaType
    }).select().single());
  },
  edit: async (messageId, content) => {
    await requireUser();
    const cleanContent = String(content || "").trim();
    if (!cleanContent) throw new Error("A message cannot be empty.");
    if (cleanContent.length > 5000) throw new Error("Messages must be 5,000 characters or fewer.");
    return throwIfError(await supabase.from("messages")
      .update({ content: cleanContent, edited_at: new Date().toISOString() })
      .eq("id", messageId).select().single());
  },
  remove: async (messageId) => {
    await requireUser();
    return throwIfError(await supabase.from("messages")
      .delete().eq("id", messageId).select("id").single());
  }
};

export const friendships = {
  list: async () => {
    const user = await requireUser();
    return throwIfError(await supabase.from("friendships").select("requester_id,addressee_id,status,created_at,updated_at")
      .or("requester_id.eq." + user.id + ",addressee_id.eq." + user.id).order("updated_at", { ascending: false }));
  },
  people: async (status = "accepted") => {
    const user = await requireUser();
    const relations = throwIfError(await supabase.from("friendships")
      .select("requester_id,addressee_id,status,created_at,updated_at")
      .or("requester_id.eq." + user.id + ",addressee_id.eq." + user.id)
      .eq("status", status)
      .order("updated_at", { ascending: false }));
    const ids = [...new Set(relations.map(row => row.requester_id === user.id ? row.addressee_id : row.requester_id))];
    if (!ids.length) return [];
    const people = throwIfError(await supabase.from("murmur_public_profiles")
      .select("id,username,display_name,avatar_url,bio,is_verified")
      .in("id", ids));
    const byId = new Map(people.map(person => [person.id, person]));
    return relations.map(relation => ({
      ...relation,
      person: byId.get(relation.requester_id === user.id ? relation.addressee_id : relation.requester_id) || null
    }));
  },
  incoming: async () => {
    const user = await requireUser();
    return throwIfError(await supabase.from("friendships")
      .select("requester_id,addressee_id,status,created_at")
      .eq("addressee_id", user.id).eq("status", "pending")
      .order("created_at", { ascending: false }));
  },
  outgoing: async () => {
    const user = await requireUser();
    return throwIfError(await supabase.from("friendships")
      .select("requester_id,addressee_id,status,created_at")
      .eq("requester_id", user.id).eq("status", "pending")
      .order("created_at", { ascending: false }));
  },
  request: async (targetUserId) => {
    const user = await requireUser();
    if (!targetUserId || targetUserId === user.id) throw new Error("Choose another user to send a friend request.");
    return throwIfError(await supabase.from("friendships").insert({ requester_id: user.id, addressee_id: targetUserId, status: "pending" }).select().single());
  },
  setStatus: async (requesterId, status) => {
    const user = await requireUser();
    if (!["accepted", "declined"].includes(status)) throw new Error("Friend requests can only be accepted or declined.");
    return throwIfError(await supabase.from("friendships").update({ status, updated_at: new Date().toISOString() })
      .eq("requester_id", requesterId).eq("addressee_id", user.id).select().single());
  },
  cancelRequest: async (addresseeId) => {
    const user = await requireUser();
    return throwIfError(await supabase.from("friendships").delete()
      .eq("requester_id", user.id).eq("addressee_id", addresseeId)
      .eq("status", "pending").select("requester_id,addressee_id").single());
  }
};

export const stories = {
  list: async () => throwIfError(await supabase.from("stories").select("id,author_id,content,media_path,media_type,background,created_at,expires_at")
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(100)),
  create: async ({ content = "", mediaPath = null, mediaType = null, background = null, expiresAt }) => {
    const user = await requireUser();
    const cleanContent = String(content || "").trim();
    if (!cleanContent && !mediaPath) throw new Error("Add text or media before publishing your story.");
    if (cleanContent.length > 2000) throw new Error("Stories must be 2,000 characters or fewer.");
    return throwIfError(await supabase.from("stories").insert({
      author_id: user.id, content: cleanContent, media_url: null, media_path: mediaPath,
      media_type: mediaType, background,
      expires_at: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }).select().single());
  },
  remove: async (storyId) => {
    const user = await requireUser();
    const existing = throwIfError(await supabase.from("stories").select("media_path")
      .eq("id", storyId).eq("author_id", user.id).maybeSingle());
    const deleted = throwIfError(await supabase.from("stories").delete()
      .eq("id", storyId).eq("author_id", user.id).select("id").single());
    if (existing?.media_path) await storage.remove("murmur-stories", existing.media_path).catch(() => null);
    return deleted;
  }
};

export const accountRestrictions = {
  current: async (userId = null) => {
    // The caller can pass the already-authenticated session user ID, avoiding
    // an extra auth.getUser() network round trip during application startup.
    const targetUserId = userId || (await requireUser()).id;
    const now = new Date().toISOString();
    return throwIfError(await supabase.from("account_restrictions")
      .select("id,user_id,status,reason_code,reason,starts_at,ends_at,scheduled_delete_at,created_at,lifted_at")
      .eq("user_id", targetUserId)
      .in("status", ["suspended", "terminated", "scheduled_deletion", "deleted"])
      .is("lifted_at", null)
      .lte("starts_at", now)
      .or("ends_at.is.null,ends_at.gt." + now)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle());
  },
  appeals: async () => {
    const user = await requireUser();
    return throwIfError(await supabase.from("account_appeals")
      .select("id,user_id,restriction_id,message,status,admin_response,created_at,reviewed_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }));
  },
  submitAppeal: async ({ restrictionId = null, message }) => {
    const user = await requireUser();
    const cleanMessage = String(message || "").trim();
    if (!cleanMessage) throw new Error("Write a message before submitting your appeal.");
    if (cleanMessage.length > 5000) throw new Error("Appeals must be 5,000 characters or fewer.");
    return throwIfError(await supabase.from("account_appeals").insert({
      user_id: user.id,
      restriction_id: restrictionId,
      message: cleanMessage
    }).select("id,user_id,restriction_id,message,status,created_at").single());
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

export const reels = {
  list: async (page = 0, pageSize = PAGE_SIZE) => {
    const [from, to] = pageRange(page, pageSize);
    return throwIfError(await supabase.from("reels")
      .select("id,author_id,video_url,storage_path,title,caption,hashtags,audience,ai_label,duration_seconds,created_at,updated_at")
      .order("created_at", { ascending: false })
      .range(from, to));
  },
  create: async ({
    storagePath,
    title = "",
    caption = "",
    hashtags = [],
    audience = "public",
    aiLabel = false,
    durationSeconds = null
  }) => {
    const user = await requireUser();
    if (!storagePath) throw new Error("Upload a video before publishing the reel.");
    if (!["public", "friends", "private"].includes(audience)) {
      throw new Error("Choose a valid reel audience.");
    }
    const cleanHashtags = Array.isArray(hashtags)
      ? [...new Set(hashtags.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 30)
      : [];
    return throwIfError(await supabase.from("reels").insert({
      author_id: user.id,
      video_url: null,
      storage_path: storagePath,
      title: String(title).trim().slice(0, 120),
      caption: String(caption).trim().slice(0, 2000),
      hashtags: cleanHashtags,
      audience,
      ai_label: Boolean(aiLabel),
      duration_seconds: durationSeconds == null ? null : Math.max(0, Math.floor(Number(durationSeconds) || 0))
    }).select().single());
  },
  update: async (reelId, changes = {}) => {
    await requireUser();
    const allowed = ["title", "caption", "hashtags", "audience", "ai_label"];
    const patch = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.includes(key)));
    if (patch.audience && !["public", "friends", "private"].includes(patch.audience)) {
      throw new Error("Choose a valid reel audience.");
    }
    if (patch.title != null) patch.title = String(patch.title).trim().slice(0, 120);
    if (patch.caption != null) patch.caption = String(patch.caption).trim().slice(0, 2000);
    if (patch.hashtags != null) {
      patch.hashtags = Array.isArray(patch.hashtags)
        ? [...new Set(patch.hashtags.map(tag => String(tag).trim()).filter(Boolean))].slice(0, 30)
        : [];
    }
    patch.updated_at = new Date().toISOString();
    return throwIfError(await supabase.from("reels").update(patch).eq("id", reelId).select().single());
  },
  remove: async (reelId) => {
    const user = await requireUser();
    const existing = throwIfError(await supabase.from("reels").select("storage_path")
      .eq("id", reelId).eq("author_id", user.id).maybeSingle());
    const deleted = throwIfError(await supabase.from("reels").delete()
      .eq("id", reelId).eq("author_id", user.id).select("id").single());
    if (existing?.storage_path) await storage.remove("murmur-reels", existing.storage_path).catch(() => null);
    return deleted;
  }
};

export const userNotes = {
  listMine: async () => {
    const user = await requireUser();
    return throwIfError(await supabase.from("user_notes")
      .select("id,user_id,content,background,expires_at,created_at")
      .eq("user_id", user.id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false }));
  },
  create: async ({ content, background = null, expiresAt = null }) => {
    const user = await requireUser();
    const cleanContent = String(content || "").trim();
    if (!cleanContent) throw new Error("Write something before saving your note.");
    if (cleanContent.length > 500) throw new Error("Notes must be 500 characters or fewer.");
    return throwIfError(await supabase.from("user_notes").insert({
      user_id: user.id,
      content: cleanContent,
      background,
      expires_at: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }).select().single());
  },
  replaceMine: async ({ content, background = null, expiresAt = null }) => {
    const user = await requireUser();
    const cleanContent = String(content || "").trim();
    if (!cleanContent) throw new Error("Write something before saving your note.");
    if (cleanContent.length > 500) throw new Error("Notes must be 500 characters or fewer.");
    // Insert first so a failed save never destroys the user's existing note.
    const created = throwIfError(await supabase.from("user_notes").insert({
      user_id: user.id,
      content: cleanContent,
      background,
      expires_at: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    }).select().single());
    // Keep one active note per user; older rows must not reappear after edit/delete.
    const { error } = await supabase.from("user_notes").delete()
      .eq("user_id", user.id).neq("id", created.id);
    if (error) console.warn("[Murmur notes] Saved the new note, but could not clean up older notes:", error);
    return created;
  },
  removeMine: async () => {
    const user = await requireUser();
    return throwIfError(await supabase.from("user_notes").delete()
      .eq("user_id", user.id).select("id"));
  },
  remove: async (noteId) => {
    await requireUser();
    return throwIfError(await supabase.from("user_notes").delete().eq("id", noteId).select("id").single());
  }
};

export const storage = {
  upload: async (file, { bucket, folder = "uploads" }) => {
    const user = await requireUser();
    const rules = {
      "murmur-avatars": { max: 5 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp", "image/avif"] },
      "murmur-posts": { max: 20 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm"] },
      "murmur-stories": { max: 20 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm"] },
      "murmur-reels": { max: 100 * 1024 * 1024, types: ["video/mp4", "video/webm"] },
      "murmur-media": { max: 20 * 1024 * 1024, types: ["image/jpeg", "image/png", "image/webp", "image/avif", "video/mp4", "video/webm"] }
    };
    const rule = rules[bucket];
    if (!rule) throw new Error("A configured Murmur Storage bucket is required.");
    if (!rule.types.includes(file.type)) throw new Error("This file type is not allowed.");
    if (file.size > rule.max) throw new Error("This file is larger than the allowed limit.");
    const folders = ["profiles", "posts", "stories", "reels", "uploads"];
    const safeFolder = folders.includes(folder) ? folder : "uploads";
    const extensions = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/avif": ".avif", "video/mp4": ".mp4", "video/webm": ".webm" };
    const path = user.id + "/" + safeFolder + "/" + crypto.randomUUID() + extensions[file.type];
    const { data, error } = await supabase.storage.from(bucket).upload(path, file, {
      cacheControl: "3600", upsert: false, contentType: file.type
    });
    if (error) throw error;
    const isPublic = bucket === "murmur-avatars";
    const publicUrl = isPublic ? supabase.storage.from(bucket).getPublicUrl(data.path).data.publicUrl : null;
    return { path: data.path, bucket, url: publicUrl, isPublic };
  },
  uploadAvatar: async (file) => storage.upload(file, { bucket: "murmur-avatars", folder: "profiles" }),
  uploadMedia: async (file, folder = "posts") => {
    const bucket = ["posts", "stories", "reels"].includes(folder) ? "murmur-" + folder : "murmur-posts";
    return storage.upload(file, { bucket, folder });
  },
  url: async (bucket, path, expiresIn = 3600) => {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error) throw error;
    return data.signedUrl;
  },
  remove: async (bucket, paths) => {
    await requireUser();
    return throwIfError(await supabase.storage.from(bucket).remove(Array.isArray(paths) ? paths : [paths]));
  }
};
