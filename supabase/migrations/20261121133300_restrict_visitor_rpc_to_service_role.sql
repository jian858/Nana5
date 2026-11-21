-- The browser no longer calls this SECURITY DEFINER function directly.
-- Only the rate-limited public visitor Edge Function can invoke it with service_role.
REVOKE ALL ON FUNCTION public.record_murmur_visit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_murmur_visit(uuid, text) TO service_role;
