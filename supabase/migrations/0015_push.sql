-- Push pranešimai į telefoną.
--   push_subscriptions     – įrenginių prenumeratos (tik per save/remove funkcijas)
--   notification_settings  – kokius pranešimus žvejys nori gauti
--   notification_outbox    – siunčiamų pranešimų eilė (pildo trigeriai, siunčia Edge funkcija send-push)
--   tournament_ranks       – paskutinės žinomos vietos (kad žinotume, ką aplenkė)
-- Pranešimų klaidos niekada nesugadina pagrindinių veiksmų (moderavimo, pranešimų rašymo).

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
  p256dh     text not null check (char_length(p256dh) between 20 and 200),
  auth       text not null check (char_length(auth) between 8 and 64),
  created_at timestamptz not null default now(),
  gone_at    timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id) where gone_at is null;
alter table public.push_subscriptions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_select') then
    create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke insert, update, delete on public.push_subscriptions from anon, authenticated;
revoke select on public.push_subscriptions from anon;

create table if not exists public.notification_settings (
  user_id       uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  review        boolean not null default true,
  overtaken     boolean not null default true,
  start         boolean not null default true,
  announcements boolean not null default true,
  updated_at    timestamptz not null default now()
);
alter table public.notification_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notification_settings' and policyname = 'notification_settings_own') then
    create policy notification_settings_own on public.notification_settings for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.notification_settings from anon;
revoke delete on public.notification_settings from authenticated;

create table if not exists public.notification_outbox (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('review', 'overtaken', 'start', 'announcement', 'test')),
  title      text not null,
  body       text not null,
  url        text not null default '#/',
  dedupe     text not null unique,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_count integer,
  error      text
);
create index if not exists notification_outbox_unclaimed_idx on public.notification_outbox (id) where claimed_at is null;
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

create table if not exists public.tournament_ranks (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  rank          bigint not null,
  primary key (tournament_id, user_id)
);
alter table public.tournament_ranks enable row level security;
revoke all on public.tournament_ranks from anon, authenticated;

-- Lentelė be matomumo ribojimų – tik serverio vidui (pranešimams). Viešoji leaderboard() ją apgaubia.
create or replace function public.leaderboard_all(p_tournament_id uuid)
returns table (
  rank          bigint,
  user_id       uuid,
  nickname      text,
  region        text,
  score_mm      bigint,
  counted       bigint,
  last_counted  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select * from public.tournaments where id = p_tournament_id
  ),
  eligible as (
    select c.user_id, c.length_mm, c.captured_at_device,
           row_number() over (partition by c.user_id
                              order by c.length_mm desc, c.captured_at_device asc) as rn
      from public.catches c
      join t on true
      join public.entries e on e.tournament_id = t.id and e.user_id = c.user_id
     where c.status = 'approved'
       and c.length_mm >= t.min_length_mm
       and c.captured_at_device >= t.starts_at
       and c.captured_at_device >= e.joined_at   -- vėlai prisijungusiam – tik po prisijungimo pagautos
       and not exists (select 1 from public.user_bans b    -- užblokuoto žvejo rezultatai nerodomi
                        where b.user_id = c.user_id and (b.until is null or b.until > now()))
       and c.captured_at_device <  t.ends_at
       and c.captured_at_device <= c.received_at + interval '10 minutes'
       and c.received_at <= t.ends_at + interval '24 hours'
       and (not exists (select 1 from public.tournament_species ts where ts.tournament_id = t.id)
            or c.species_id in (select ts.species_id from public.tournament_species ts
                                 where ts.tournament_id = t.id))
  ),
  scored as (
    select el.user_id,
           sum(el.length_mm)::bigint      as score_mm,
           count(*)::bigint               as counted,
           max(el.captured_at_device)     as last_counted
      from eligible el
      join t on true
     where el.rn <= case when t.format = 'biggest' then 1 else t.top_n end
     group by el.user_id
  ),
  ranked as (
    select rank() over (order by s.score_mm desc, s.last_counted asc) as rank,
           s.user_id, p.nickname, p.region, s.score_mm, s.counted, s.last_counted
      from scored s
      join public.profiles p on p.id = s.user_id
  )
  select r.rank, r.user_id, r.nickname, r.region, r.score_mm, r.counted, r.last_counted
    from ranked r
   order by r.rank, r.nickname;
