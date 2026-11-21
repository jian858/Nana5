-- Server-side suspension enforcement and scheduled account deletion.
CREATE OR REPLACE FUNCTION private.current_supabase_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL::uuid
    WHEN NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid()) THEN NULL::uuid
    WHEN EXISTS (
      SELECT 1 FROM public.account_restrictions r
      WHERE r.user_id = auth.uid()
        AND r.status IN ('suspended', 'scheduled_deletion')
        AND r.starts_at <= pg_catalog.now()
        AND (r.ends_at IS NULL OR r.ends_at > pg_catalog.now())
    ) THEN NULL::uuid
    ELSE auth.uid()
  END;
$$;
REVOKE ALL ON FUNCTION private.current_supabase_user_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.current_supabase_user_id() TO authenticated;

DROP POLICY IF EXISTS "Users can create their own profile" ON public.profiles;
CREATE POLICY "Users can create their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT private.current_supabase_user_id()));
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT private.current_supabase_user_id()))
  WITH CHECK (id = (SELECT private.current_supabase_user_id()));

DROP POLICY IF EXISTS "Authenticated users can view public profile fields" ON public.murmur_public_profiles;
CREATE POLICY "Authenticated users can view public profile fields"
  ON public.murmur_public_profiles FOR SELECT TO authenticated
  USING ((SELECT private.current_supabase_user_id()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can create their own reels" ON public.reels;
CREATE POLICY "Users can create their own reels"
  ON public.reels FOR INSERT TO authenticated
  WITH CHECK (author_id = (SELECT private.current_supabase_user_id()));
DROP POLICY IF EXISTS "Users can view visible reels" ON public.reels;
CREATE POLICY "Users can view visible reels"
  ON public.reels FOR SELECT TO authenticated
  USING (
    author_id = (SELECT private.current_supabase_user_id())
    OR ((SELECT private.current_supabase_user_id()) IS NOT NULL AND audience = 'public')
    OR (audience = 'friends' AND EXISTS (
      SELECT 1 FROM public.friendships f
      WHERE f.status = 'accepted'
        AND (
          (f.requester_id = reels.author_id AND f.addressee_id = (SELECT private.current_supabase_user_id()))
          OR (f.addressee_id = reels.author_id AND f.requester_id = (SELECT private.current_supabase_user_id()))
        )
    ))
  );
DROP POLICY IF EXISTS "Authors can update their reels" ON public.reels;
CREATE POLICY "Authors can update their reels"
  ON public.reels FOR UPDATE TO authenticated
  USING (author_id = (SELECT private.current_supabase_user_id()))
  WITH CHECK (author_id = (SELECT private.current_supabase_user_id()));
DROP POLICY IF EXISTS "Authors can delete their reels" ON public.reels;
CREATE POLICY "Authors can delete their reels"
  ON public.reels FOR DELETE TO authenticated
  USING (author_id = (SELECT private.current_supabase_user_id()));

DROP POLICY IF EXISTS "Users can manage their own notes" ON public.user_notes;
CREATE POLICY "Users can manage their own notes"
  ON public.user_notes FOR ALL TO authenticated
  USING (user_id = (SELECT private.current_supabase_user_id()))
  WITH CHECK (user_id = (SELECT private.current_supabase_user_id()));

CREATE OR REPLACE FUNCTION private.can_view_murmur_media(p_bucket_id text, p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  viewer_id uuid := private.current_supabase_user_id();
BEGIN
  IF viewer_id IS NULL OR p_name IS NULL THEN RETURN false; END IF;
  IF p_bucket_id = 'murmur-posts' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.media_path = p_name AND split_part(p_name, '/', 1) = p.author_id::text
        AND (
          p.author_id = viewer_id OR p.visibility = 'public'
          OR (p.visibility = 'friends' AND EXISTS (
            SELECT 1 FROM public.friendships f
            WHERE f.status = 'accepted'
              AND ((f.requester_id = p.author_id AND f.addressee_id = viewer_id)
                OR (f.addressee_id = p.author_id AND f.requester_id = viewer_id))
          ))
          OR (p.visibility = 'specific' AND EXISTS (
            SELECT 1 FROM public.post_audience a WHERE a.post_id = p.id AND a.user_id = viewer_id
          ))
        )
    );
  ELSIF p_bucket_id = 'murmur-stories' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.media_path = p_name AND split_part(p_name, '/', 1) = s.author_id::text
        AND s.expires_at > pg_catalog.now()
        AND (s.author_id = viewer_id OR EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.status = 'accepted'
            AND ((f.requester_id = s.author_id AND f.addressee_id = viewer_id)
              OR (f.addressee_id = s.author_id AND f.requester_id = viewer_id))
        ))
    );
  ELSIF p_bucket_id = 'murmur-reels' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.reels r
      WHERE r.storage_path = p_name AND split_part(p_name, '/', 1) = r.author_id::text
        AND (
          r.author_id = viewer_id OR r.audience = 'public'
          OR (r.audience = 'friends' AND EXISTS (
            SELECT 1 FROM public.friendships f
            WHERE f.status = 'accepted'
              AND ((f.requester_id = r.author_id AND f.addressee_id = viewer_id)
                OR (f.addressee_id = r.author_id AND f.requester_id = viewer_id))
          ))
        )
    );
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_account_status(
  p_admin_id uuid,p_user_id uuid,p_suspended boolean,
  p_reason text DEFAULT NULL::text,p_duration_hours numeric DEFAULT NULL::numeric
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reason text := pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 500);
BEGIN
  IF p_admin_id IS NULL OR p_user_id IS NULL OR p_admin_id = p_user_id THEN
    RAISE EXCEPTION 'Invalid target account' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.murmur_admin_allowlist a WHERE a.user_id = p_user_id) THEN
    RAISE EXCEPTION 'Administrator accounts cannot be suspended or deleted' USING ERRCODE = '22023';
  END IF;
  IF p_suspended AND v_reason = '' THEN RAISE EXCEPTION 'A suspension reason is required' USING ERRCODE = '22023'; END IF;
  IF p_suspended AND p_duration_hours IS NOT NULL AND (p_duration_hours <= 0 OR p_duration_hours > 8760) THEN
    RAISE EXCEPTION 'Suspension duration must be between 1 and 8760 hours' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.account_restrictions SET status='lifted',lifted_at=v_now
  WHERE user_id=p_user_id AND status IN ('suspended','scheduled_deletion');
  IF p_suspended THEN
    UPDATE public.profiles SET is_suspended=true,suspension_reason=v_reason,updated_at=v_now
    WHERE id=p_user_id RETURNING * INTO v_profile;
    INSERT INTO public.account_restrictions(user_id,status,reason_code,reason,starts_at,ends_at,created_by)
    VALUES(p_user_id,'suspended','admin_action',v_reason,v_now,
      CASE WHEN p_duration_hours IS NULL THEN NULL
        ELSE v_now + pg_catalog.make_interval(secs => (p_duration_hours*3600)::double precision) END,p_admin_id);
  ELSE
    UPDATE public.profiles SET is_suspended=false,suspension_reason=NULL,updated_at=v_now
    WHERE id=p_user_id RETURNING * INTO v_profile;
  END IF;
  INSERT INTO public.admin_audit_log(admin_id,action,target_user_id,reason,metadata)
  VALUES(p_admin_id,CASE WHEN p_suspended THEN 'suspend_user' ELSE 'restore_user' END,p_user_id,
    CASE WHEN p_suspended THEN v_reason ELSE '' END,
    pg_catalog.jsonb_build_object('duration_hours',CASE WHEN p_suspended THEN p_duration_hours ELSE NULL END));
  RETURN pg_catalog.jsonb_build_object('id',v_profile.id,'is_suspended',v_profile.is_suspended,
    'suspension_reason',v_profile.suspension_reason);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_schedule_account_deletion(
  p_admin_id uuid,p_user_id uuid,p_reason text,p_delete_at timestamptz
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reason text := pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 500);
BEGIN
  IF p_admin_id IS NULL OR p_user_id IS NULL OR p_admin_id = p_user_id THEN
    RAISE EXCEPTION 'Invalid target account' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.murmur_admin_allowlist a WHERE a.user_id = p_user_id) THEN
    RAISE EXCEPTION 'Administrator accounts cannot be suspended or deleted' USING ERRCODE = '22023';
  END IF;
  IF v_reason = '' OR p_delete_at IS NULL OR p_delete_at <= v_now THEN
    RAISE EXCEPTION 'A reason and future deletion date are required' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.account_restrictions SET status='lifted',lifted_at=v_now
  WHERE user_id=p_user_id AND status IN ('suspended','scheduled_deletion');
  UPDATE public.profiles SET is_suspended=true,suspension_reason=v_reason,updated_at=v_now WHERE id=p_user_id;
  INSERT INTO public.account_restrictions(user_id,status,reason_code,reason,starts_at,scheduled_delete_at,created_by)
  VALUES(p_user_id,'scheduled_deletion','admin_action',v_reason,v_now,p_delete_at,p_admin_id);
  INSERT INTO public.admin_audit_log(admin_id,action,target_user_id,reason,metadata)
  VALUES(p_admin_id,'schedule_account_deletion',p_user_id,v_reason,
    pg_catalog.jsonb_build_object('scheduled_for',p_delete_at));
  RETURN pg_catalog.jsonb_build_object('ok',true,'scheduled_for',p_delete_at);
