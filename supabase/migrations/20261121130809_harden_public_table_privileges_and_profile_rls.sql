-- Tighten browser-role table privileges and optimize profile RLS checks.
-- RLS does not protect TRUNCATE, so browser roles must never receive it.
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM anon, authenticated;

-- Account-control records are only for authenticated users.
REVOKE ALL PRIVILEGES ON TABLE public.account_restrictions FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.account_appeals FROM anon;

-- Evaluate auth.uid() once per statement rather than once per row.
DROP POLICY IF EXISTS "Users can create their own profile" ON public.profiles;
CREATE POLICY "Users can create their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));