$$;

create or replace function public.leaderboard(p_tournament_id uuid)
returns table (
  rank          bigint,
  user_id       uuid,
  nickname      text,
  region        text,
  score_mm      bigint,
  counted       bigint,
  last_counted  timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select * from public.tournaments
     where id = p_tournament_id
       and (visibility = 'public'
            or organizer_id = auth.uid()
            or exists (select 1 from public.entries e
                        where e.tournament_id = p_tournament_id and e.user_id = auth.uid()))
  ),
  h as (
    select (t.leaderboard_hidden and now() < t.ends_at
            and t.organizer_id is distinct from auth.uid()
            and not public.is_admin()) as hidden
      from t
  )
  select case when h.hidden then null else r.rank end,
         r.user_id, r.nickname, r.region, r.score_mm, r.counted, r.last_counted
    from public.leaderboard_all(p_tournament_id) r
    cross join h
   where not h.hidden or r.user_id = auth.uid()
   order by r.rank, r.nickname;
$$;

-- Įdėti pranešimą į eilę, jei žvejys turi įrenginį ir nėra išjungęs tokios rūšies pranešimų.
create or replace function public.notify_user(p_user uuid, p_kind text, p_title text, p_body text, p_url text, p_dedupe text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or not exists (select 1 from public.push_subscriptions where user_id = p_user and gone_at is null) then
    return false;
  end if;
  if exists (select 1 from public.notification_settings s
              where s.user_id = p_user
                and case p_kind when 'review' then not s.review when 'overtaken' then not s.overtaken
                                when 'start' then not s.start when 'announcement' then not s.announcements else false end) then
    return false;
  end if;
  insert into public.notification_outbox (user_id, kind, title, body, url, dedupe)
  values (p_user, p_kind, left(p_title, 120), left(p_body, 300), coalesce(p_url, '#/'), p_dedupe)
  on conflict (dedupe) do nothing;
  return found;
end;
$$;

-- Paspartinti siuntimą: pažadinti Edge funkciją (jei yra pg_net ir neišsiųstų pranešimų).
create or replace function public.push_kick()
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
  if not exists (select 1 from public.notification_outbox where claimed_at is null and created_at > now() - interval '1 day') then
    return;
  end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'push_token';
  if v_token is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://nhegygtobrgilwthtkel.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-token', v_token),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000);
exception when others then
  raise warning 'push_kick: %', sqlerrm;
end;
$$;

create or replace function public.notification_outbox_kick()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.push_kick();
  return null;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'notification_outbox_kick' and tgrelid = 'public.notification_outbox'::regclass) then
    create trigger notification_outbox_kick after insert on public.notification_outbox
      for each statement execute function public.notification_outbox_kick();
  end if;
end $$;

