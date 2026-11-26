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
