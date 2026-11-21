DROP FUNCTION public.admin_set_account_status(uuid, uuid, boolean, text, numeric);
CREATE FUNCTION public.admin_set_account_status(
  p_admin_id uuid,p_user_id uuid,p_suspended boolean,
  p_reason text DEFAULT NULL::text,
  p_duration_hours numeric DEFAULT NULL::numeric,
  p_reason_code text DEFAULT 'other'::text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reason text := pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 500);
  v_reason_code text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_reason_code, '')));
BEGIN
  IF p_admin_id IS NULL OR p_user_id IS NULL OR p_admin_id = p_user_id THEN
    RAISE EXCEPTION 'Invalid target account' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.murmur_admin_allowlist a WHERE a.user_id=p_user_id) THEN
    RAISE EXCEPTION 'Administrator accounts cannot be suspended or deleted' USING ERRCODE = '22023';
  END IF;
  IF p_suspended AND v_reason='' THEN RAISE EXCEPTION 'A suspension reason is required' USING ERRCODE = '22023'; END IF;
  IF p_suspended AND v_reason_code NOT IN ('spam','harassment','hate_speech','impersonation','fraud','sexual_content','violence','child_safety','repeated_violations','other') THEN
    RAISE EXCEPTION 'Choose one of the ten approved restriction reasons' USING ERRCODE = '22023';
  END IF;
  IF p_suspended AND (p_duration_hours IS NULL OR p_duration_hours<=0 OR p_duration_hours>8760) THEN
    RAISE EXCEPTION 'A suspension duration between 1 and 8760 hours is required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.account_restrictions SET status='lifted',lifted_at=v_now
  WHERE user_id=p_user_id AND status IN ('suspended','scheduled_deletion');
  IF p_suspended THEN
    UPDATE public.profiles SET is_suspended=true,suspension_reason=v_reason,updated_at=v_now
    WHERE id=p_user_id RETURNING * INTO v_profile;
    INSERT INTO public.account_restrictions(user_id,status,reason_code,reason,starts_at,ends_at,created_by)
    VALUES(p_user_id,'suspended',v_reason_code,v_reason,v_now,
      v_now+pg_catalog.make_interval(secs=>(p_duration_hours*3600)::double precision),p_admin_id);
  ELSE
    UPDATE public.profiles SET is_suspended=false,suspension_reason=NULL,updated_at=v_now
    WHERE id=p_user_id RETURNING * INTO v_profile;
  END IF;
  INSERT INTO public.admin_audit_log(admin_id,action,target_user_id,reason,metadata)
  VALUES(p_admin_id,CASE WHEN p_suspended THEN 'suspend_user' ELSE 'restore_user' END,p_user_id,
    CASE WHEN p_suspended THEN v_reason ELSE '' END,
    pg_catalog.jsonb_build_object('duration_hours',CASE WHEN p_suspended THEN p_duration_hours ELSE NULL END,
      'reason_code',CASE WHEN p_suspended THEN v_reason_code ELSE NULL END));
  RETURN pg_catalog.jsonb_build_object('id',v_profile.id,'is_suspended',v_profile.is_suspended,
    'suspension_reason',v_profile.suspension_reason);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_set_account_status(uuid,uuid,boolean,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_account_status(uuid,uuid,boolean,text,numeric,text) TO service_role;

DROP FUNCTION public.admin_schedule_account_deletion(uuid, uuid, text, timestamp with time zone);
CREATE FUNCTION public.admin_schedule_account_deletion(
  p_admin_id uuid,p_user_id uuid,p_reason text,p_delete_at timestamptz,
  p_reason_code text DEFAULT 'other'::text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reason text := pg_catalog.left(pg_catalog.btrim(coalesce(p_reason, '')), 500);
  v_reason_code text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_reason_code, '')));
BEGIN
  IF p_admin_id IS NULL OR p_user_id IS NULL OR p_admin_id=p_user_id THEN
    RAISE EXCEPTION 'Invalid target account' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.murmur_admin_allowlist a WHERE a.user_id=p_user_id) THEN
    RAISE EXCEPTION 'Administrator accounts cannot be suspended or deleted' USING ERRCODE = '22023';
  END IF;
  IF v_reason='' OR p_delete_at IS NULL OR p_delete_at<=v_now THEN
    RAISE EXCEPTION 'A reason and future deletion date are required' USING ERRCODE = '22023';
  END IF;
  IF v_reason_code NOT IN ('spam','harassment','hate_speech','impersonation','fraud','sexual_content','violence','child_safety','repeated_violations','other') THEN
    RAISE EXCEPTION 'Choose one of the ten approved restriction reasons' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.account_restrictions SET status='lifted',lifted_at=v_now
  WHERE user_id=p_user_id AND status IN ('suspended','scheduled_deletion');
  UPDATE public.profiles SET is_suspended=true,suspension_reason=v_reason,updated_at=v_now WHERE id=p_user_id;
  INSERT INTO public.account_restrictions(user_id,status,reason_code,reason,starts_at,scheduled_delete_at,created_by)
  VALUES(p_user_id,'scheduled_deletion',v_reason_code,v_reason,v_now,p_delete_at,p_admin_id);
  INSERT INTO public.admin_audit_log(admin_id,action,target_user_id,reason,metadata)
  VALUES(p_admin_id,'schedule_account_deletion',p_user_id,v_reason,
    pg_catalog.jsonb_build_object('scheduled_for',p_delete_at,'reason_code',v_reason_code));
  RETURN pg_catalog.jsonb_build_object('ok',true,'scheduled_for',p_delete_at);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_schedule_account_deletion(uuid,uuid,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_schedule_account_deletion(uuid,uuid,text,timestamptz,text) TO service_role;
