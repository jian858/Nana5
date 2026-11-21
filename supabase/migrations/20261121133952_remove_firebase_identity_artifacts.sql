-- Retire Firebase authentication and preserve recoverable profile/device history.
DROP FUNCTION IF EXISTS public.admin_ensure_separate_admin_id(text);
DROP FUNCTION IF EXISTS public.admin_list_murmur_user_ids();
DROP FUNCTION IF EXISTS public.ensure_murmur_user();

ALTER TABLE private.firebase_user_links RENAME TO murmur_legacy_account_archive;
ALTER TABLE private.murmur_legacy_account_archive RENAME COLUMN supabase_id TO legacy_supabase_id;
ALTER TABLE private.murmur_legacy_account_archive DROP COLUMN firebase_uid;

ALTER TABLE private.murmur_device_accounts DROP CONSTRAINT murmur_device_accounts_pkey;
ALTER TABLE private.murmur_device_accounts DROP COLUMN firebase_uid;
ALTER TABLE private.murmur_device_accounts
  ADD CONSTRAINT murmur_device_accounts_pkey PRIMARY KEY (visitor_id, supabase_id);

DROP TABLE public.murmur_admin_identity_map;
DROP TABLE private.murmur_admin_identities;

ALTER TABLE private.murmur_legacy_account_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.murmur_legacy_account_archive FROM PUBLIC, anon, authenticated;
