-- Žvejybos turnyrai – pradinė schema (1 etapas)
-- Taikoma Supabase projekte: SQL Editor -> įklijuoti -> Run.
-- Principai:
--   * laimikis yra faktas ir po įkėlimo nebekeičiamas savininko;
--   * tikslios koordinatės laikomos atskiroje lentelėje ir niekada nerodomos kitiems;
--   * lentelė skaičiuojama serveryje, klientas tik rodo rezultatą.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Profiliai
-- ---------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nickname    text not null unique
              check (char_length(nickname) between 3 and 24
                     and nickname ~ '^[A-Za-z0-9_ĄČĘĖĮŠŲŪŽąčęėįšųūž.-]+$'),
  region      text check (region is null or char_length(region) <= 40),
  trust_score smallint not null default 50 check (trust_score between 0 and 100),
  is_admin    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Naujam vartotojui automatiškai sukuriamas profilis su laikinu slapyvardžiu.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, nickname)
  values (new.id, 'zvejys_' || substr(replace(new.id::text, '-', ''), 1, 8));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------------------------------------------------------------
-- Rūšys
-- ---------------------------------------------------------------
create table public.species (
  id       smallserial primary key,
  code     text not null unique,
  name_lt  text not null,
  name_lat text
);

-- ---------------------------------------------------------------
-- Turnyrai
-- ---------------------------------------------------------------
create table public.tournaments (
  id             uuid primary key default gen_random_uuid(),
  organizer_id   uuid not null default auth.uid() references public.profiles (id),
  title          text not null check (char_length(title) between 3 and 80),
  description    text check (description is null or char_length(description) <= 2000),
  format         text not null check (format in ('biggest', 'top_n_sum')),
  top_n          smallint not null default 3 check (top_n between 1 and 10),
  min_length_mm  integer not null default 0 check (min_length_mm between 0 and 2000),
  starts_at      timestamptz not null,
  ends_at        timestamptz not null,
  visibility     text not null default 'public' check (visibility in ('public', 'private')),
  fee_cents      integer not null default 0 check (fee_cents = 0), -- 1 etape tik nemokami
  created_at     timestamptz not null default now(),
  check (ends_at > starts_at),
  check (ends_at - starts_at <= interval '120 days')
);

create table public.tournament_species (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  species_id    smallint not null references public.species (id),
  primary key (tournament_id, species_id)
);

