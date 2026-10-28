-- Statistika savininkui: registracijos, kas prisijungę dabar ir šiandien, telefonų modeliai. (Įdiegta į Supabase 2026-10-28.)
-- Programėlė kas kelias minutes (kol atidaryta) praneša „esu čia“ + telefono modelį. Kitiems žvejams tai nerodoma;
-- savininkas mato tik suvestines (skaičius), ne kas kokį telefoną turi.

-- Paskutinis apsilankymas – atskiroje lentelėje (ne profiles, kurią mato visi): kitiems žvejams nerodoma.
create table if not exists public.user_presence (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create index if not exists user_presence_seen_idx on public.user_presence (last_seen_at);
alter table public.user_presence enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_presence' and policyname = 'user_presence_own') then
    create policy user_presence_own on public.user_presence for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.user_presence from anon;
revoke insert, update, delete on public.user_presence from authenticated;
grant select on public.user_presence to authenticated;
create index if not exists profiles_created_idx on public.profiles (created_at);

create table if not exists public.user_devices (
  user_id     uuid not null references public.profiles (id) on delete cascade,
  model       text not null check (char_length(model) between 1 and 60),
  platform    text not null check (platform in ('Android', 'iOS', 'Windows', 'macOS', 'Linux', 'Kita')),
  os_version  text check (os_version is null or char_length(os_version) <= 20),
  browser     text not null check (char_length(browser) between 1 and 30),
  installed   boolean not null default false,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  primary key (user_id, model, platform, browser)
);
create index if not exists user_devices_last_seen_idx on public.user_devices (last_seen);
alter table public.user_devices enable row level security;
do $$ begin
  -- Savo įrenginius žvejys mato (duomenų eksportui); keisti – tik per touch_presence().
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_devices' and policyname = 'user_devices_own') then
    create policy user_devices_own on public.user_devices for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.user_devices from anon;
revoke insert, update, delete on public.user_devices from authenticated;
grant select on public.user_devices to authenticated;

-- „Esu čia“: atnaujina paskutinio apsilankymo laiką ir įrenginį. Kviečiama ne dažniau nei kartą per minutę.
create or replace function public.touch_presence(p_model text, p_platform text, p_os text, p_browser text, p_installed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_model text := left(regexp_replace(coalesce(nullif(trim(p_model), ''), 'Nežinomas'), '[^A-Za-z0-9 ._()+/-]', '', 'g'), 60);
  v_platform text := case when p_platform in ('Android', 'iOS', 'Windows', 'macOS', 'Linux') then p_platform else 'Kita' end;
  v_os text := nullif(left(regexp_replace(coalesce(p_os, ''), '[^0-9._]', '', 'g'), 20), '');
  v_browser text := left(regexp_replace(coalesce(nullif(trim(p_browser), ''), 'Kita'), '[^A-Za-z0-9 ._-]', '', 'g'), 30);
begin
  if auth.uid() is null then
    return;
  end if;
  if v_model = '' then v_model := 'Nežinomas'; end if;
  if v_browser = '' then v_browser := 'Kita'; end if;
  insert into public.user_presence (user_id, last_seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set last_seen_at = now();
  -- Iki 10 skirtingų įrenginių vienam žvejui (kad niekas neprikurtų netikrų modelių)
  if exists (select 1 from public.user_devices where user_id = auth.uid() and model = v_model and platform = v_platform and browser = v_browser)
     or (select count(*) from public.user_devices where user_id = auth.uid()) < 10 then
    insert into public.user_devices (user_id, model, platform, os_version, browser, installed)
    values (auth.uid(), v_model, v_platform, v_os, v_browser, coalesce(p_installed, false))
    on conflict (user_id, model, platform, browser) do update
      set last_seen = now(), os_version = excluded.os_version, installed = public.user_devices.installed or excluded.installed;
  end if;
end;
$$;

-- Suvestinė savininkui. Laikas – Lietuvos (Europe/Vilnius) paros ribos.
create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today timestamptz := (date_trunc('day', now() at time zone 'Europe/Vilnius')) at time zone 'Europe/Vilnius';
  r jsonb;
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  select jsonb_build_object(
    'users',        (select count(*) from public.profiles),
    'new_today',    (select count(*) from public.profiles where created_at >= v_today),
    'new_7d',       (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    'new_30d',      (select count(*) from public.profiles where created_at >= now() - interval '30 days'),
    'online_now',   (select count(*) from public.user_presence where last_seen_at >= now() - interval '5 minutes'),
    'active_today', (select count(*) from public.user_presence where last_seen_at >= v_today),
    'active_7d',    (select count(*) from public.user_presence where last_seen_at >= now() - interval '7 days'),
    'active_30d',   (select count(*) from public.user_presence where last_seen_at >= now() - interval '30 days'),
    'catches_today', (select count(*) from public.catches where received_at >= v_today),
    'pending',      (select count(*) from public.catches where status = 'pending'),
    'live_tournaments', (select count(*) from public.tournaments where now() >= starts_at and now() < ends_at),
    'signups', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'count', (
               select count(*) from public.profiles p
                where (p.created_at at time zone 'Europe/Vilnius')::date = d::date)) order by d)
        from generate_series((now() at time zone 'Europe/Vilnius')::date - 29, (now() at time zone 'Europe/Vilnius')::date, interval '1 day') d), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(x order by (x->>'users')::int desc, x->>'model')
        from (select jsonb_build_object('model', model, 'platform', platform, 'users', count(distinct user_id)) as x
                from public.user_devices where last_seen >= now() - interval '90 days'
               group by model, platform
               order by count(distinct user_id) desc, model
               limit 20) m), '[]'::jsonb),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object('platform', platform, 'users', n) order by n desc)
        from (select platform, count(distinct user_id) as n from public.user_devices
               where last_seen >= now() - interval '90 days' group by platform) p), '[]'::jsonb),
    'browsers', coalesce((
      select jsonb_agg(jsonb_build_object('browser', browser, 'users', n) order by n desc)
        from (select browser, count(distinct user_id) as n from public.user_devices
               where last_seen >= now() - interval '90 days' group by browser) b), '[]'::jsonb),
    'installed', (select count(distinct user_id) from public.user_devices where installed and last_seen >= now() - interval '90 days'),
    'with_device', (select count(distinct user_id) from public.user_devices where last_seen >= now() - interval '90 days')
  ) into r;
  return r;
end;
$$;

revoke all on function public.touch_presence(text, text, text, text, boolean) from public, anon;
revoke all on function public.admin_stats() from public, anon;
grant execute on function public.touch_presence(text, text, text, text, boolean) to authenticated;
grant execute on function public.admin_stats() to authenticated;

notify pgrst, 'reload schema';
