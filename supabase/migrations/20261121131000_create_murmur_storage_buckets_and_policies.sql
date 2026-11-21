insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('murmur-avatars','murmur-avatars',true,10485760,array['image/jpeg','image/png','image/webp','image/avif']),
  ('murmur-posts','murmur-posts',true,20971520,array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']),
  ('murmur-stories','murmur-stories',true,20971520,array['image/jpeg','image/png','image/webp','image/avif','video/mp4','video/webm']),
  ('murmur-reels','murmur-reels',true,104857600,array['video/mp4','video/webm'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Murmur public media read" on storage.objects;
create policy "Murmur public media read"
on storage.objects for select
to public
using (bucket_id in ('murmur-avatars','murmur-posts','murmur-stories','murmur-reels'));

drop policy if exists "Murmur users upload own media" on storage.objects;
create policy "Murmur users upload own media"
on storage.objects for insert
to authenticated
with check (
  bucket_id in ('murmur-avatars','murmur-posts','murmur-stories','murmur-reels')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Murmur users update own media" on storage.objects;
create policy "Murmur users update own media"
on storage.objects for update
to authenticated
using (
  bucket_id in ('murmur-avatars','murmur-posts','murmur-stories','murmur-reels')
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id in ('murmur-avatars','murmur-posts','murmur-stories','murmur-reels')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Murmur users delete own media" on storage.objects;
create policy "Murmur users delete own media"
on storage.objects for delete
to authenticated
using (
  bucket_id in ('murmur-avatars','murmur-posts','murmur-stories','murmur-reels')
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
