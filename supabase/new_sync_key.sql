-- Make (or replace) your personal sync key for the "Log weight" Shortcut.
-- Run in the Supabase SQL editor after changing the email below.
-- The result shows the key ONCE: paste it straight into the Shortcut.
-- No rows back means the email matched no account (nothing was saved).
-- Never put the key in the repo or in chat. Running this again replaces it
-- (the old key stops working at once).
-- Remove the key entirely: delete from public.sync_keys where user_id = (select id from auth.users where email = 'you@example.com');

with new_key as (
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as key
), saved as (
  insert into public.sync_keys (user_id, key_hash)
  select u.id, encode(sha256(convert_to(k.key, 'UTF8')), 'hex')
    from auth.users u, new_key k
   where u.email = 'you@example.com'   -- <- your sign-in email
  on conflict (user_id) do update
    set key_hash = excluded.key_hash, created_at = now()
  returning user_id
)
select k.key as paste_into_shortcut
  from new_key k, saved;
