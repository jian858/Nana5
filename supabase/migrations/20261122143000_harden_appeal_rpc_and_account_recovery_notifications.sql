-- Harden public RPC execution, secure the legacy email-based appeal endpoint,
-- index moderation foreign keys, and keep system-generated recovery notices reliable.

REVOKE ALL ON FUNCTION public.murmur_is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.murmur_is_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.my_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_status() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_appeal(p_email text, p_case uuid, p_message text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid;
  a public.moderation_actions;
  r public.account_restrictions;
  v_appeal_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sign in is required to submit an appeal.';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) > 254 THEN
    RAISE EXCEPTION 'Enter the email address on the Murmur account.';
  END IF;
  IF char_length(trim(coalesce(p_message, ''))) < 10 OR char_length(p_message) > 2000 THEN
    RAISE EXCEPTION 'Write between 10 and 2000 characters.';
  END IF;

  SELECT u.id INTO v_user_id
  FROM auth.users AS u
  WHERE u.id = auth.uid()
    AND lower(u.email) = lower(trim(p_email))
  LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'The case or account email could not be verified.';
  END IF;

  SELECT * INTO a
  FROM public.moderation_actions
  WHERE id = p_case
    AND user_id = v_user_id
    AND appealable
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now());

  IF a.id IS NULL THEN
    SELECT * INTO r
    FROM public.account_restrictions
    WHERE id = p_case
      AND user_id = v_user_id
      AND lifted_at IS NULL
      AND status IN ('suspended', 'scheduled_deletion')
      AND starts_at <= now()
      AND (ends_at IS NULL OR ends_at > now());
    IF r.id IS NULL THEN
      RAISE EXCEPTION 'This case cannot be appealed.';
    END IF;

    INSERT INTO public.moderation_actions
      (user_id, type, reason, expires_at, appealable, restriction_id)
    VALUES
      (v_user_id, 'suspension', r.reason, r.ends_at, true, r.id)
    RETURNING * INTO a;
  END IF;

  INSERT INTO public.appeals(action_id, user_id, message)
  VALUES (a.id, v_user_id, trim(p_message))
  RETURNING id INTO v_appeal_id;
  RETURN v_appeal_id;
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'This case was already appealed.';
END;
$function$;

REVOKE ALL ON FUNCTION public.submit_appeal(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_appeal(text, uuid, text) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS appeals_reviewed_by_idx
  ON public.appeals (reviewed_by);
CREATE INDEX IF NOT EXISTS appeals_user_id_idx
  ON public.appeals (user_id);
CREATE INDEX IF NOT EXISTS moderation_actions_issued_by_idx
  ON public.moderation_actions (issued_by);
CREATE INDEX IF NOT EXISTS moderation_actions_restriction_id_idx
  ON public.moderation_actions (restriction_id);
CREATE INDEX IF NOT EXISTS verified_badge_requests_reviewer_id_idx
  ON public.verified_badge_requests (reviewer_id);

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.notify_account_recovered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.account_restrictions AS ar
       WHERE ar.user_id = NEW.user_id
         AND ar.lifted_at IS NULL
         AND ar.status IN ('suspended', 'terminated', 'scheduled_deletion', 'deleted')
         AND ar.starts_at <= NEW.lifted_at
         AND (ar.ends_at IS NULL OR ar.ends_at > NEW.lifted_at)
     )
     AND NOT EXISTS (
       SELECT 1
       FROM public.moderation_actions AS ma
       WHERE ma.user_id = NEW.user_id
         AND ma.revoked_at IS NULL
         AND ma.type IN ('suspension', 'ban', 'termination')
         AND (ma.expires_at IS NULL OR ma.expires_at > NEW.lifted_at)
     )
  THEN
    INSERT INTO public.notifications
      (recipient_id, actor_id, kind, entity_id, content)
    SELECT
      NEW.user_id,
      NULL,
      'account_recovered',
      NEW.id,
      'Your Murmur account was restored on '
        || to_char(NEW.lifted_at AT TIME ZONE 'UTC', 'FMMonth DD, YYYY "at" HH12:MI AM')
        || ' UTC. All account restrictions have been lifted, and you can now sign in and use Murmur again. Case ID: '
        || NEW.id::text
    WHERE EXISTS (
      SELECT 1 FROM public.profiles AS p WHERE p.id = NEW.user_id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS account_restriction_recovered_notification ON public.account_restrictions;
CREATE TRIGGER account_restriction_recovered_notification
AFTER UPDATE OF lifted_at ON public.account_restrictions
FOR EACH ROW
WHEN (OLD.lifted_at IS NULL AND NEW.lifted_at IS NOT NULL)
EXECUTE FUNCTION private.notify_account_recovered();
