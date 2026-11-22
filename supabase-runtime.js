/* Murmur Supabase runtime.
 * This is the single browser entry point for Postgres, Auth, Realtime and Storage.
 * Feature modules consume window.MurmurData through the shared Supabase client.
 */
import * as data from "./supabase-data.js";
import { supabase, requireUser } from "./supabase-client.js?v=20261122-2";

window.MurmurData = Object.freeze(data);
window.MurmurSupabase = Object.freeze({
  client: supabase,
  requireUser,
  auth: data.auth,
  profiles: data.profiles,
  posts: data.posts,
  comments: data.comments,
  conversations: data.conversations,
  messages: data.messages,
  friendships: data.friendships,
  stories: data.stories,
  accountRestrictions: data.accountRestrictions,
  reports: data.reports,
  reels: data.reels,
  userNotes: data.userNotes,
  storage: data.storage
});

window.dispatchEvent(new CustomEvent("murmur:supabase-ready"));
