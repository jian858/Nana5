create or replace function private.remove_friendship_when_blocked()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $function$
begin
  delete from public.friendships
  where (requester_id = new.blocker_id and addressee_id = new.blocked_id)
     or (requester_id = new.blocked_id and addressee_id = new.blocker_id);
  return new;
end;
$function$;

revoke all on function private.remove_friendship_when_blocked() from public, anon, authenticated;

drop trigger if exists murmur_remove_friendship_after_block on public.blocks;
create trigger murmur_remove_friendship_after_block
after insert on public.blocks
for each row execute function private.remove_friendship_when_blocked();
