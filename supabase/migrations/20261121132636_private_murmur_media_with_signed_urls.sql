-- Keep avatars public, but make user-generated post/story/reel media private.
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS media_path text;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS media_path text;
ALTER TABLE public.stories ADD COLUMN IF NOT EXISTS media_type text;

ALTER TABLE public.reels ALTER COLUMN video_url DROP NOT NULL;
ALTER TABLE public.reels DROP CONSTRAINT IF EXISTS reels_media_source_required;
ALTER TABLE public.reels ADD CONSTRAINT reels_media_source_required
  CHECK (video_url IS NOT NULL OR storage_path IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS posts_media_path_uidx
  ON public.posts(media_path) WHERE media_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS stories_media_path_uidx
  ON public.stories(media_path) WHERE media_path IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reels_storage_path_uidx
  ON public.reels(storage_path) WHERE storage_path IS NOT NULL;

CREATE OR REPLACE FUNCTION private.can_view_murmur_media(p_bucket_id text, p_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  viewer_id uuid := auth.uid();
BEGIN
  IF viewer_id IS NULL OR p_name IS NULL THEN
    RETURN false;
  END IF;

  IF p_bucket_id = 'murmur-posts' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.posts p
      WHERE p.media_path = p_name
        AND split_part(p_name, '/', 1) = p.author_id::text
        AND (
          p.author_id = viewer_id
          OR p.visibility = 'public'
          OR (p.visibility = 'friends' AND EXISTS (
            SELECT 1 FROM public.friendships f
            WHERE f.status = 'accepted'
              AND ((f.requester_id = p.author_id AND f.addressee_id = viewer_id)
                OR (f.addressee_id = p.author_id AND f.requester_id = viewer_id))
          ))
          OR (p.visibility = 'specific' AND EXISTS (
            SELECT 1 FROM public.post_audience a
            WHERE a.post_id = p.id AND a.user_id = viewer_id
          ))
        )
    );
  ELSIF p_bucket_id = 'murmur-stories' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.stories s
      WHERE s.media_path = p_name
        AND split_part(p_name, '/', 1) = s.author_id::text
        AND s.expires_at > now()
        AND (s.author_id = viewer_id OR EXISTS (
          SELECT 1 FROM public.friendships f
          WHERE f.status = 'accepted'
            AND ((f.requester_id = s.author_id AND f.addressee_id = viewer_id)
              OR (f.addressee_id = s.author_id AND f.requester_id = viewer_id))
        ))
    );
  ELSIF p_bucket_id = 'murmur-reels' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.reels r
      WHERE r.storage_path = p_name
        AND split_part(p_name, '/', 1) = r.author_id::text
        AND (
          r.author_id = viewer_id
          OR r.audience = 'public'
          OR (r.audience = 'friends' AND EXISTS (
            SELECT 1 FROM public.friendships f
            WHERE f.status = 'accepted'
              AND ((f.requester_id = r.author_id AND f.addressee_id = viewer_id)
                OR (f.addressee_id = r.author_id AND f.requester_id = viewer_id))
          ))
        )
    );
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.can_view_murmur_media(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_murmur_media(text, text) TO authenticated;

DROP POLICY IF EXISTS "Murmur public media read" ON storage.objects;
CREATE POLICY "Murmur public avatar read"
  ON storage.objects FOR SELECT TO public USING (bucket_id = 'murmur-avatars');
CREATE POLICY "Murmur audience media read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('murmur-posts','murmur-stories','murmur-reels')
    AND private.can_view_murmur_media(bucket_id, name));

UPDATE storage.buckets
SET public = CASE WHEN id = 'murmur-avatars' THEN true ELSE false END,
    file_size_limit = CASE id
      WHEN 'murmur-avatars' THEN 5242880
      WHEN 'murmur-posts' THEN 20971520
      WHEN 'murmur-stories' THEN 20971520
      WHEN 'murmur-reels' THEN 104857600
      WHEN 'murmur-media' THEN 20971520
      ELSE file_size_limit
    END,
    allowed_mime_types = CASE id
      WHEN 'murmur-avatars' THEN ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]
      WHEN 'murmur-posts' THEN ARRAY['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']::text[]
      WHEN 'murmur-stories' THEN ARRAY['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']::text[]
      WHEN 'murmur-reels' THEN ARRAY['video/mp4','video/webm']::text[]
      WHEN 'murmur-media' THEN ARRAY['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']::text[]
      ELSE allowed_mime_types
    END
WHERE id IN ('murmur-avatars','murmur-posts','murmur-stories','murmur-reels','murmur-media');
