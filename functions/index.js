"use strict";

const functions = require("firebase-functions/v1");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getDatabase } = require("firebase-admin/database");
const { getStorage } = require("firebase-admin/storage");
const { onValueCreated, onValueDeleted } = require("firebase-functions/v2/database");
const { onSchedule } = require("firebase-functions/v2/scheduler");

initializeApp();

/**
 * Supabase Third-Party Auth requires role=authenticated on Firebase ID tokens.
 * Preserve every existing custom claim; only set the required role claim.
 *
 * This trigger runs for newly created Firebase users. Existing users must be
 * updated with scripts/backfill-firebase-claims.js using trusted Admin SDK
 * credentials. Never run Admin SDK code in the browser.
 */
exports.setSupabaseAuthenticatedRole = functions.auth.user().onCreate(async (user) => {
  const auth = getAuth();
  const current = await auth.getUser(user.uid);
  const claims = current.customClaims || {};

  if (claims.role === "authenticated") return null;

  await auth.setCustomUserClaims(user.uid, {
    ...claims,
    role: "authenticated"
  });

  return null;
});


const MESSAGE_RETENTION_MS = 24 * 60 * 60 * 1000;
const EXPIRY_BATCH_SIZE = 500;
const expiryKey = (chatId, messageId) => String(chatId) + "_" + String(messageId);

/**
 * Maintain a private, flat expiry index for each individual pair-chat message.
 * The index is server-written and queryable by expiresAt; chat history itself
 * is never removed as a whole.
 */
exports.indexChatMessageExpiry = onValueCreated(
  "/chats/{chatId}/messages/{messageId}",
  async (event) => {
    const message = event.data.val();
    const createdAt = Number(message && message.createdAt);
    if (!message || !Number.isFinite(createdAt) || createdAt <= 0) return null;

    await getDatabase().ref("messageExpiry/" + expiryKey(event.params.chatId, event.params.messageId)).set({
      chatId: event.params.chatId,
      messageId: event.params.messageId,
      createdAt,
      expiresAt: createdAt + MESSAGE_RETENTION_MS
    });
    return null;
  }
);

exports.removeChatMessageExpiryIndex = onValueDeleted(
  "/chats/{chatId}/messages/{messageId}",
  async (event) => {
    await getDatabase().ref("messageExpiry/" + expiryKey(event.params.chatId, event.params.messageId)).remove();
    return null;
  }
);

/**
 * Delete only messages whose own createdAt timestamp is at least 24 hours old.
 * A chat, its participants, typing state, seen state and newer messages remain.
 */
exports.cleanupExpiredChatMessages = onSchedule(
  { schedule: "every 1 hours", timeZone: "UTC" },
  async () => {
    const db = getDatabase();
    const now = Date.now();
    const cutoff = now - MESSAGE_RETENTION_MS;
    const expiryRef = db.ref("messageExpiry");
    const expired = await expiryRef.orderByChild("expiresAt").endAt(now).limitToFirst(EXPIRY_BATCH_SIZE).get();
    const entries = Object.entries(expired.val() || {});

    for (const [key, entry] of entries) {
      const chatId = typeof entry.chatId === "string" ? entry.chatId : "";
      const messageId = typeof entry.messageId === "string" ? entry.messageId : "";
      if (!chatId || !messageId) {
        await expiryRef.child(key).remove();
        continue;
      }

      const messageRef = db.ref("chats/" + chatId + "/messages/" + messageId);
      const snapshot = await messageRef.get();
      if (!snapshot.exists()) {
        await expiryRef.child(key).remove();
        continue;
      }

      const message = snapshot.val() || {};
      const createdAt = Number(message.createdAt);
      if (!Number.isFinite(createdAt) || createdAt > cutoff) {
        // Keep newer or un-timestamped messages. Re-index valid newer messages.
        if (Number.isFinite(createdAt) && createdAt > 0) {
          await expiryRef.child(key).update({
            createdAt,
            expiresAt: createdAt + MESSAGE_RETENTION_MS
          });
        }
        continue;
      }

      const audioPath = typeof message.audioPath === "string" ? message.audioPath : "";
      if (audioPath.startsWith("chat-audio/") && !audioPath.includes("..")) {
        await getStorage().bucket().file(audioPath).delete({ ignoreNotFound: true });
      }
      await messageRef.remove();
      await expiryRef.child(key).remove();
    }

    return { processed: entries.length };
  }
);
