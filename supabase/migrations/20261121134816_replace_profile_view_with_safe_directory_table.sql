DROP VIEW public.murmur_public_profiles;

CREATE TABLE public.murmur_public_profiles (
  id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  public_id text NOT NULL,
  username text,
  display_name text NOT NULL,
  bio text NOT NULL DEFAULT '',
  avatar_url text,
  cover_url text,
  created_at timestamptz NOT NULL
);

ALTER TABLE public.murmur_public_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.murmur_public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.murmur_public_profiles TO authenticated;

CREATE POLICY "Authenticated users can view public profile fields"
  ON public.murmur_public_profiles FOR SELECT TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION private.sync_murmur_public_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  INSERT INTO public.murmur_public_profiles (
    id, public_id, username, display_name, bio, avatar_url, cover_url, created_at
  ) VALUES (
    NEW.id, NEW.public_id, NEW.username, NEW.display_name, NEW.bio,
    NEW.avatar_url, NEW.cover_url, NEW.created_at
  )
  ON CONFLICT (id) DO UPDATE SET
    public_id = EXCLUDED.public_id,
    username = EXCLUDED.username,
    display_name = EXCLUDED.display_name,
    bio = EXCLUDED.bio,
    avatar_url = EXCLUDED.avatar_url,
    cover_url = EXCLUDED.cover_url,
    created_at = EXCLUDED.created_at;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.sync_murmur_public_profile() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_murmur_public_profile ON public.profiles;
CREATE TRIGGER sync_murmur_public_profile
AFTER INSERT OR UPDATE OF public_id, username, display_name, bio, avatar_url, cover_url, created_at
OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.sync_murmur_public_profile();

INSERT INTO public.murmur_public_profiles (
  id, public_id, username, display_name, bio, avatar_url, cover_url, created_at
)
SELECT id, public_id, username, display_name, bio, avatar_url, cover_url, created_at
FROM public.profiles
ON CONFLICT (id) DO UPDATE SET
  public_id = EXCLUDED.public_id,
  username = EXCLUDED.username,
  display_name = EXCLUDED.display_name,
  bio = EXCLUDED.bio,
  avatar_url = EXCLUDED.avatar_url,
  cover_url = EXCLUDED.cover_url,
  created_at = EXCLUDED.created_at;
