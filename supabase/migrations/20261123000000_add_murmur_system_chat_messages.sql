-- Add trusted system-authored messages to Murmur private chats.
ALTER TABLE public.messages
  ALTER COLUMN sender_id DROP NOT NULL,
  ADD COLUMN sender_type text NOT NULL DEFAULT 'user',
  ADD COLUMN sender_label text;

ALTER TABLE public.messages
  ADD CONSTRAINT messages_sender_type_check
  CHECK (
    (sender_type = 'user' AND sender_id IS NOT NULL AND sender_label IS NULL)
    OR
    (sender_type = 'system' AND sender_id IS NULL AND sender_label = 'Murmur App')
  );

CREATE OR REPLACE FUNCTION private.guard_murmur_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
  v_col text;
  v_protected text[];
BEGIN
  IF current_user IN ('postgres', 'service_role') THEN
    RETURN NEW;
  END IF;
  v_protected := CASE TG_TABLE_NAME
    WHEN 'profiles' THEN ARRAY['id','is_suspended','suspension_reason','created_at']
    WHEN 'posts' THEN ARRAY['id','author_id','created_at']
    WHEN 'comments' THEN ARRAY['id','post_id','author_id','created_at']
    WHEN 'stories' THEN ARRAY['id','author_id','created_at']
    WHEN 'conversations' THEN ARRAY['id','created_by','created_at']
    WHEN 'conversation_members' THEN ARRAY['conversation_id','user_id','joined_at']
    WHEN 'messages' THEN ARRAY['id','conversation_id','sender_id','sender_type','sender_label','created_at']
    WHEN 'friendships' THEN ARRAY['requester_id','addressee_id','created_at']
    WHEN 'notifications' THEN ARRAY['id','recipient_id','actor_id','kind','entity_id','content','created_at']
    WHEN 'reports' THEN ARRAY['id','reporter_id','reported_user_id','post_id','status','created_at']
    WHEN 'blocks' THEN ARRAY['blocker_id','blocked_id','created_at']
    WHEN 'post_audience' THEN ARRAY['post_id','user_id']
    WHEN 'post_likes' THEN ARRAY['post_id','user_id','created_at']
    ELSE ARRAY[]::text[]
  END;
  FOREACH v_col IN ARRAY v_protected LOOP
    IF (to_jsonb(OLD) -> v_col) IS DISTINCT FROM (to_jsonb(NEW) -> v_col) THEN
      RAISE EXCEPTION 'Changing protected field % is not allowed', v_col USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP POLICY IF EXISTS moderation_guard_messages_insert ON public.messages;
CREATE POLICY moderation_guard_messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK ((SELECT can_post()) AND sender_type = 'user'
    AND sender_id = (SELECT private.current_supabase_user_id()));

DROP POLICY IF EXISTS "Unblocked members can send messages as themselves" ON public.messages;
CREATE POLICY "Unblocked members can send messages as themselves" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_type = 'user'
    AND sender_id = (SELECT private.current_supabase_user_id())
    AND private.can_access_conversation(conversation_id));

UPDATE public.messages
SET sender_id = NULL, sender_type = 'system', sender_label = 'Murmur App'
WHERE id = '24e2d59f-3913-4333-ae7f-26ab29fc08eb'
  AND conversation_id = '77b94896-452b-4704-9526-06eba52e6b63';
