-- ============================================================
-- Chat moderation for Supabase
-- Run once: Supabase Dashboard -> SQL Editor -> paste -> Run
-- (If it says a table "already exists", you already have one: see the notes in chat)
-- ============================================================

-- 1) TABLES ---------------------------------------------------

create table public.profiles (
  id       uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  role     text not null default 'user' check (role in ('user', 'mod', 'admin'))
);
create unique index profiles_username_key on public.profiles (lower(username));

create table public.messages (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  username   text not null,
  content    text not null check (char_length(content) between 1 and 500),
  created_at timestamptz not null default now()
);

create table public.account_actions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  status     text not null check (status in ('suspended', 'banned', 'terminated', 'deleted')),
  reason     text,
  ends_on    timestamptz,   -- suspensions only
  appeal_by  timestamptz,   -- suspended + banned
  export_by  timestamptz,   -- terminated
  restore_by timestamptz,   -- deleted
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at  timestamptz    -- filled in by /unban
);
create index on public.account_actions (user_id);

-- 2) AUTOMATIC PROFILES + MESSAGE AUTHOR ----------------------

-- New signups get a profile (username comes from signUp options.data.username)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare uname text;
begin
  uname := regexp_replace(
    coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1)),
    '[^A-Za-z0-9_]', '', 'g');
  if uname = '' or exists (select 1 from public.profiles where lower(username) = lower(uname)) then
    uname := coalesce(nullif(uname, ''), 'user') || substr(replace(new.id::text, '-', ''), 1, 4);
  end if;
  insert into public.profiles (id, username) values (new.id, uname);
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Profiles for users who signed up before this script (rename them later)
insert into public.profiles (id, username)
select id, 'user' || substr(replace(id::text, '-', ''), 1, 6) from auth.users
on conflict do nothing;

-- The server fills in who sent the message, so nobody can fake it
create or replace function public.set_message_author() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id  := auth.uid();
  new.username := (select username from public.profiles where id = auth.uid());
  return new;
end $$;

create trigger messages_set_author before insert on public.messages
  for each row execute function public.set_message_author();

-- 3) HELPERS --------------------------------------------------

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('mod', 'admin'));
$$;

create or replace function public.is_blocked(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.account_actions
    where user_id = uid and lifted_at is null and (ends_on is null or ends_on > now())
  );
$$;

-- 4) THE CHAT COMMANDS (the website calls these) --------------

-- /ban /suspend /terminate /delete  ->  returns the case ID
create or replace function public.moderate(
  p_username text, p_status text, p_reason text default null, p_days int default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  target_id   uuid;
  target_role text;
  new_id      bigint;
begin
  if not public.is_staff() then raise exception 'You are not allowed to do that'; end if;
  if p_status not in ('suspended', 'banned', 'terminated', 'deleted') then
    raise exception 'Unknown action %', p_status;
  end if;

  select id, role into target_id, target_role
    from public.profiles where lower(username) = lower(p_username);
  if target_id is null then raise exception 'User "%" not found', p_username; end if;
  if target_id = auth.uid() then raise exception 'You cannot do that to yourself'; end if;
  if target_role <> 'user'
     and not exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    raise exception 'Only admins can act on staff';
  end if;

  insert into public.account_actions
    (user_id, status, reason, ends_on, appeal_by, export_by, restore_by, created_by)
  values (
    target_id, p_status, left(p_reason, 500),
    case when p_status = 'suspended'
         then now() + make_interval(days => least(greatest(coalesce(p_days, 7), 1), 365)) end,
    case when p_status in ('suspended', 'banned') then now() + interval '14 days' end,
    case when p_status = 'terminated' then now() + interval '30 days' end,
    case when p_status = 'deleted'    then now() + interval '30 days' end,
    auth.uid()
  ) returning id into new_id;

  return 'A-' || new_id;
end $$;

-- /unban  ->  returns how many actions were lifted
create or replace function public.lift_actions(p_username text) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_staff() then raise exception 'You are not allowed to do that'; end if;
  update public.account_actions set lifted_at = now()
   where lifted_at is null
     and user_id = (select id from public.profiles where lower(username) = lower(p_username));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.moderate(text, text, text, int), public.lift_actions(text) from public, anon;
grant  execute on function public.moderate(text, text, text, int), public.lift_actions(text) to authenticated;

-- 5) SECURITY (row level security) ----------------------------

alter table public.profiles        enable row level security;
alter table public.messages        enable row level security;
alter table public.account_actions enable row level security;

grant select         on public.profiles, public.account_actions to authenticated;
grant select, insert on public.messages                         to authenticated;

create policy "profiles: read" on public.profiles
  for select to authenticated using (true);

-- banned / suspended users can't read or send messages
create policy "messages: read" on public.messages
  for select to authenticated using (not public.is_blocked(auth.uid()));
create policy "messages: send" on public.messages
  for insert to authenticated with check (not public.is_blocked(auth.uid()));

-- you can see your own actions (for your pop-up); staff see everything.
-- Nobody can write to this table directly, only through moderate() / lift_actions()
create policy "actions: read" on public.account_actions
  for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- 6) REALTIME (instant messages + instant pop-up) -------------

alter publication supabase_realtime add table public.messages, public.account_actions;

-- 7) MAKE YOURSELF ADMIN -> EDIT the email and name, then run --

update public.profiles
   set role = 'admin', username = 'YourName'
 where id = (select id from auth.users where email = 'you@example.com');
