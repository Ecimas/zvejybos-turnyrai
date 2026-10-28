-- Kiti turnyrų formatai: taškai už rūšį, dvikovos; sezono lygos; divizionai. (Įdiegta į Supabase 2026-10-28.)

-- ---------------------------------------------------------------
-- Formatai
-- ---------------------------------------------------------------
alter table public.tournaments drop constraint if exists tournaments_format_check;
alter table public.tournaments add constraint tournaments_format_check
  check (format in ('biggest', 'top_n_sum', 'species_points', 'duels'));

-- Taškai už rūšį: rūšies koeficientas procentais (100 = ×1, 150 = ×1,5). Taškai = ilgis mm × koef. / 100.
alter table public.tournament_species add column if not exists points_pct smallint not null default 100;
alter table public.tournament_species drop constraint if exists tournament_species_points_pct_check;
alter table public.tournament_species add constraint tournament_species_points_pct_check check (points_pct between 10 and 1000);

-- Dvikovos: registracija tik iki starto (poros sudaromos iš anksto), lentelė neslepiama, be komandinės įskaitos.
create or replace function public.tournaments_format_rules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.format = 'duels' then
    new.late_join_minutes := 0;
    new.leaderboard_hidden := false;
    new.team_mode := false;
  end if;
  if new.league_id is not null and not exists (
       select 1 from public.leagues l where l.id = new.league_id and l.owner_id = new.organizer_id) then
    raise exception 'league_owner' using hint = 'Į lygą turnyrus įtraukia tik lygos savininkas';
  end if;
  return new;
end;
$$;
revoke all on function public.tournaments_format_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Sezono lygos
-- ---------------------------------------------------------------
create table if not exists public.leagues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 3 and 60
                                   and name ~ '^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_"„“()-]+$'),
  season      smallint not null check (season between 2024 and 2100),
  description text check (description is null or char_length(description) <= 500),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create unique index if not exists leagues_name_uniq on public.leagues (lower(trim(name)), season);
create index if not exists leagues_owner_idx on public.leagues (owner_id);
alter table public.leagues enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leagues' and policyname = 'leagues_select') then
    create policy leagues_select on public.leagues for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leagues' and policyname = 'leagues_insert') then
    create policy leagues_insert on public.leagues for insert to authenticated with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leagues' and policyname = 'leagues_update') then
    create policy leagues_update on public.leagues for update to authenticated
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leagues' and policyname = 'leagues_remove') then
    create policy leagues_remove on public.leagues for delete to authenticated using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'leagues' and policyname = 'leagues_not_banned_insert') then
    create policy leagues_not_banned_insert on public.leagues as restrictive for insert to authenticated with check (not (select public.is_banned()));
  end if;
end $$;
revoke update on public.leagues from anon, authenticated;
grant update (name, description) on public.leagues to authenticated;
revoke insert, delete on public.leagues from anon;

create or replace function public.leagues_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.leagues where owner_id = new.owner_id) >= 5 then
    raise exception 'league_limit' using hint = 'Galima sukurti iki 5 lygų';
  end if;
  new.name := trim(new.name);
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.leagues_before_insert() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'leagues_before_insert' and tgrelid = 'public.leagues'::regclass) then
    create trigger leagues_before_insert before insert on public.leagues for each row execute function public.leagues_before_insert();
  end if;
end $$;

alter table public.tournaments add column if not exists league_id uuid references public.leagues (id) on delete set null;
create index if not exists tournaments_league_idx on public.tournaments (league_id) where league_id is not null;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tournaments_format_rules' and tgrelid = 'public.tournaments'::regclass) then
    create trigger tournaments_format_rules before insert or update on public.tournaments
      for each row execute function public.tournaments_format_rules();
  end if;
end $$;

-- Lygos taškai už vietą (kaip F1): 25, 18, 15, 12, 10, 8, 6, 4, 2, 1.
create or replace function public.league_points(p_rank bigint)
returns integer
language sql
immutable
set search_path = public
as $$
  select coalesce((array[25, 18, 15, 12, 10, 8, 6, 4, 2, 1])[p_rank::int], 0);
$$;