-- Vietos turnyre perskaičiuojamos; kas nukrito žemiau už p_actor – gauna „Tave aplenkė“.
create or replace function public.refresh_ranks(p_tournament uuid, p_actor uuid, p_catch uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  r record;
  v_old bigint;
  v_actor_rank bigint;
  v_actor_nick text;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found then
    return;
  end if;
  if p_actor is not null then
    select l.rank, l.nickname into v_actor_rank, v_actor_nick from public.leaderboard_all(p_tournament) l where l.user_id = p_actor;
  end if;
  for r in select * from public.leaderboard_all(p_tournament) loop
    select tr.rank into v_old from public.tournament_ranks tr where tr.tournament_id = p_tournament and tr.user_id = r.user_id;
    if v_actor_rank is not null and r.user_id <> p_actor and v_old is not null
       and r.rank > v_old and v_actor_rank < r.rank
       and not t.leaderboard_hidden and now() < t.ends_at then
      perform public.notify_user(r.user_id, 'overtaken',
        'Tave aplenkė ' || v_actor_nick,
        format('Dabar esi #%s turnyre „%s“. Laikas atsikovoti!', r.rank, t.title),
        '#/t/' || p_tournament || '/lentele',
        format('overtaken:%s:%s:%s', p_tournament, r.user_id, p_catch));
    end if;
    insert into public.tournament_ranks (tournament_id, user_id, rank) values (p_tournament, r.user_id, r.rank)
    on conflict (tournament_id, user_id) do update set rank = excluded.rank;
  end loop;
end;
$$;

-- Laimikis patvirtintas / atmestas → pranešimas savininkui; vietos turnyruose perskaičiuojamos.
create or replace function public.catches_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp text;
  v_len text;
  t record;
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  begin
    select name_lt into v_sp from public.species where id = new.species_id;
    v_len := case when new.length_mm % 10 = 0 then (new.length_mm / 10)::text
                  else replace(round(new.length_mm / 10.0, 1)::text, '.', ',') end;
    if new.status = 'approved' then
      perform public.notify_user(new.user_id, 'review', 'Laimikis patvirtintas',
        format('%s %s cm – patvirtinta ir įskaityta turnyruose.', coalesce(v_sp, 'Žuvis'), v_len),
        '#/l/' || new.id, format('review:%s:approved', new.id));
    else
      perform public.notify_user(new.user_id, 'review', 'Laimikis atmestas',
        format('%s %s cm. Priežastis: %s', coalesce(v_sp, 'Žuvis'), v_len, coalesce(new.reject_reason, 'nenurodyta')),
        '#/l/' || new.id, format('review:%s:rejected', new.id));
    end if;
    for t in select tt.id from public.tournaments tt
               join public.entries e on e.tournament_id = tt.id and e.user_id = new.user_id
              where now() >= tt.starts_at and now() < tt.ends_at + interval '24 hours'
                and new.captured_at_device >= tt.starts_at and new.captured_at_device < tt.ends_at loop
      perform public.refresh_ranks(t.id, case when new.status = 'approved' then new.user_id end, new.id);
    end loop;
  exception when others then
    raise warning 'catches_notify: %', sqlerrm;
  end;
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'catches_notify' and tgrelid = 'public.catches'::regclass) then
    create trigger catches_notify after update of status on public.catches
      for each row execute function public.catches_notify();
  end if;
end $$;

-- Organizatoriaus pranešimas → visiems dalyviams (išskyrus autorių).
create or replace function public.announcements_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_title text; e record;
begin
  begin
    select title into v_title from public.tournaments where id = new.tournament_id;
    for e in select user_id from public.entries where tournament_id = new.tournament_id and user_id <> new.author_id loop
      perform public.notify_user(e.user_id, 'announcement', '„' || v_title || '“', new.message,
        '#/t/' || new.tournament_id, format('ann:%s:%s', new.id, e.user_id));
    end loop;
  exception when others then
    raise warning 'announcements_notify: %', sqlerrm;
  end;
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'announcements_notify' and tgrelid = 'public.tournament_announcements'::regclass) then
    create trigger announcements_notify after insert on public.tournament_announcements
      for each row execute function public.announcements_notify();
  end if;
end $$;

-- „Rytoj startas“: kas valandą – turnyrai, prasidedantys po 23–25 val.
create or replace function public.notify_upcoming_starts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare r record; n integer := 0;
begin
  for r in select e.user_id, t.id, t.title, t.starts_at
             from public.tournaments t join public.entries e on e.tournament_id = t.id
            where t.starts_at >= now() + interval '23 hours' and t.starts_at < now() + interval '25 hours' loop
    if public.notify_user(r.user_id, 'start', 'Rytoj startas: „' || r.title || '“',
         'Turnyras prasideda rytoj ' || to_char(r.starts_at at time zone 'Europe/Vilnius', 'HH24:MI') || '. Paruošk liniuotę – sėkmės!',
         '#/t/' || r.id, format('start:%s:%s', r.id, r.user_id)) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Prenumeratos išsaugojimas: įrenginys priskiriamas tam, kas dabar prisijungęs (iki 10 įrenginių).
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now(), gone_at = null;
  update public.push_subscriptions set gone_at = now()
   where id in (select id from public.push_subscriptions where user_id = v_uid and gone_at is null
                 order by created_at desc offset 10);
