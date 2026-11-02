-- Administravimo panelė: daugiau funkcijų jungiklių, pakeitimų žurnalas, skelbimas visiems.
-- Išjungta funkcija tik neleidžia kurti naujo (duomenys neištrinami; įjungus viskas grįžta).

-- ---------------------------------------------------------------- Nauji jungikliai
insert into public.app_features (key) values
  ('leagues'), ('duels'), ('social_follow'), ('weather'), ('blank_trips')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- Pakeitimų žurnalas
create table if not exists public.app_feature_log (
  id         bigint generated always as identity primary key,
  key        text not null check (key ~ '^[a-z_]{2,40}$'),
  enabled    boolean not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
create index if not exists app_feature_log_at_idx on public.app_feature_log (changed_at desc);
alter table public.app_feature_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_feature_log' and policyname = 'app_feature_log_select') then
    create policy app_feature_log_select on public.app_feature_log for select to authenticated using ((select public.has_perm('roles')));
  end if;
end $$;
revoke all on public.app_feature_log from anon;
revoke insert, update, delete on public.app_feature_log from authenticated;
grant select on public.app_feature_log to authenticated;

create or replace function public.set_feature(p_key text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  update public.app_features set enabled = p_on, updated_at = now(), updated_by = auth.uid()
   where key = p_key and enabled is distinct from p_on;
  if found then
    insert into public.app_feature_log (key, enabled, changed_by) values (p_key, p_on, auth.uid());
  elsif not exists (select 1 from public.app_features where key = p_key) then
    raise exception 'feature not found';
  end if;
end;
$$;
revoke all on function public.set_feature(text, boolean) from public, anon;
grant execute on function public.set_feature(text, boolean) to authenticated;

-- ---------------------------------------------------------------- Skelbimas visiems (viena eilutė)
create table if not exists public.app_banner (
  id         smallint primary key default 1 check (id = 1),
  body       text check (body is null or char_length(trim(body)) between 3 and 240),
  tone       text not null default 'info' check (tone in ('info', 'warn')),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.app_banner enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_banner' and policyname = 'app_banner_select') then
    create policy app_banner_select on public.app_banner for select using (true);
  end if;
end $$;
revoke insert, update, delete on public.app_banner from anon, authenticated;
grant select on public.app_banner to anon, authenticated;
insert into public.app_banner (id) values (1) on conflict (id) do nothing;

-- Tuščias tekstas – skelbimas nuimamas.
create or replace function public.set_banner(p_body text, p_tone text default 'info')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_body text := nullif(trim(coalesce(p_body, '')), '');
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  if p_tone not in ('info', 'warn') then raise exception 'bad tone'; end if;
  update public.app_banner set body = v_body, tone = p_tone, updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.app_feature_log (key, enabled, changed_by) values ('banner', v_body is not null, auth.uid());
end;
$$;
revoke all on function public.set_banner(text, text) from public, anon;
grant execute on function public.set_banner(text, text) to authenticated;

-- ---------------------------------------------------------------- Jungiklių sargai (naujam turiniui)
create or replace function public.feature_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.feature_on(tg_argv[0]) then
    raise exception 'feature_off';
  end if;
  return new;
end;
$$;
revoke all on function public.feature_guard() from public, anon, authenticated;

drop trigger if exists leagues_feature_guard on public.leagues;
create trigger leagues_feature_guard before insert on public.leagues
  for each row execute function public.feature_guard('leagues');
drop trigger if exists follows_feature_guard on public.follows;
create trigger follows_feature_guard before insert on public.follows
  for each row execute function public.feature_guard('social_follow');
drop trigger if exists blank_trips_feature_guard on public.blank_trips;
create trigger blank_trips_feature_guard before insert on public.blank_trips
  for each row execute function public.feature_guard('blank_trips');

-- Turnyrai: naujų dvikovų ir įtraukimo į lygą neleidžiam, kai išjungta (esami veikia toliau).
create or replace function public.tournaments_feature_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.format = 'duels' and (tg_op = 'INSERT' or old.format is distinct from 'duels') and not public.feature_on('duels') then
    raise exception 'feature_off';
  end if;
  if new.league_id is not null and (tg_op = 'INSERT' or old.league_id is distinct from new.league_id) and not public.feature_on('leagues') then
    raise exception 'feature_off';
  end if;
  return new;
end;
$$;
revoke all on function public.tournaments_feature_guard() from public, anon, authenticated;
drop trigger if exists tournaments_feature_guard on public.tournaments;
create trigger tournaments_feature_guard before insert or update on public.tournaments
  for each row execute function public.tournaments_feature_guard();

notify pgrst, 'reload schema';
