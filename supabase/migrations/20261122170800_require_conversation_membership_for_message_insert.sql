-- Ensure every authenticated message insert is limited to a conversation member.
DROP POLICY IF EXISTS moderation_guard_messages_insert ON public.messages;
CREATE POLICY moderation_guard_messages_insert
  ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT can_post())
    AND sender_type = 'user'
    AND sender_id = (SELECT private.current_supabase_user_id())
    AND private.can_access_conversation(conversation_id)
  );
