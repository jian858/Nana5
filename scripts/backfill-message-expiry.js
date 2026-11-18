"use strict";

/*
 * One-time backfill for messages that existed before the expiry-index trigger
 * was deployed. Run only during a quiet period with trusted Admin SDK access.
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/secure/service-account.json node scripts/backfill-message-expiry.js
 *
 * This script only writes the private messageExpiry index. It does not delete
 * messages. The scheduled function later deletes each message individually
 * after its own createdAt timestamp is at least 24 hours old.
 */

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");

initializeApp({ credential: applicationDefault() });

const RETENTION_MS = 24 * 60 * 60 * 1000;
const CHAT_PAGE_SIZE = 50;
const MESSAGE_PAGE_SIZE = 500;

async function main() {
  const db = getDatabase();
  let chatCursor = null;
  let chatsSeen = 0;
  let messagesIndexed = 0;

  while (true) {
    let chatQuery = db.ref("chats").orderByKey().limitToFirst(CHAT_PAGE_SIZE + (chatCursor ? 1 : 0));
    if (chatCursor) chatQuery = chatQuery.startAt(chatCursor);
    const chatSnapshot = await chatQuery.get();
    let chats = Object.entries(chatSnapshot.val() || {});
    if (chatCursor && chats[0] && chats[0][0] === chatCursor) chats = chats.slice(1);
    if (!chats.length) break;

    for (const [chatId] of chats) {
      const messagesRef = db.ref("chats/" + chatId + "/messages");
      let messageCursor = null;

      while (true) {
        let messageQuery = messagesRef.orderByKey().limitToFirst(MESSAGE_PAGE_SIZE + (messageCursor ? 1 : 0));
        if (messageCursor) messageQuery = messageQuery.startAt(messageCursor);
        const messageSnapshot = await messageQuery.get();
        let messages = Object.entries(messageSnapshot.val() || {});
        if (messageCursor && messages[0] && messages[0][0] === messageCursor) messages = messages.slice(1);
        if (!messages.length) break;

        const updates = {};
        for (const [messageId, message] of messages) {
          const createdAt = Number(message && message.createdAt);
          if (!Number.isFinite(createdAt) || createdAt <= 0) continue;
          updates["messageExpiry/" + chatId + "_" + messageId] = {
            chatId,
            messageId,
            createdAt,
            expiresAt: createdAt + RETENTION_MS
          };
        }

        if (Object.keys(updates).length) {
          await db.ref().update(updates);
          messagesIndexed += Object.keys(updates).length;
        }

        messageCursor = messages[messages.length - 1][0];
        if (messages.length < MESSAGE_PAGE_SIZE) break;
      }
      chatsSeen += 1;
    }

    chatCursor = chats[chats.length - 1][0];
    process.stdout.write(JSON.stringify({ chatsSeen, messagesIndexed }) + "\n");
    if (chats.length < CHAT_PAGE_SIZE) break;
  }

  process.stdout.write("Backfill complete. No chat messages were deleted.\n");
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + "\n");
  process.exitCode = 1;
});