create table public.entries (
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  joined_at     timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

-- ---------------------------------------------------------------
-- Laimikiai
-- ---------------------------------------------------------------
create table public.catches (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  client_id          uuid not null,          -- telefono sugeneruotas ID: pakartotinis siuntimas nesukuria dublio
  species_id         smallint not null references public.species (id),
  length_mm          integer not null check (length_mm between 50 and 2500),
  captured_at_device timestamptz not null,   -- telefono laikas (gali būti netikslus)
  received_at        timestamptz not null default now(), -- serverio laikas (nekeičiamas)
  photo_path         text not null,
  photo_sha256       text not null check (photo_sha256 ~ '^[0-9a-f]{64}$'),
  status             text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason      text,
  reviewed_by        uuid references public.profiles (id),
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (user_id, client_id)
);

-- Ta pati nuotrauka negali būti įkelta du kartus (nei to paties, nei kito dalyvio).
create unique index catches_photo_sha256_uniq on public.catches (photo_sha256);
create index catches_user_idx on public.catches (user_id, captured_at_device desc);
create index catches_status_idx on public.catches (status) where status = 'pending';

-- Tikslios koordinatės – atskirai, prieinamos tik savininkui ir moderatoriui.
create table public.catch_locations (
  catch_id   uuid primary key references public.catches (id) on delete cascade,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  created_at timestamptz not null default now()
);

-- Įkeliant laimikį serveris pats nustato statusą ir laiką – klientas jų pakeisti negali.
create or replace function public.catches_before_insert()
returns trigger
language plpgsql
as $$
begin
  new.user_id       := auth.uid();
  new.status        := 'pending';
  new.reject_reason := null;
  new.reviewed_by   := null;
  new.reviewed_at   := null;
  new.received_at   := now();
  new.created_at    := now();
  if new.photo_path is null or split_part(new.photo_path, '/', 1) <> auth.uid()::text then
    raise exception 'photo_path must be inside the uploader''s own folder';
  end if;
  return new;
end;
$$;

create trigger catches_before_insert
  before insert on public.catches
  for each row execute function public.catches_before_insert();

-- Moderatoriaus sprendimas – vienintelis būdas pakeisti laimikio statusą.
create or replace function public.review_catch(p_catch_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'reject reason is required';
  end if;
  update public.catches
     set status        = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else trim(p_reason) end,
         reviewed_by   = auth.uid(),
         reviewed_at   = now()
   where id = p_catch_id;
  if not found then
    raise exception 'catch not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- Lentelė
-- ---------------------------------------------------------------
-- Įskaitomas laimikis:
--   * patvirtintas;
--   * dalyvis užsiregistravęs į turnyrą;
--   * rūšis leidžiama (jei turnyras nenurodo rūšių – visos);
--   * ilgis >= minimalaus;
--   * telefono laikas turnyro ribose;
--   * telefono laikas ne daugiau kaip 10 min. „ateityje“ nuo serverio laiko;
--   * pasiekė serverį ne vėliau kaip per 24 val. po turnyro pabaigos (offline sinchronizacijai).
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
  )
  select rank() over (order by s.score_mm desc, s.last_counted asc) as rank,
         s.user_id, p.nickname, p.region, s.score_mm, s.counted, s.last_counted
    from scored s
    join public.profiles p on p.id = s.user_id
   order by rank, p.nickname;
$$;

-- ---------------------------------------------------------------
-- Teisės (RLS)
-- ---------------------------------------------------------------
alter table public.profiles           enable row level security;
alter table public.species            enable row level security;
alter table public.tournaments        enable row level security;
alter table public.tournament_species enable row level security;
alter table public.entries            enable row level security;
alter table public.catches            enable row level security;
alter table public.catch_locations    enable row level security;

-- Profiliai: viešas slapyvardis ir regionas; savininkas gali keisti tik juos.
create policy profiles_select on public.profiles for select using (true);
create policy profiles_update on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant  update (nickname, region) on public.profiles to authenticated;

-- Rūšys: skaito visi.
create policy species_select on public.species for select using (true);

-- Turnyrai.
create policy tournaments_select on public.tournaments for select using (
  visibility = 'public'
  or organizer_id = auth.uid()
  or exists (select 1 from public.entries e where e.tournament_id = id and e.user_id = auth.uid())
);
create policy tournaments_insert on public.tournaments for insert to authenticated
  with check (organizer_id = auth.uid());
create policy tournaments_update on public.tournaments for update to authenticated
  using (organizer_id = auth.uid() and now() < starts_at)
  with check (organizer_id = auth.uid());
create policy tournaments_delete on public.tournaments for delete to authenticated
  using (organizer_id = auth.uid() and now() < starts_at);

create policy tournament_species_select on public.tournament_species for select using (true);
create policy tournament_species_write on public.tournament_species for all to authenticated
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id and t.organizer_id = auth.uid() and now() < t.starts_at))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id and t.organizer_id = auth.uid() and now() < t.starts_at));

-- Dalyvavimas: dalyvių sąrašas viešas; registruotis galima tik į dar nesibaigusį turnyrą.
create policy entries_select on public.entries for select using (true);
create policy entries_insert on public.entries for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.tournaments t
                 where t.id = tournament_id and now() < t.ends_at
                   and (t.visibility = 'public' or t.organizer_id = auth.uid()))
  );
create policy entries_delete on public.entries for delete to authenticated
  using (user_id = auth.uid()
         and exists (select 1 from public.tournaments t where t.id = tournament_id and now() < t.starts_at));

-- Laimikiai: savo matai visus, kitų – tik patvirtintus; keisti negali niekas, išskyrus review_catch().
create policy catches_select on public.catches for select using (
  user_id = auth.uid() or status = 'approved' or public.is_admin()
);
create policy catches_insert on public.catches for insert to authenticated
  with check (user_id = auth.uid());
revoke update, delete on public.catches from anon, authenticated;

-- Koordinatės: tik savininkas (įrašyti ir matyti) ir moderatorius (matyti).
create policy catch_locations_select on public.catch_locations for select using (
  public.is_admin()
  or exists (select 1 from public.catches c where c.id = catch_id and c.user_id = auth.uid())
);
create policy catch_locations_insert on public.catch_locations for insert to authenticated
  with check (exists (select 1 from public.catches c where c.id = catch_id and c.user_id = auth.uid()));
revoke update, delete on public.catch_locations from anon, authenticated;

-- Funkcijos.
revoke all on function public.review_catch(uuid, boolean, text) from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.catches_before_insert() from public, anon;
grant execute on function public.review_catch(uuid, boolean, text) to authenticated;
grant execute on function public.leaderboard(uuid) to anon, authenticated;
