-- Retire server-only Firebase identity RPCs after disabling their Edge Function callers.
-- Historical identity/device rows remain intact in private tables for audit or future migration.
DROP FUNCTION IF EXISTS public.admin_ensure_firebase_link(text, text);
DROP FUNCTION IF EXISTS public.admin_ensure_firebase_link(text, text, text);
DROP FUNCTION IF EXISTS public.admin_set_firebase_email(text, text);
DROP FUNCTION IF EXISTS public.admin_find_firebase_link_by_email(text);
DROP FUNCTION IF EXISTS public.admin_list_firebase_identity_links();
DROP FUNCTION IF EXISTS public.admin_link_firebase_device(uuid, text, uuid);
