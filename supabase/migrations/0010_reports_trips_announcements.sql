-- Pranešimai apie įtartinus laimikius, „Nieko nekibo“ išvykos, organizatoriaus pranešimai dalyviams.
-- Tik nauji objektai – nieko netrinama.

-- ---------------------------------------------------------------
-- 1. Pranešimai apie įtartiną laimikį
-- ---------------------------------------------------------------
create table if not exists public.catch_reports (
  id          uuid primary key default gen_random_uuid(),
  catch_id    uuid not null references public.catches (id) on delete cascade,
  reporter_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason      text not null check (reason in ('old_photo', 'wrong_length', 'wrong_species', 'not_own', 'other')),
  message     text check (message is null or char_length(message) <= 300),
  status      text not null default 'open' check (status in ('open', 'dismissed', 'upheld')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (catch_id, reporter_id)
);
create index if not exists catch_reports_open_idx on public.catch_reports (created_at) where status = 'open';
create index if not exists catch_reports_reporter_idx on public.catch_reports (reporter_id, created_at);
create index if not exists catch_reports_resolved_by_idx on public.catch_reports (resolved_by);
alter table public.catch_reports enable row level security;

create or replace function public.catch_reports_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.reporter_id := auth.uid();
  new.status := 'open';
  new.resolved_by := null;
  new.resolved_at := null;
  new.created_at := now();
  new.message := nullif(trim(coalesce(new.message, '')), '');
  if (select count(*) from public.catch_reports r
       where r.reporter_id = new.reporter_id and r.created_at > now() - interval '24 hours') >= 20 then
    raise exception 'report_limit' using hint = 'Ne daugiau kaip 20 pranešimų per parą';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'catch_reports_before_insert') then
    create trigger catch_reports_before_insert before insert on public.catch_reports
      for each row execute function public.catch_reports_before_insert();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_reports' and policyname = 'catch_reports_select') then
    create policy catch_reports_select on public.catch_reports for select
      using (reporter_id = (select auth.uid()) or (select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_reports' and policyname = 'catch_reports_insert') then
    -- Pranešti galima tik apie kito žmogaus patvirtintą laimikį.
    create policy catch_reports_insert on public.catch_reports for insert to authenticated
      with check (reporter_id = (select auth.uid())
                  and exists (select 1 from public.catches c
                               where c.id = catch_id and c.status = 'approved' and c.user_id <> (select auth.uid())));
  end if;
end;
$$;
revoke update on public.catch_reports from anon, authenticated;

-- Moderatorius: atmesti pranešimą arba pripažinti pagrįstu (tada laimikis atmetamas su priežastimi).
create or replace function public.resolve_report(p_id uuid, p_uphold boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_catch uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select catch_id into v_catch from public.catch_reports where id = p_id and status = 'open';
  if v_catch is null then
    raise exception 'report not found';
  end if;
  if p_uphold then
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'reject reason is required';
    end if;
    update public.catches
       set status = 'rejected', reject_reason = trim(p_reason), reviewed_by = auth.uid(), reviewed_at = now()
     where id = v_catch;
    update public.profiles p set trust_score = greatest(0, p.trust_score - 5)
      from public.catches c where c.id = v_catch and p.id = c.user_id;
  end if;
  -- Vienas sprendimas uždaro visus to laimikio pranešimus.
  update public.catch_reports
     set status = case when p_uphold then 'upheld' else 'dismissed' end,
         resolved_by = auth.uid(), resolved_at = now()
   where catch_id = v_catch and status = 'open';
end;
$$;

-- ---------------------------------------------------------------
-- 2. „Nieko nekibo“: žvejyba be laimikio (privati, tik savininkui)
-- ---------------------------------------------------------------
create table if not exists public.blank_trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  trip_date  date not null check (trip_date >= date '2020-01-01'),
  hours      numeric(4, 1) check (hours is null or (hours > 0 and hours <= 24)),
  notes      text check (notes is null or char_length(notes) <= 300),
  weather    jsonb check (weather is null or (jsonb_typeof(weather) = 'object' and pg_column_size(weather) < 1000)),
  created_at timestamptz not null default now()
);
create index if not exists blank_trips_user_idx on public.blank_trips (user_id, trip_date desc);
alter table public.blank_trips enable row level security;

create or replace function public.blank_trips_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_id := auth.uid();
  new.created_at := now();
  if new.trip_date > (now() + interval '1 day')::date then
    raise exception 'trip_in_future';
  end if;
  if (select count(*) from public.blank_trips b
       where b.user_id = new.user_id and b.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'trip_limit' using hint = 'Ne daugiau kaip 10 įrašų per parą';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'blank_trips_before_insert') then
    create trigger blank_trips_before_insert before insert on public.blank_trips
      for each row execute function public.blank_trips_before_insert();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'blank_trips' and policyname = 'blank_trips_own') then
    create policy blank_trips_own on public.blank_trips for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end;
$$;
revoke update on public.blank_trips from anon, authenticated;

-- ---------------------------------------------------------------
-- 3. Organizatoriaus pranešimai dalyviams
-- ---------------------------------------------------------------
create table if not exists public.tournament_announcements (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  author_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message       text not null check (char_length(trim(message)) between 2 and 500),
  created_at    timestamptz not null default now()
);
create index if not exists tournament_announcements_t_idx on public.tournament_announcements (tournament_id, created_at desc);
create index if not exists tournament_announcements_author_idx on public.tournament_announcements (author_id);
alter table public.tournament_announcements enable row level security;

create or replace function public.tournament_announcements_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.author_id := auth.uid();
  new.created_at := now();
  new.message := trim(new.message);
  if (select count(*) from public.tournament_announcements a
       where a.tournament_id = new.tournament_id and a.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'announcement_limit' using hint = 'Ne daugiau kaip 10 pranešimų per parą';
  end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tournament_announcements_before_insert') then
    create trigger tournament_announcements_before_insert before insert on public.tournament_announcements
      for each row execute function public.tournament_announcements_before_insert();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_announcements' and policyname = 'tournament_announcements_select') then
    -- Mato visi, kas mato turnyrą (privataus – tik dalyviai ir organizatorius).
    create policy tournament_announcements_select on public.tournament_announcements for select
      using (exists (select 1 from public.tournaments t where t.id = tournament_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_announcements' and policyname = 'tournament_announcements_insert') then
    -- Rašo tik organizatorius, iki 7 d. po turnyro pabaigos.
    create policy tournament_announcements_insert on public.tournament_announcements for insert to authenticated
      with check (author_id = (select auth.uid())
                  and exists (select 1 from public.tournaments t
                               where t.id = tournament_id and t.organizer_id = (select auth.uid())
                                 and now() < t.ends_at + interval '7 days'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_announcements' and policyname = 'tournament_announcements_delete') then
    create policy tournament_announcements_delete on public.tournament_announcements for delete to authenticated
      using (author_id = (select auth.uid()));
  end if;
end;
$$;
revoke update on public.tournament_announcements from anon, authenticated;

revoke all on function public.resolve_report(uuid, boolean, text) from public, anon;
grant execute on function public.resolve_report(uuid, boolean, text) to authenticated;
revoke all on function public.catch_reports_before_insert() from public, anon;
revoke all on function public.blank_trips_before_insert() from public, anon;
revoke all on function public.tournament_announcements_before_insert() from public, anon;
