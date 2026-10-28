-- Push raktai sukuriami pačiame Supabase: VAPID porą sugeneruoja Edge funkcija send-push (WebCrypto)
-- ir išsaugo Vault per push_init(); kvietimo raktą (push_token) sukuria duomenų bazė.
-- Privatus raktas niekur neišeina už Supabase ribų.

create or replace function public.push_init(p_public text, p_private text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from vault.decrypted_secrets where name = 'vapid_private') then
    return false;
  end if;
  if p_public !~ '^[A-Za-z0-9_-]{87}$' or p_private !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'bad_keys';
  end if;
  perform vault.create_secret(p_public, 'vapid_public', 'Web Push VAPID viešas raktas');
  perform vault.create_secret(p_private, 'vapid_private', 'Web Push VAPID privatus raktas');
  if not exists (select 1 from vault.decrypted_secrets where name = 'vapid_subject') then
    perform vault.create_secret('mailto:zvejybosturnyrai@gmail.com', 'vapid_subject', 'Web Push VAPID kontaktas');
  end if;
  return true;
end;
$$;

-- Viešas VAPID raktas naršyklei (prenumeratai). Null – dar nesukurtas.
create or replace function public.push_public_key()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regnamespace('vault') is null then
    return null;
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public');
end;
$$;

-- Vienkartinis paleidimas: pažadina send-push su „init“, kad sukurtų raktus.
create or replace function public.push_bootstrap()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_token text;
begin
  if to_regnamespace('net') is null or to_regnamespace('vault') is null then
    return;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'push_token';
  perform net.http_post(
    url := 'https://nhegygtobrgilwthtkel.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', v_token),
    body := '{"init":true}'::jsonb,
    timeout_milliseconds := 15000);
end;
$$;

revoke all on function public.push_init(text, text) from public, anon, authenticated;
revoke all on function public.push_bootstrap() from public, anon, authenticated;
revoke all on function public.push_public_key() from public;
grant execute on function public.push_public_key() to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_init(text, text) to service_role;
  end if;
end $$;

-- Kvietimo raktas: atsitiktinis, sukuriamas vieną kartą.
do $$
begin
  if to_regnamespace('vault') is null then
    return;  -- vietinė testų bazė
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'push_token') then
    perform vault.create_secret(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'push_token', 'send-push kvietimo raktas');
  end if;
end;
$$;

notify pgrst, 'reload schema';
