-- Dienoraštis: išvykos su vieta (vietoj vien „Nieko nekibo“) ir asmeniniai tikslai. Viskas matoma tik savininkui.

-- ---------------------------------------------------------------- Išvykos vieta
alter table public.blank_trips add column if not exists place text;
alter table public.blank_trips drop constraint if exists blank_trips_place_check;
alter table public.blank_trips add constraint blank_trips_place_check
  check (place is null or char_length(trim(place)) between 1 and 60);

-- ---------------------------------------------------------------- Tikslai
create table if not exists public.diary_goals (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind       text not null check (kind in ('length', 'count', 'species', 'days', 'new_species')),
  species_id smallint references public.species (id) on delete cascade,
  target     integer not null check (target between 1 and 1000),
  period     text not null check (period in ('month', 'season', 'ever')),
  created_at timestamptz not null default now(),
  check (kind <> 'length' or target <= 300),
  check (kind <> 'species' or target <= 50),
  check (kind <> 'days' or target <= 366),
  check (kind <> 'new_species' or (target = 1 and period = 'ever'))
);
create index if not exists diary_goals_user_idx on public.diary_goals (user_id, created_at);
alter table public.diary_goals enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'diary_goals' and policyname = 'diary_goals_own') then
    create policy diary_goals_own on public.diary_goals for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.diary_goals from anon;
revoke insert, update on public.diary_goals from authenticated;
grant select, delete on public.diary_goals to authenticated;
grant insert (kind, species_id, target, period) on public.diary_goals to authenticated;

create or replace function public.diary_goals_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  if (select count(*) from public.diary_goals where user_id = new.user_id) >= 12 then
    raise exception 'goal_limit';
  end if;
  return new;
end;
$$;
revoke all on function public.diary_goals_before_insert() from public, anon, authenticated;
drop trigger if exists diary_goals_before_insert on public.diary_goals;
create trigger diary_goals_before_insert before insert on public.diary_goals
  for each row execute function public.diary_goals_before_insert();

notify pgrst, 'reload schema';
