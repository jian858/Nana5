CREATE OR REPLACE FUNCTION public.start_murmur_direct_conversation(p_target_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_conversation_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'A signed-in Murmur account is required' USING ERRCODE = '42501';
  END IF;
  IF p_target_user_id IS NULL OR p_target_user_id = v_user_id THEN
    RAISE EXCEPTION 'Choose another Murmur user to message' USING ERRCODE = '22023';
  END IF;

  SELECT mine.conversation_id INTO v_conversation_id
  FROM public.conversation_members AS mine
  JOIN public.conversation_members AS other_member
    ON other_member.conversation_id = mine.conversation_id
  WHERE mine.user_id = v_user_id
    AND other_member.user_id = p_target_user_id
    AND (
      SELECT count(*) FROM public.conversation_members AS member_count
      WHERE member_count.conversation_id = mine.conversation_id
    ) = 2
  ORDER BY mine.joined_at DESC
  LIMIT 1;

  IF v_conversation_id IS NOT NULL THEN
    RETURN v_conversation_id;
  END IF;

  INSERT INTO public.conversations (created_by)
  VALUES (v_user_id)
  RETURNING id INTO v_conversation_id;

  INSERT INTO public.conversation_members (conversation_id, user_id)
  VALUES (v_conversation_id, v_user_id), (v_conversation_id, p_target_user_id);

  RETURN v_conversation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.start_murmur_direct_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_murmur_direct_conversation(uuid) TO authenticated;
COMMENT ON FUNCTION public.start_murmur_direct_conversation(uuid) IS
  'Starts or reuses a direct chat with any unblocked user; friendship is not required.';
