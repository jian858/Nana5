alter table public.profiles
  add column if not exists public_id text;

update public.profiles
set public_id = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
where public_id is null or public_id = '';

alter table public.profiles
  alter column public_id set default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  alter column public_id set not null;

create unique index if not exists profiles_public_id_unique
  on public.profiles (public_id);

create or replace function private.generate_murmur_public_id()
returns text
language sql
volatile
set search_path = ''
as $$
  select lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 16));
$$;

create or replace function private.ensure_murmur_profile_public_id()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.public_id is null or new.public_id = '' then
    new.public_id := private.generate_murmur_public_id();
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_ensure_public_id on public.profiles;
create trigger profiles_ensure_public_id
before insert or update of public_id on public.profiles
for each row execute function private.ensure_murmur_profile_public_id();

comment on column public.profiles.public_id is 'Unique 16-character Murmur public account ID; not an authentication credential.';
