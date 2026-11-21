-- Keep chat lists current when a direct conversation is created or membership changes.
alter publication supabase_realtime
  add table public.conversations, public.conversation_members;
