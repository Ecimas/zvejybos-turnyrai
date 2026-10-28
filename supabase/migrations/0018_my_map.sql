-- Asmeninis laimikių žemėlapis. Tikslios vietos (catch_locations) ištrinamos po 90 d. – taip žadama.
-- Norintis jas išsaugoti SAVO žemėlapiui įjungia „saugoti“: tada vietos kopijuojamos į catch_spots,
-- kurias mato TIK pats žvejys (moderatoriai – ne). Išjungus – kopijos ištrinamos.

create table if not exists public.catch_spots (
  catch_id   uuid primary key references public.catches (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  accuracy_m real check (accuracy_m is null or accuracy_m >= 0),
  created_at timestamptz not null default now()
);
create index if not exists catch_spots_user_idx on public.catch_spots (user_id);
alter table public.catch_spots enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_spots' and policyname = 'catch_spots_select') then
    create policy catch_spots_select on public.catch_spots for select to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_spots' and policyname = 'catch_spots_remove') then
    create policy catch_spots_remove on public.catch_spots for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke insert, update on public.catch_spots from anon, authenticated;
revoke all on public.catch_spots from anon;

create table if not exists public.spot_settings (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  keep       boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.spot_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'spot_settings' and policyname = 'spot_settings_own') then
    create policy spot_settings_own on public.spot_settings for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke insert, update, delete on public.spot_settings from anon, authenticated;
revoke select on public.spot_settings from anon;

-- Įjungti / išjungti saugojimą. Įjungus nukopijuojamos ir esamos vietos.
-- Išjungus kopijas ištrina klientas (catch_spots_remove taisyklė leidžia tik savas).
create or replace function public.set_keep_spots(p_keep boolean)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid(); n integer := 0;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;
  insert into public.spot_settings (user_id, keep, updated_at) values (v_uid, coalesce(p_keep, false), now())
  on conflict (user_id) do update set keep = excluded.keep, updated_at = now();
  if p_keep then
    insert into public.catch_spots (catch_id, user_id, lat, lng, accuracy_m)
    select l.catch_id, c.user_id, l.lat, l.lng, l.accuracy_m
      from public.catch_locations l join public.catches c on c.id = l.catch_id
     where c.user_id = v_uid
    on conflict (catch_id) do nothing;
    get diagnostics n = row_count;
  end if;
  return n;
end;
$$;

-- Nauja vieta → kopija, jei savininkas įjungęs saugojimą.
create or replace function public.catch_locations_keep()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.catches where id = new.catch_id;
  if exists (select 1 from public.spot_settings where user_id = v_owner and keep) then
    insert into public.catch_spots (catch_id, user_id, lat, lng, accuracy_m)
    values (new.catch_id, v_owner, new.lat, new.lng, new.accuracy_m)
    on conflict (catch_id) do nothing;
  end if;
  return new;
exception when others then
  raise warning 'catch_locations_keep: %', sqlerrm;
  return new;
end;
$$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'catch_locations_keep' and tgrelid = 'public.catch_locations'::regclass) then
    create trigger catch_locations_keep after insert on public.catch_locations
      for each row execute function public.catch_locations_keep();
  end if;
end $$;

revoke all on function public.set_keep_spots(boolean) from public, anon;
revoke all on function public.catch_locations_keep() from public, anon, authenticated;
grant execute on function public.set_keep_spots(boolean) to authenticated;

notify pgrst, 'reload schema';
