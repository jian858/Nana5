-- Break RLS recursion between posts and post_audience, and force privileged
-- membership lookups to bypass row policies while preserving caller identity checks.

CREATE OR REPLACE FUNCTION private.can_access_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT CASE
    WHEN p_conversation_id IS NULL
      OR private.current_supabase_user_id() IS NULL
    THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.conversation_members AS mine
      WHERE mine.conversation_id = p_conversation_id
        AND mine.user_id = private.current_supabase_user_id()
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.conversation_members AS other_member
      WHERE other_member.conversation_id = p_conversation_id
        AND other_member.user_id <> private.current_supabase_user_id()
        AND private.is_blocked_between(
          private.current_supabase_user_id(),
          other_member.user_id
        )
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION private.can_add_conversation_member(
  p_conversation_id uuid,
  p_member_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT CASE
    WHEN p_conversation_id IS NULL
      OR p_member_id IS NULL
      OR private.current_supabase_user_id() IS NULL
    THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.conversations AS c
      WHERE c.id = p_conversation_id
        AND c.created_by = private.current_supabase_user_id()
    )
    AND NOT private.is_blocked_between(
      private.current_supabase_user_id(),
      p_member_id
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION private.is_blocked_between(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'pg_catalog'
SET row_security = 'off'
AS $function$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL OR p_a = p_b THEN false
    WHEN private.current_supabase_user_id() IS NULL
      OR private.current_supabase_user_id() NOT IN (p_a, p_b) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.blocks AS b
      WHERE (b.blocker_id = p_a AND b.blocked_id = p_b)
         OR (b.blocker_id = p_b AND b.blocked_id = p_a)
    )
  END;
$function$;

CREATE OR REPLACE FUNCTION private.can_view_post(
  p_post_id uuid,
  p_author_id uuid,
  p_visibility text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT CASE
    WHEN private.current_supabase_user_id() IS NULL THEN false
    WHEN p_author_id = private.current_supabase_user_id() THEN true
    WHEN p_visibility = 'public' THEN true
    WHEN p_visibility = 'friends' THEN EXISTS (
      SELECT 1
      FROM public.friendships AS f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = p_author_id AND f.addressee_id = private.current_supabase_user_id())
          OR
          (f.addressee_id = p_author_id AND f.requester_id = private.current_supabase_user_id())
        )
    )
    WHEN p_visibility = 'specific' THEN EXISTS (
      SELECT 1
      FROM public.post_audience AS a
      WHERE a.post_id = p_post_id
        AND a.user_id = private.current_supabase_user_id()
    )
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION private.is_post_author(p_post_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.posts AS p
    WHERE p.id = p_post_id
      AND p.author_id = private.current_supabase_user_id()
  );
$function$;

REVOKE ALL ON FUNCTION private.can_access_conversation(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_add_conversation_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_blocked_between(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_view_post(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_post_author(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_access_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_add_conversation_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_blocked_between(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_post(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_post_author(uuid) TO authenticated;

DROP POLICY IF EXISTS "Users can view allowed posts" ON public.posts;
CREATE POLICY "Users can view allowed posts"
ON public.posts
FOR SELECT
TO authenticated
USING (private.can_view_post(id, author_id, visibility));

DROP POLICY IF EXISTS "Authors and selected viewers can read post audiences" ON public.post_audience;
CREATE POLICY "Authors and selected viewers can read post audiences"
ON public.post_audience
FOR SELECT
TO authenticated
USING (
  user_id = private.current_supabase_user_id()
  OR private.is_post_author(post_id)
);

DROP POLICY IF EXISTS "Authors insert post audiences" ON public.post_audience;
CREATE POLICY "Authors insert post audiences"
ON public.post_audience
FOR INSERT
TO authenticated
WITH CHECK (private.is_post_author(post_id));

DROP POLICY IF EXISTS "Authors update post audiences" ON public.post_audience;
CREATE POLICY "Authors update post audiences"
ON public.post_audience
FOR UPDATE
TO authenticated
USING (private.is_post_author(post_id))
WITH CHECK (private.is_post_author(post_id));

DROP POLICY IF EXISTS "Authors delete post audiences" ON public.post_audience;
CREATE POLICY "Authors delete post audiences"
ON public.post_audience
FOR DELETE
TO authenticated
USING (private.is_post_author(post_id));