END;
$function$;

CREATE OR REPLACE FUNCTION private.process_murmur_account_restrictions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v record; v_deleted integer := 0;
BEGIN
  WITH expired AS (
    UPDATE public.account_restrictions SET status='lifted',lifted_at=pg_catalog.clock_timestamp()
    WHERE status='suspended' AND ends_at IS NOT NULL AND ends_at <= pg_catalog.clock_timestamp()
    RETURNING user_id
  )
  UPDATE public.profiles p SET is_suspended=false,suspension_reason=NULL,updated_at=pg_catalog.clock_timestamp()
  WHERE p.id IN (SELECT user_id FROM expired)
    AND NOT EXISTS (
      SELECT 1 FROM public.account_restrictions active
      WHERE active.user_id=p.id AND active.status IN ('suspended','scheduled_deletion')
        AND active.starts_at <= pg_catalog.clock_timestamp()
        AND (active.ends_at IS NULL OR active.ends_at > pg_catalog.clock_timestamp())
    );

  FOR v IN
    SELECT r.id,r.user_id,r.created_by,r.reason,r.scheduled_delete_at
    FROM public.account_restrictions r
    WHERE r.status='scheduled_deletion'
      AND r.scheduled_delete_at <= pg_catalog.clock_timestamp()
      AND NOT EXISTS (SELECT 1 FROM public.murmur_admin_allowlist a WHERE a.user_id=r.user_id)
    ORDER BY r.scheduled_delete_at
    FOR UPDATE SKIP LOCKED
  LOOP
    INSERT INTO public.admin_audit_log(admin_id,action,target_user_id,reason,metadata)
    VALUES(v.created_by,'complete_scheduled_deletion',v.user_id,v.reason,
      pg_catalog.jsonb_build_object('scheduled_for',v.scheduled_delete_at,'restriction_id',v.id));
    DELETE FROM auth.sessions WHERE user_id=v.user_id;
    DELETE FROM auth.users WHERE id=v.user_id;
    IF FOUND THEN v_deleted := v_deleted + 1; END IF;
  END LOOP;
  RETURN v_deleted;
END;
$$;
REVOKE ALL ON FUNCTION private.process_murmur_account_restrictions() FROM PUBLIC,anon,authenticated;

CREATE INDEX IF NOT EXISTS account_restrictions_scheduled_delete_idx
  ON public.account_restrictions(scheduled_delete_at)
  WHERE status='scheduled_deletion' AND scheduled_delete_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS account_restrictions_suspension_expiry_idx
  ON public.account_restrictions(ends_at)
  WHERE status='suspended' AND ends_at IS NOT NULL;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='murmur-account-restrictions';
SELECT cron.schedule('murmur-account-restrictions','*/5 * * * *',
  'SELECT private.process_murmur_account_restrictions();');