end;
$$;

create or replace function public.remove_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.push_subscriptions set gone_at = now()
   where endpoint = p_endpoint and user_id = auth.uid() and gone_at is null;
end;
$$;

create or replace function public.send_test_push()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  return public.notify_user(auth.uid(), 'test', 'Pranešimai veikia!',
    'Taip gausi žinutes apie laimikius, lentelę ir turnyrų startus.', '#/profilis',
    format('test:%s:%s', auth.uid(), floor(extract(epoch from now()) / 30)));
end;
$$;

-- Edge funkcijai (tik service_role): nustatymai iš Vault, eilės paėmimas ir rezultatai.
create or replace function public.push_config()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return (select jsonb_object_agg(name, decrypted_secret) from vault.decrypted_secrets
           where name in ('vapid_public', 'vapid_private', 'vapid_subject', 'push_token'));
end;
$$;

create or replace function public.push_claim(p_limit integer default 100)
returns table (id bigint, kind text, title text, body text, url text, subs jsonb)
language sql
security definer
set search_path = public
as $$
  with c as (
    update public.notification_outbox o set claimed_at = now()
     where o.id in (select x.id from public.notification_outbox x
                     where x.claimed_at is null and x.created_at > now() - interval '1 day'
                     order by x.id limit least(greatest(p_limit, 1), 500)
                     for update skip locked)
    returning o.*
  )
  select c.id, c.kind, c.title, c.body, c.url,
         coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
                     from public.push_subscriptions s where s.user_id = c.user_id and s.gone_at is null), '[]'::jsonb)
    from c;
$$;

create or replace function public.push_done(p_results jsonb, p_gone text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_outbox o
     set sent_count = r.sent, error = left(r.error, 300)
    from jsonb_to_recordset(coalesce(p_results, '[]'::jsonb)) as r(id bigint, sent integer, error text)
   where o.id = r.id;
  update public.push_subscriptions set gone_at = now()
   where endpoint = any (coalesce(p_gone, '{}'::text[])) and gone_at is null;
end;
$$;

revoke all on function public.leaderboard_all(uuid) from public, anon, authenticated;
revoke all on function public.notify_user(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.push_kick() from public, anon, authenticated;
revoke all on function public.notification_outbox_kick() from public, anon, authenticated;
revoke all on function public.refresh_ranks(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.catches_notify() from public, anon, authenticated;
revoke all on function public.announcements_notify() from public, anon, authenticated;
revoke all on function public.notify_upcoming_starts() from public, anon, authenticated;
revoke all on function public.push_config() from public, anon, authenticated;
revoke all on function public.push_claim(integer) from public, anon, authenticated;
revoke all on function public.push_done(jsonb, text[]) from public, anon, authenticated;
revoke all on function public.save_push_subscription(text, text, text) from public, anon;
revoke all on function public.remove_push_subscription(text) from public, anon;
revoke all on function public.send_test_push() from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
grant execute on function public.remove_push_subscription(text) to authenticated;
grant execute on function public.send_test_push() to authenticated;
grant execute on function public.leaderboard(uuid) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.push_config() to service_role;
    grant execute on function public.push_claim(integer) to service_role;
    grant execute on function public.push_done(jsonb, text[]) to service_role;
  end if;
end $$;

-- Supabase: pg_net (Edge funkcijos žadinimas) ir pg_cron (kas minutę – siuntimas, kas valandą – „rytoj startas“).
-- Vietinėje testų bazėje jų nėra – praleidžiama.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('push-send', '* * * * *', 'select public.push_kick()');
    perform cron.schedule('push-start-reminders', '7 * * * *', 'select public.notify_upcoming_starts()');
  end if;
end;
$$;

notify pgrst, 'reload schema';
