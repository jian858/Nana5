-- Allow signed-in Murmur users to query the safe public profile directory.
-- Row visibility remains controlled by the existing RLS policy.
GRANT SELECT ON TABLE public.murmur_public_profiles TO authenticated;
