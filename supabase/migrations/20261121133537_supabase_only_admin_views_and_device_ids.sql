-- Remove legacy Firebase identity fields from admin-facing views.
CREATE OR REPLACE VIEW public.admin_murmur_phone_accounts
WITH (security_invoker = true)
AS
SELECT
  d.visitor_id,
  d.phone_code,
  d.first_seen_at,
  d.last_seen_at,
  count(a.supabase_id)::integer AS linked_accounts,
  (count(a.supabase_id) > 1) AS duplicate_phone,
  CASE
    WHEN count(a.supabase_id) > 1
      THEN 'Duplicate Device ' || coalesce(nullif(ltrim(split_part(d.phone_code, '-', 2), '0'), ''), '0')
    ELSE d.phone_code
  END AS admin_label,
  coalesce(
    jsonb_agg(jsonb_build_object(
      'supabase_id', a.supabase_id,
      'murmur_id', p.public_id,
      'username', p.username,
      'display_name', p.display_name,
      'first_linked_at', a.first_linked_at,
      'last_linked_at', a.last_linked_at
    )) FILTER (WHERE a.supabase_id IS NOT NULL),
    '[]'::jsonb
  ) AS accounts
FROM private.murmur_visitor_devices d
LEFT JOIN private.murmur_device_accounts a ON a.visitor_id = d.visitor_id
LEFT JOIN public.profiles p ON p.id = a.supabase_id
GROUP BY d.visitor_id, d.phone_code, d.first_seen_at, d.last_seen_at;

DROP VIEW IF EXISTS public.admin_user_directory;
CREATE VIEW public.admin_user_directory
WITH (security_invoker = true)
AS
SELECT
  p.id AS supabase_id,
  p.public_id AS murmur_id,
  p.username,
  p.display_name,
  p.created_at,
  p.is_suspended,
  p.suspension_reason
FROM public.profiles p;

REVOKE ALL ON public.admin_murmur_phone_accounts, public.admin_user_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.admin_murmur_phone_accounts, public.admin_user_directory TO service_role;
