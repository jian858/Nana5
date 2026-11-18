# Murmur 24-hour message retention

## Current pair-chat storage shape

Pair-chat messages are stored individually at:

`chats/{chatId}/messages/{messageId}`

The cleanup process never removes a whole chat. It removes only a message whose
own numeric `createdAt` timestamp is at least 24 hours old.

## Server-managed expiry index

The Firebase Functions source maintains a flat, private index at
`messageExpiry/{chatId}_{messageId}`. Each record contains the chat ID,
message ID, creation timestamp and calculated expiry timestamp.

The Realtime Database rules deny all client reads and writes to this index and
add an `expiresAt` index for the scheduled query. Only the trusted Admin SDK
Cloud Functions can manage these records.

## Functions

- `indexChatMessageExpiry`: indexes each newly created pair-chat message.
- `removeChatMessageExpiryIndex`: removes the index when a message is deleted.
- `cleanupExpiredChatMessages`: runs hourly and processes at most 500 expired
  index records per run. It checks the message's own timestamp again, removes
  voice files under `chat-audio/` when present, then deletes only that message.

If a message timestamp is newer than 24 hours, it is retained and its expiry
record is corrected. If a message is missing, only the stale index record is
removed.

## Existing message backfill

Messages created before the indexing trigger is deployed are not automatically
present in the index. Run the one-time trusted operator script
`scripts/backfill-message-expiry.js` to populate the index. It pages through
chats and messages, writes only expiry-index records, and does not delete data.

Run this script during a quiet period with a secure service-account credential
file. Never commit that credential file.

## Deployment requirements

The scheduled cleanup uses Firebase Cloud Functions v2 and Cloud Scheduler.
Confirm the Firebase project plan and scheduler requirements before deployment.
Deploy the Firebase Functions and Realtime Database rules together. Test with
a staging chat containing:
- a message older than 24 hours,
- a message younger than 24 hours,
- a voice message with an audioPath,
- a message manually deleted by its sender.

Expected result: only the old message and its associated voice file are removed;
the newer message, conversation metadata, participants, typing and seen data
remain untouched.
