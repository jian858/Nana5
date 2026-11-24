-- Keep message inserts behind the moderation-aware policy. PostgreSQL combines
-- permissive policies with OR, so the legacy policy allowed inserts without
-- satisfying can_post() even when moderation_guard_messages_insert existed.
drop policy if exists "Unblocked members can send messages as themselves" on public.messages;
