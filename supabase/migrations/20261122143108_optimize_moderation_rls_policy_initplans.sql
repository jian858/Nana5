ALTER POLICY "appeals own or admin"
ON public.appeals
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT public.murmur_is_admin())
);

ALTER POLICY "moderation actions own or admin"
ON public.moderation_actions
USING (
  user_id = (SELECT auth.uid())
  OR (SELECT public.murmur_is_admin())
);