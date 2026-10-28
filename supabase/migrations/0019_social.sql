-- Sekimas, klubai ir komandinė turnyrų įskaita. (Įdiegta į Supabase 2026-10-28.)

-- ---------------------------------------------------------------
-- Sekimas
-- ---------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on public.follows (followee_id);
alter table public.follows enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'follows' and policyname = 'follows_select') then
    create policy follows_select on public.follows for select to authenticated
      using (follower_id = (select auth.uid()) or followee_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'follows' and policyname = 'follows_insert') then
    create policy follows_insert on public.follows for insert to authenticated with check (follower_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'follows' and policyname = 'follows_remove') then
    create policy follows_remove on public.follows for delete to authenticated using (follower_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'follows' and policyname = 'follows_not_banned_insert') then
    create policy follows_not_banned_insert on public.follows as restrictive for insert to authenticated with check (not (select public.is_banned()));
  end if;
end $$;
revoke update on public.follows from anon, authenticated;
revoke all on public.follows from anon;

create or replace function public.follows_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.follows where follower_id = new.follower_id) >= 500 then
    raise exception 'follow_limit' using hint = 'Galima sekti iki 500 žvejų';
  end if;
  new.created_at := now();
  return new;
end;
$$;
revoke all on function public.follows_before_insert() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'follows_before_insert' and tgrelid = 'public.follows'::regclass) then
    create trigger follows_before_insert before insert on public.follows for each row execute function public.follows_before_insert();
  end if;
end $$;

-- Sekėjų skaičiai – vieši; ar aš seku – tik man.
create or replace function public.follow_stats(p_user uuid)
returns table (followers bigint, following bigint, i_follow boolean)
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.follows where followee_id = p_user),
         (select count(*) from public.follows where follower_id = p_user),
         exists (select 1 from public.follows where follower_id = auth.uid() and followee_id = p_user);
$$;

-- ---------------------------------------------------------------
-- Klubai
-- ---------------------------------------------------------------
create table if not exists public.clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(trim(name)) between 3 and 40
                                   and name ~ '^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_"„“-]+$'),
  region      text check (region is null or char_length(region) <= 40),
  description text check (description is null or char_length(description) <= 300),
  owner_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  open        boolean not null default true,
  invite_code text not null default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  created_at  timestamptz not null default now()
);
create unique index if not exists clubs_name_uniq on public.clubs (lower(trim(name)));
create unique index if not exists clubs_invite_uniq on public.clubs (invite_code);
create index if not exists clubs_owner_idx on public.clubs (owner_id);
alter table public.clubs enable row level security;

create table if not exists public.club_members (
  club_id   uuid not null references public.clubs (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  role      text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
create index if not exists club_members_user_idx on public.club_members (user_id);
alter table public.club_members enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clubs' and policyname = 'clubs_select') then
    create policy clubs_select on public.clubs for select using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clubs' and policyname = 'clubs_insert') then
    create policy clubs_insert on public.clubs for insert to authenticated with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clubs' and policyname = 'clubs_update') then
    create policy clubs_update on public.clubs for update to authenticated
      using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clubs' and policyname = 'clubs_remove') then
    create policy clubs_remove on public.clubs for delete to authenticated using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'clubs' and policyname = 'clubs_not_banned_insert') then
    create policy clubs_not_banned_insert on public.clubs as restrictive for insert to authenticated with check (not (select public.is_banned()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_members' and policyname = 'club_members_select') then
    create policy club_members_select on public.club_members for select using (true);
  end if;
  -- Išeiti gali pats (ne savininkas); savininkas gali pašalinti narį (ne save).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_members' and policyname = 'club_members_remove') then
    create policy club_members_remove on public.club_members for delete to authenticated
      using ((user_id = (select auth.uid()) and role <> 'owner')
             or (role <> 'owner' and exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = (select auth.uid()))));
  end if;
end $$;
-- Kvietimo kodo nemato visi: tik per club_invite_code() (nariams).
revoke select on public.clubs from anon, authenticated;
grant select (id, name, region, description, owner_id, open, created_at) on public.clubs to anon, authenticated;
revoke update on public.clubs from anon, authenticated;
grant update (name, region, description, open) on public.clubs to authenticated;
revoke insert, update on public.club_members from anon, authenticated;

create or replace function public.clubs_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.clubs where owner_id = new.owner_id) >= 3 then
    raise exception 'club_limit' using hint = 'Galima sukurti iki 3 klubų';
  end if;
  new.name := trim(new.name);
  new.created_at := now();
  new.invite_code := lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  return new;
end;
$$;
create or replace function public.clubs_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.club_members (club_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;
revoke all on function public.clubs_before_insert() from public, anon, authenticated;
revoke all on function public.clubs_after_insert() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'clubs_before_insert' and tgrelid = 'public.clubs'::regclass) then
    create trigger clubs_before_insert before insert on public.clubs for each row execute function public.clubs_before_insert();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'clubs_after_insert' and tgrelid = 'public.clubs'::regclass) then
    create trigger clubs_after_insert after insert on public.clubs for each row execute function public.clubs_after_insert();
  end if;
