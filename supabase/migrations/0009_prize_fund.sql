-- Prizinis fondas, jo padalijimas vietoms ir keli rėmėjai.
-- Tik nauji stulpeliai, nauja lentelė ir taisyklės – nieko netrinama.
-- Pinigų programėlė neperveda: fondą paskelbia organizatorius, išmoka jis arba rėmėjai.

-- Padalijimas – sveikųjų procentų masyvas pagal vietas, pvz. [50,30,20]; suma lygiai 100.
create or replace function public.valid_prize_split(p jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is null or (
    jsonb_typeof(p) = 'array'
    and jsonb_array_length(p) between 1 and 10
    and not exists (select 1 from jsonb_array_elements(p) e
                     where jsonb_typeof(e) <> 'number'
                        or (e::text)::numeric <= 0 or (e::text)::numeric > 100
                        or (e::text)::numeric % 1 <> 0)
    and (select sum((e::text)::numeric) from jsonb_array_elements(p) e) = 100
  );
$$;

alter table public.tournaments
  add column if not exists prize_fund_cents integer not null default 0
    check (prize_fund_cents between 0 and 10000000),
  add column if not exists prize_split jsonb
    check (public.valid_prize_split(prize_split));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tournaments_prize_split_required') then
    alter table public.tournaments add constraint tournaments_prize_split_required
      check (prize_fund_cents = 0 or prize_split is not null);
  end if;
end;
$$;

-- Rėmėjai: keli vienam turnyrui, su nuoroda ir (nebūtinai) įnašu į fondą.
create table if not exists public.tournament_sponsors (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name          text not null check (char_length(trim(name)) between 1 and 60),
  url           text check (url is null or url ~ '^https://[^[:space:]<>"'']{3,200}$'),
  amount_cents  integer check (amount_cents is null or amount_cents between 0 and 10000000),
  sort          smallint not null default 0 check (sort between 0 and 20),
  created_at    timestamptz not null default now()
);
create index if not exists tournament_sponsors_tournament_idx on public.tournament_sponsors (tournament_id, sort);
alter table public.tournament_sponsors enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_sponsors' and policyname = 'tournament_sponsors_select') then
    -- Matoma tiems, kas mato turnyrą (privataus – tik dalyviai ir organizatorius; tai sprendžia tournaments RLS).
    create policy tournament_sponsors_select on public.tournament_sponsors for select
      using (exists (select 1 from public.tournaments t where t.id = tournament_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_sponsors' and policyname = 'tournament_sponsors_write') then
    create policy tournament_sponsors_write on public.tournament_sponsors for all to authenticated
      using (exists (select 1 from public.tournaments t
                      where t.id = tournament_id and t.organizer_id = (select auth.uid())
                        and (now() < t.starts_at or t.created_at > now() - interval '10 minutes')))
      with check (exists (select 1 from public.tournaments t
                           where t.id = tournament_id and t.organizer_id = (select auth.uid())
                             and (now() < t.starts_at or t.created_at > now() - interval '10 minutes')));
  end if;
end;
$$;

-- Ne daugiau kaip 10 rėmėjų vienam turnyrui.
create or replace function public.tournament_sponsors_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.tournament_sponsors s where s.tournament_id = new.tournament_id) >= 10 then
    raise exception 'sponsor_limit' using hint = 'Ne daugiau kaip 10 rėmėjų';
  end if;
  new.name := trim(new.name);
  new.created_at := now();
  return new;
end;
$$;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tournament_sponsors_before_insert') then
    create trigger tournament_sponsors_before_insert before insert on public.tournament_sponsors
      for each row execute function public.tournament_sponsors_before_insert();
  end if;
end;
$$;
revoke all on function public.tournament_sponsors_before_insert() from public, anon;

-- Ankstesnis vienas rėmėjas (sponsor_name/url) perkeliamas į naują lentelę.
insert into public.tournament_sponsors (tournament_id, name, url, sort)
select t.id, t.sponsor_name, t.sponsor_url, 0
  from public.tournaments t
 where t.sponsor_name is not null
   and not exists (select 1 from public.tournament_sponsors s where s.tournament_id = t.id);
