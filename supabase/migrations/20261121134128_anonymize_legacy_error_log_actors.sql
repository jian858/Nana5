-- Keep historical error diagnostics but remove unprefixed legacy identity values.
UPDATE public.murmur_error_logs
SET actor_key = 'legacy:anonymous'
WHERE actor_key NOT LIKE 'supabase:%';
