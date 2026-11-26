-- Murmur security hardening: restrict profile updates to user-editable fields.
-- Privileged identity, moderation, timestamps, and public IDs remain server-controlled.
REVOKE UPDATE ON TABLE public.profiles FROM authenticated;
GRANT UPDATE (username, display_name, bio, school, location, interests, avatar_url, cover_url, work, hometown, phone, birthday, gender)
ON TABLE public.profiles TO authenticated;

-- Defense in depth for private recovery and push configuration tables.
-- No anon/authenticated grants are added; server-side service access remains unchanged.
ALTER TABLE private.account_recovery_hmac_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.account_recovery_tombstones ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.murmur_push_config ENABLE ROW LEVEL SECURITY;

-- These SECURITY DEFINER RPCs are intentionally callable by signed-in users,
-- but must not be executable by anonymous clients or inherited PUBLIC grants.
REVOKE EXECUTE ON FUNCTION public.can_post() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.in_good_standing() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.murmur_is_admin() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_status() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.start_murmur_direct_conversation(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_appeal(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_appeal(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_post() TO authenticated;
GRANT EXECUTE ON FUNCTION public.in_good_standing() TO authenticated;
GRANT EXECUTE ON FUNCTION public.murmur_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_murmur_direct_conversation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_appeal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_appeal(text, uuid, text) TO authenticated;
