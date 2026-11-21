-- The legacy Firebase-keyed post table is empty, inaccessible to browser roles,
-- and no longer referenced by active code, functions, views, triggers, or foreign keys.
DROP TABLE IF EXISTS public.murmur_posts;
