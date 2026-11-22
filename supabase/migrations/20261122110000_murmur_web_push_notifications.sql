-- Murmur Web Push subscriptions and server-only VAPID configuration.
-- The VAPID private key is provisioned separately in private.murmur_push_config
-- and must never be committed to source control.

create table if not exists public.murmur_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null check (jsonb_typeof(subscription) = 'object'),
  device_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.murmur_push_subscriptions enable row level security;
grant select, insert, update, delete on public.murmur_push_subscriptions to authenticated;

drop policy if exists "Users read own push subscriptions" on public.murmur_push_subscriptions;
create policy "Users read own push subscriptions"
  on public.murmur_push_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users add own push subscriptions" on public.murmur_push_subscriptions;
create policy "Users add own push subscriptions"
  on public.murmur_push_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users update own push subscriptions" on public.murmur_push_subscriptions;
create policy "Users update own push subscriptions"
  on public.murmur_push_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users remove own push subscriptions" on public.murmur_push_subscriptions;
create policy "Users remove own push subscriptions"
  on public.murmur_push_subscriptions for delete to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.murmur_push_delivery_claims (
  message_id uuid primary key references public.messages(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.murmur_push_delivery_claims enable row level security;
revoke all on public.murmur_push_delivery_claims from public, anon, authenticated;
grant all on public.murmur_push_delivery_claims to service_role;

create index if not exists murmur_push_subscriptions_user_id_idx
  on public.murmur_push_subscriptions(user_id);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.murmur_push_config (
  singleton boolean primary key default true check (singleton),
  vapid_public_key text not null,
  vapid_private_key text not null,
  vapid_subject text not null,
  updated_at timestamptz not null default now()
);
revoke all on private.murmur_push_config from public, anon, authenticated, service_role;

create or replace function public.get_murmur_push_config()
returns table(vapid_public_key text, vapid_private_key text, vapid_subject text)
language sql
security definer
set search_path = ''
as $$
  select c.vapid_public_key, c.vapid_private_key, c.vapid_subject
  from private.murmur_push_config as c
  where c.singleton = true
$$;

revoke all on function public.get_murmur_push_config() from public, anon, authenticated;
grant execute on function public.get_murmur_push_config() to service_role;