-- Lygos lentelė: tik vieši lygos turnyrai; paslėptos (dar vykstančios) lentelės neįskaitomos.
create or replace function public.league_standings(p_league uuid)
returns table (rank bigint, user_id uuid, nickname text, points bigint, events bigint, wins bigint, best_place bigint)
language sql
stable
security definer
set search_path = public
as $$
  with ts as (
    select t.id from public.tournaments t
     where t.league_id = p_league and t.visibility = 'public'
       and now() >= t.starts_at
       and not (t.leaderboard_hidden and now() < t.ends_at)
  ),
  res as (
    select l.user_id, l.nickname, l.rank from ts cross join lateral public.leaderboard_all(ts.id) l
  ),
  agg as (
    select r.user_id, max(r.nickname) as nickname, sum(public.league_points(r.rank))::bigint as points,
           count(*)::bigint as events, count(*) filter (where r.rank = 1)::bigint as wins, min(r.rank)::bigint as best_place
      from res r group by r.user_id
  )
  select rank() over (order by a.points desc, a.wins desc, a.best_place asc), a.user_id, a.nickname, a.points, a.events, a.wins, a.best_place
    from agg a
   order by 1, a.nickname;
$$;

-- ---------------------------------------------------------------
-- Divizionai (pvz. „Jaunimas“, „Moterys“, „Valtis“): atskira įskaita tame pačiame turnyre.
-- ---------------------------------------------------------------
create table if not exists public.tournament_divisions (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 2 and 30
                                     and name ~ '^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_+()-]+$'),
  sort          smallint not null default 0 check (sort between 0 and 20)
);
create unique index if not exists tournament_divisions_name_uniq on public.tournament_divisions (tournament_id, lower(trim(name)));
alter table public.tournament_divisions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_divisions' and policyname = 'tournament_divisions_select') then
    create policy tournament_divisions_select on public.tournament_divisions for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_divisions' and policyname = 'tournament_divisions_write') then
    create policy tournament_divisions_write on public.tournament_divisions for all to authenticated
      using (exists (select 1 from public.tournaments t
                      where t.id = tournament_id and t.organizer_id = (select auth.uid()) and now() < t.starts_at))
      with check (exists (select 1 from public.tournaments t
                           where t.id = tournament_id and t.organizer_id = (select auth.uid()) and now() < t.starts_at));
  end if;
end $$;
revoke all on public.tournament_divisions from anon;
grant select on public.tournament_divisions to anon;

create or replace function public.tournament_divisions_limit()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.tournament_divisions where tournament_id = new.tournament_id) >= 8 then
    raise exception 'division_limit' using hint = 'Daugiausia 8 divizionai';
  end if;
  new.name := trim(new.name);
  return new;
end;
$$;
revoke all on function public.tournament_divisions_limit() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'tournament_divisions_limit' and tgrelid = 'public.tournament_divisions'::regclass) then
    create trigger tournament_divisions_limit before insert on public.tournament_divisions for each row execute function public.tournament_divisions_limit();
  end if;
end $$;

alter table public.entries add column if not exists division_id uuid references public.tournament_divisions (id) on delete set null;

-- Registruojantis galima iš karto nurodyti divizioną, bet tik šio turnyro.
create or replace function public.entries_division_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.division_id is not null and not exists (
       select 1 from public.tournament_divisions d where d.id = new.division_id and d.tournament_id = new.tournament_id) then
    new.division_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public.entries_division_guard() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'entries_division_guard' and tgrelid = 'public.entries'::regclass) then
    create trigger entries_division_guard before insert on public.entries for each row execute function public.entries_division_guard();
  end if;
end $$;

