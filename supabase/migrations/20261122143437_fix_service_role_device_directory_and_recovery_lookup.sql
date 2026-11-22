-- Fix the service-role access required by the admin phone/device directory,
-- and remove a brittle JWT-role check from the service-role-only tombstone RPC.
GRANT SELECT ON TABLE private.murmur_device_accounts TO service_role;

CREATE OR REPLACE FUNCTION public.murmur_is_permanently_deleted_email(p_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM private.account_recovery_tombstones AS t
    WHERE t.email_digest = private.account_recovery_email_digest(p_email)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.murmur_is_permanently_deleted_email(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.murmur_is_permanently_deleted_email(text)
  TO service_role;