end $$;

-- Prisijungti: atviras klubas – laisvai, uždaras – su kvietimo kodu. Iki 10 klubų vienam žvejui.
create or replace function public.join_club(p_club uuid, p_code text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c record;
begin
  if auth.uid() is null or public.is_banned() then
    raise exception 'not allowed';
  end if;
  select * into c from public.clubs where id = p_club;
  if c.id is null then
    raise exception 'club not found';
  end if;
  if exists (select 1 from public.club_members where club_id = p_club and user_id = auth.uid()) then
    return;
  end if;
  if not c.open and lower(trim(coalesce(p_code, ''))) <> c.invite_code then
    raise exception 'club_code';
  end if;
  if (select count(*) from public.club_members where user_id = auth.uid()) >= 10 then
    raise exception 'club_member_limit';
  end if;
  insert into public.club_members (club_id, user_id) values (p_club, auth.uid());
end;
$$;

create or replace function public.club_invite_code(p_club uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.invite_code from public.clubs c
   where c.id = p_club
     and exists (select 1 from public.club_members m where m.club_id = c.id and m.user_id = auth.uid());
$$;

-- ---------------------------------------------------------------
-- Komandinė įskaita: turnyre žvejys atstovauja vienam savo klubui; klubo rezultatas – 3 geriausių suma.
-- ---------------------------------------------------------------
alter table public.tournaments add column if not exists team_mode boolean not null default false;
alter table public.entries add column if not exists club_id uuid references public.clubs (id) on delete set null;

-- Registruojantis klubo nurodyti negalima (tik per set_entry_club, kuris tikrina narystę).
create or replace function public.entries_club_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.club_id is not null and not exists (select 1 from public.club_members where club_id = new.club_id and user_id = new.user_id) then
    new.club_id := null;
  end if;
  return new;
end;
$$;
revoke all on function public.entries_club_guard() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'entries_club_guard' and tgrelid = 'public.entries'::regclass) then
    create trigger entries_club_guard before insert on public.entries for each row execute function public.entries_club_guard();
  end if;
end $$;

create or replace function public.set_entry_club(p_tournament uuid, p_club uuid)
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
  if not t.team_mode then
    raise exception 'team_off';
  end if;
  if now() >= t.ends_at then
    raise exception 'team_closed';
  end if;
  if p_club is not null and not exists (select 1 from public.club_members where club_id = p_club and user_id = auth.uid()) then
    raise exception 'team_not_member';
  end if;
  update public.entries set club_id = p_club where tournament_id = p_tournament and user_id = auth.uid();
end;
$$;

create or replace function public.team_leaderboard(p_tournament_id uuid)
returns table (rank bigint, club_id uuid, name text, score_mm bigint, members bigint, counted bigint)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select * from public.tournaments
     where id = p_tournament_id and team_mode
       and (visibility = 'public' or organizer_id = auth.uid()
            or exists (select 1 from public.entries e where e.tournament_id = p_tournament_id and e.user_id = auth.uid()))
       and not (leaderboard_hidden and now() < ends_at and organizer_id is distinct from auth.uid() and not public.is_admin())
  ),
  lb as (
    select l.user_id, l.score_mm, e.club_id,
           row_number() over (partition by e.club_id order by l.score_mm desc, l.last_counted asc) as rn
      from t
      cross join lateral public.leaderboard_all(t.id) l
      join public.entries e on e.tournament_id = t.id and e.user_id = l.user_id
     where e.club_id is not null
  ),
  agg as (
    select lb.club_id, sum(lb.score_mm) filter (where lb.rn <= 3)::bigint as score_mm,
           (select count(*) from public.entries e2 join t on e2.tournament_id = t.id where e2.club_id = lb.club_id) as members,
           count(*) filter (where lb.rn <= 3) as counted
      from lb group by lb.club_id
  )
  select rank() over (order by a.score_mm desc), a.club_id, c.name, a.score_mm, a.members, a.counted
    from agg a join public.clubs c on c.id = a.club_id
   order by 1, c.name;
$$;

revoke all on function public.follow_stats(uuid) from public;
revoke all on function public.join_club(uuid, text) from public, anon;
revoke all on function public.club_invite_code(uuid) from public, anon;
revoke all on function public.set_entry_club(uuid, uuid) from public, anon;
revoke all on function public.team_leaderboard(uuid) from public;
grant execute on function public.follow_stats(uuid) to anon, authenticated;
grant execute on function public.join_club(uuid, text) to authenticated;
grant execute on function public.club_invite_code(uuid) to authenticated;
grant execute on function public.set_entry_club(uuid, uuid) to authenticated;
grant execute on function public.team_leaderboard(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
