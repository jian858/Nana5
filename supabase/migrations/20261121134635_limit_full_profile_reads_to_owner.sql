DROP POLICY IF EXISTS "Signed-in users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can view their own full profile" ON public.profiles;
CREATE POLICY "Users can view their own full profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE OR REPLACE VIEW public.murmur_public_profiles
WITH (security_barrier = true, security_invoker = false)
AS
SELECT id, public_id, username, display_name, bio, avatar_url, cover_url, created_at
FROM public.profiles;

REVOKE ALL ON TABLE public.murmur_public_profiles FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.murmur_public_profiles TO authenticated;
COMMENT ON VIEW public.murmur_public_profiles IS
  'Safe social profile projection. Full profile rows remain visible only to their owner.';