-- Divizioną keisti galima, kol registracija atvira (vėliau – nebe, kad niekas „neperbėgtų“ į silpnesnį).
create or replace function public.set_entry_division(p_tournament uuid, p_division uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t record;
begin
  select * into t from public.tournaments where id = p_tournament;
  if t.id is null or not exists (select 1 from public.entries where tournament_id = p_tournament and user_id = auth.uid()) then
    raise exception 'not allowed';
  end if;
  if not (now() < t.starts_at or public.registration_open(t.starts_at, t.ends_at, t.late_join_minutes)) then
    raise exception 'division_closed';
  end if;
  if p_division is not null and not exists (select 1 from public.tournament_divisions where id = p_division and tournament_id = p_tournament) then
    raise exception 'division_invalid';
  end if;
  update public.entries set division_id = p_division where tournament_id = p_tournament and user_id = auth.uid();
end;
$$;

-- ---------------------------------------------------------------
-- Lentelė: taškai už rūšį (kitiems formatams – kaip anksčiau).
-- ---------------------------------------------------------------
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
  base as (
    select c.user_id, c.captured_at_device,
           case when t.format = 'species_points'
                then (c.length_mm * coalesce((select ts.points_pct from public.tournament_species ts
                                               where ts.tournament_id = t.id and ts.species_id = c.species_id), 100)) / 100
                else c.length_mm end as pts
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
  eligible as (
    select b.*, row_number() over (partition by b.user_id order by b.pts desc, b.captured_at_device asc) as rn
      from base b
  ),
  scored as (
    select el.user_id,
           sum(el.pts)::bigint            as score_mm,
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
revoke all on function public.leaderboard_all(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Dvikovos: atkrintamosios poros. Dalyviai – užsiregistravę iki starto; tvarka – pastovi, bet atsitiktinė
-- (sha256 nuo turnyro ir žvejo ID). Ratų skaičius = ceil(log2(dalyvių)), turnyro laikas padalinamas po lygiai.
-- Dvikovos rezultatas – top_n ilgiausių žuvų suma rato laiku. Lygiosios – laimi aukštesnis reitingas (pirmas poroje).
-- ---------------------------------------------------------------
create or replace function public.duel_score(p_tournament uuid, p_user uuid, p_from timestamptz, p_to timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with t as (select * from public.tournaments where id = p_tournament),
  el as (
    select c.length_mm, row_number() over (order by c.length_mm desc, c.captured_at_device asc) as rn
      from public.catches c join t on true
     where c.user_id = p_user and c.status = 'approved'
       and c.length_mm >= t.min_length_mm
       and c.captured_at_device >= p_from and c.captured_at_device < p_to
       and c.captured_at_device <= c.received_at + interval '10 minutes'
       and c.received_at <= t.ends_at + interval '24 hours'
       and not exists (select 1 from public.user_bans b where b.user_id = c.user_id and (b.until is null or b.until > now()))
       and (not exists (select 1 from public.tournament_species ts where ts.tournament_id = t.id)
            or c.species_id in (select ts.species_id from public.tournament_species ts where ts.tournament_id = t.id))
  )
  select coalesce(sum(el.length_mm), 0)::bigint from el join t on true where el.rn <= t.top_n;
$$;
revoke all on function public.duel_score(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.duel_bracket(p_tournament_id uuid)
returns table (round int, rounds int, slot int, starts_at timestamptz, ends_at timestamptz, status text,
               a_id uuid, a_nick text, a_score bigint, b_id uuid, b_nick text, b_score bigint, winner_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t record;
  cur uuid[];
  nxt uuid[];
  n int;
  k int;
  i int;
  dur interval;
  ws timestamptz;
  we timestamptz;
  st text;
  sa bigint;
  sb bigint;
  w uuid;
begin
  select * into t from public.tournaments x
   where x.id = p_tournament_id and x.format = 'duels'
     and (x.visibility = 'public' or x.organizer_id = auth.uid()
          or exists (select 1 from public.entries e where e.tournament_id = x.id and e.user_id = auth.uid()));
  if t.id is null then
    return;
  end if;
  select array_agg(e.user_id order by encode(sha256(convert_to(t.id::text || e.user_id::text, 'UTF8')), 'hex') collate "C")
    into cur
    from public.entries e
   where e.tournament_id = t.id and e.joined_at <= t.starts_at;
  n := coalesce(array_length(cur, 1), 0);
  if n < 2 then
    return;
  end if;
  rounds := 0;
  while (1 << rounds) < n loop
    rounds := rounds + 1;
  end loop;
  dur := (t.ends_at - t.starts_at) / rounds;
  for k in 1..rounds loop
    ws := t.starts_at + dur * (k - 1);
    we := case when k = rounds then t.ends_at else t.starts_at + dur * k end;
    st := case when now() >= we then 'done' when now() >= ws then 'live' else 'upcoming' end;
    nxt := '{}';
    i := 1;
    while i <= array_length(cur, 1) loop
      round := k;
      slot := (i + 1) / 2;
      starts_at := ws;
      ends_at := we;
      status := st;
      a_id := cur[i];
      b_id := case when i + 1 <= array_length(cur, 1) then cur[i + 1] end;
      sa := case when st = 'upcoming' then 0 else public.duel_score(t.id, a_id, ws, we) end;
      sb := case when b_id is null or st = 'upcoming' then 0 else public.duel_score(t.id, b_id, ws, we) end;
      a_score := sa;
      b_score := case when b_id is null then null else sb end;
      w := case when b_id is null or sa >= sb then a_id else b_id end;
      winner_id := case when st = 'done' or b_id is null then w end;
      select p.nickname into a_nick from public.profiles p where p.id = a_id;
      b_nick := null;
      if b_id is not null then
        select p.nickname into b_nick from public.profiles p where p.id = b_id;
      end if;
      return next;
      nxt := nxt || w;
      i := i + 2;
    end loop;
    exit when st <> 'done';
    cur := nxt;
  end loop;
end;
$$;

revoke all on function public.league_standings(uuid) from public;
revoke all on function public.set_entry_division(uuid, uuid) from public, anon;
revoke all on function public.duel_bracket(uuid) from public;
grant execute on function public.league_standings(uuid) to anon, authenticated;
grant execute on function public.set_entry_division(uuid, uuid) to authenticated;
grant execute on function public.duel_bracket(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
