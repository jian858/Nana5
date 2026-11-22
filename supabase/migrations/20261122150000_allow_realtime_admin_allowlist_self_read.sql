-- Allow Realtime's admin visitor authorization policy to inspect only the
-- signed-in user's own allowlist row. RLS remains enabled; no other admin
-- records are readable by authenticated users.
GRANT SELECT ON TABLE public.murmur_admin_allowlist TO authenticated;

DROP POLICY IF EXISTS "Admins can read their own allowlist row"
ON public.murmur_admin_allowlist;

CREATE POLICY "Admins can read their own allowlist row"
ON public.murmur_admin_allowlist
FOR SELECT
TO authenticated
USING (user_id = (SELECT auth.uid()));
