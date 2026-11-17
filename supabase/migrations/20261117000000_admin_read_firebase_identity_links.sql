create or replace function public.admin_list_firebase_identity_links()
returns table (
  firebase_uid text,
  supabase_id uuid,
  linked_at timestamptz,
  username text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    links.firebase_uid,
    links.supabase_id,
    links.created_at as linked_at,
    profiles.username,
    profiles.display_name
  from private.firebase_user_links as links
  left join public.profiles as profiles
    on profiles.id = links.supabase_id
  order by links.created_at desc;
$$;

revoke all on function public.admin_list_firebase_identity_links() from public, anon, authenticated;
grant execute on function public.admin_list_firebase_identity_links() to service_role;
