-- Įdiegti Supabase SQL redaktoriuje vienu kartu: 0026 (administratorius tvarko turnyrus) + 0027 (rėmėjų logotipai).
-- Saugu paleisti ir pakartotinai.

-- Administratorius (ir savininkas) gali taisyti ir pašalinti bet kurį turnyrą – ir jau vykstantį.
--  * Iki starto administratorius gali keisti viską, kaip organizatorius.
--  * Prasidėjus – tik tai, kas nekeičia rezultatų: pavadinimą, aprašymą, prizų tekstą, rėmėjus, matomumą,
--    lentelės slėpimą, registraciją po starto ir pabaigos laiką (ne į praeitį). Formato, pradžios, rūšių,
--    divizionų, minimalaus ilgio ir prizinio fondo keisti negali niekas.
--  * Pašalinti – tik nurodžius priežastį; dalyviai gauna pranešimą. Laimikiai lieka žvejų dienoraščiuose.
--  * Kiekvienas administratoriaus veiksmas įrašomas į tournament_admin_log, organizatorius gauna pranešimą.

create or replace function public.has_perm(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select 'owner' = any (roles)
        or (p_perm = 'review'      and roles && array['admin', 'moderator']::text[])
        or (p_perm = 'disputes'    and roles && array['admin', 'judge']::text[])
        or (p_perm = 'ban'         and roles && array['admin', 'guard']::text[])
        or (p_perm = 'tournaments' and roles && array['admin']::text[])
      from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p order by p) filter (where public.has_perm(p)), '{}'::text[])
    from unnest(array['review', 'disputes', 'ban', 'roles', 'tournaments']) p;
$$;

-- Žurnalas. Turnyro ID be išorinio rakto – įrašas lieka ir turnyrą pašalinus.
create table if not exists public.tournament_admin_log (
  id            bigint generated always as identity primary key,
  tournament_id uuid not null,
  title         text not null,
  organizer_id  uuid,
  actor_id      uuid references public.profiles (id) on delete set null,
  action        text not null check (action in ('update', 'delete')),
  changes       jsonb,
  reason        text check (reason is null or char_length(reason) <= 300),
  created_at    timestamptz not null default now()
);
create index if not exists tournament_admin_log_created_idx on public.tournament_admin_log (created_at desc);
alter table public.tournament_admin_log enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tournament_admin_log' and policyname = 'tournament_admin_log_select') then
    create policy tournament_admin_log_select on public.tournament_admin_log for select to authenticated
      using ((select public.has_perm('tournaments')));
  end if;
end $$;
revoke all on public.tournament_admin_log from anon;
revoke insert, update, delete on public.tournament_admin_log from authenticated;
grant select on public.tournament_admin_log to authenticated;

-- Turnyrų sąrašą skaito ir neprisijungę – jų politika kviečia has_perm (anonimui visada false).
grant execute on function public.has_perm(text) to anon;

-- Administratorius mato ir privačius turnyrus (sąraše programėlė juos rodo tik dalyviams ir organizatoriui).
alter policy tournaments_select on public.tournaments using (
  visibility = 'public'
  or organizer_id = (select auth.uid())
  or exists (select 1 from public.entries e where e.tournament_id = id and e.user_id = (select auth.uid()))
  or (select public.has_perm('tournaments'))
);
alter policy tournaments_update on public.tournaments
  using ((organizer_id = (select auth.uid()) and now() < starts_at) or (select public.has_perm('tournaments')))
  with check (organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')));

-- Rūšys ir divizionai – taisyklės: administratorius gali keisti tik iki starto.
alter policy tournament_species_write on public.tournament_species
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id
                    and ((t.organizer_id = (select auth.uid()) and (now() < t.starts_at or t.created_at > now() - interval '10 minutes'))
                         or ((select public.has_perm('tournaments')) and now() < t.starts_at))))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id
                         and ((t.organizer_id = (select auth.uid()) and (now() < t.starts_at or t.created_at > now() - interval '10 minutes'))
                              or ((select public.has_perm('tournaments')) and now() < t.starts_at))));
alter policy tournament_divisions_write on public.tournament_divisions
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id and now() < t.starts_at
                    and (t.organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')))))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id and now() < t.starts_at
                         and (t.organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')))));
-- Rėmėjai – ne taisyklės: administratorius gali taisyti bet kada.
alter policy tournament_sponsors_write on public.tournament_sponsors
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id
                    and ((t.organizer_id = (select auth.uid()) and (now() < t.starts_at or t.created_at > now() - interval '10 minutes'))
                         or (select public.has_perm('tournaments')))))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id
                         and ((t.organizer_id = (select auth.uid()) and (now() < t.starts_at or t.created_at > now() - interval '10 minutes'))
                              or (select public.has_perm('tournaments')))));

-- Sargas: ką administratorius gali keisti vykstančiame turnyre; pakeitimai – į žurnalą, organizatoriui – pranešimas.
create or replace function public.tournaments_admin_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  -- Tik užklausos iš programėlės (PostgREST nustato role = authenticated); serverio darbai ir migracijos – be sargo.
  if v_uid is null or coalesce(current_setting('role', true), '') <> 'authenticated' then
    return new;
  end if;
  if v_uid = old.organizer_id and now() < old.starts_at then
    return new; -- įprastas organizatoriaus redagavimas iki starto
  end if;
  -- Čia patenka tik turintys teisę 'tournaments' (kitų RLS neįleidžia)
  if now() >= old.starts_at then
    if new.format is distinct from old.format or new.top_n is distinct from old.top_n
       or new.min_length_mm is distinct from old.min_length_mm or new.starts_at is distinct from old.starts_at
       or new.team_mode is distinct from old.team_mode or new.league_id is distinct from old.league_id
       or new.prize_fund_cents is distinct from old.prize_fund_cents or new.prize_split is distinct from old.prize_split
       or new.fee_cents is distinct from old.fee_cents or new.invite_code is distinct from old.invite_code then
      raise exception 'started_rules_locked' using hint = 'Prasidėjusio turnyro taisyklių keisti negalima';
    end if;
    if new.ends_at is distinct from old.ends_at and new.ends_at < now() - interval '1 minute' then
      raise exception 'ends_in_past' using hint = 'Pabaiga negali būti praeityje';
    end if;
  end if;
  for k in select jsonb_object_keys(v_new) loop
    if k not in ('created_at', 'organizer_id') and v_new -> k is distinct from v_old -> k then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_array(v_old -> k, v_new -> k));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb then
    insert into public.tournament_admin_log (tournament_id, title, organizer_id, actor_id, action, changes)
    values (old.id, new.title, old.organizer_id, v_uid, 'update', v_changes);
    if old.organizer_id is distinct from v_uid then
      perform public.notify_user(old.organizer_id, 'announcement', 'Turnyras pataisytas',
        format('Administratorius pakeitė turnyrą „%s“.', new.title), '#/t/' || old.id,
        format('tadmin:%s:%s', old.id, md5(v_changes::text)));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists tournaments_admin_guard on public.tournaments;
create trigger tournaments_admin_guard before update on public.tournaments
  for each row execute function public.tournaments_admin_guard();

-- Pašalinti turnyrą (bet kada). Būtina priežastis – ją matys dalyviai.
create or replace function public.admin_delete_tournament(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  e record;
  v_reason text := left(nullif(trim(coalesce(p_reason, '')), ''), 300);
begin
  if not public.has_perm('tournaments') then
    raise exception 'not allowed';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'reason_required' using hint = 'Nurodyk priežastį (bent 5 simboliai)';
  end if;
  select * into t from public.tournaments where id = p_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  insert into public.tournament_admin_log (tournament_id, title, organizer_id, actor_id, action, changes, reason)
  values (t.id, t.title, t.organizer_id, auth.uid(), 'delete',
          jsonb_build_object(
            'tournament', to_jsonb(t) - 'invite_code',
            'entries', (select count(*) from public.entries where tournament_id = t.id),
            'species', (select coalesce(jsonb_agg(jsonb_build_object('species_id', species_id, 'points_pct', points_pct)), '[]'::jsonb)
                          from public.tournament_species where tournament_id = t.id)),
          v_reason);
  for e in select distinct u.user_id from (
             select user_id from public.entries where tournament_id = t.id
             union select t.organizer_id) u
           where u.user_id is not null and u.user_id <> auth.uid() loop
    perform public.notify_user(e.user_id, 'announcement', 'Turnyras pašalintas',
      format('„%s“ pašalino administratorius. Priežastis: %s', t.title, v_reason), '#/',
      format('tdel:%s:%s', t.id, e.user_id));
  end loop;
  delete from public.tournaments where id = t.id;
end;
$$;

revoke all on function public.admin_delete_tournament(uuid, text) from public, anon;
grant execute on function public.admin_delete_tournament(uuid, text) to authenticated;
revoke all on function public.tournaments_admin_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- Rėmėjų matomumas: logotipai, generalinis rėmėjas, trumpas pasiūlymas ir statistika rėmėjui.
--  * Logotipai – vieša saugykla sponsor-logos/<turnyro id>/<failas>.webp|png|jpg (iki 300 KB, programėlė sumažina).
--  * Rėmėjus organizatorius gali tvarkyti bet kada (ir vykstant turnyrui) – tai ne taisyklės.
--  * Statistika: kiek įrenginių per dieną matė logotipą ir kiek kartų paspaudė nuorodą. Rodoma tik organizatoriui
--    ir administratoriui, kad galėtų atsiskaityti rėmėjui. Skaičiai apytiksliai (skaičiuoja programėlė).
-- Reikalauja 0026 (has_perm('tournaments')).

alter table public.tournament_sponsors
  add column if not exists logo_path text,
  add column if not exists tier      text not null default 'partner',
  add column if not exists blurb     text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_sponsors_logo_path_check') then
    alter table public.tournament_sponsors add constraint tournament_sponsors_logo_path_check
      check (logo_path is null or (logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(webp|png|jpg)$'
                                   and split_part(logo_path, '/', 1) = tournament_id::text));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tournament_sponsors_tier_check') then
    alter table public.tournament_sponsors add constraint tournament_sponsors_tier_check check (tier in ('main', 'partner'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tournament_sponsors_blurb_check') then
    alter table public.tournament_sponsors add constraint tournament_sponsors_blurb_check check (blurb is null or char_length(blurb) <= 140);
  end if;
end $$;
-- Generalinis rėmėjas – vienas turnyrui.
create unique index if not exists tournament_sponsors_main_uniq on public.tournament_sponsors (tournament_id) where tier = 'main';

-- Organizatorius tvarko rėmėjus bet kada; administratorius – taip pat.
alter policy tournament_sponsors_write on public.tournament_sponsors
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id
                    and (t.organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')))))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id
                         and (t.organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')))));

-- Logotipų saugykla: skaityti gali visi (viešos nuorodos), rašyti – turnyro organizatorius ar administratorius.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', true, 307200, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_sponsor_logo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(webp|png|jpg)$'
     and exists (select 1 from public.tournaments t
                  where t.id::text = split_part(p_name, '/', 1)
                    and (t.organizer_id = auth.uid() or public.has_perm('tournaments')));
$$;
revoke all on function public.can_manage_sponsor_logo(text) from public, anon;
grant execute on function public.can_manage_sponsor_logo(text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sponsor_logos_insert') then
    create policy sponsor_logos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'sponsor-logos' and public.can_manage_sponsor_logo(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sponsor_logos_select') then
    create policy sponsor_logos_select on storage.objects for select
      using (bucket_id = 'sponsor-logos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sponsor_logos_update') then
    create policy sponsor_logos_update on storage.objects for update to authenticated
      using (bucket_id = 'sponsor-logos' and public.can_manage_sponsor_logo(name))
      with check (bucket_id = 'sponsor-logos' and public.can_manage_sponsor_logo(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sponsor_logos_remove') then
    create policy sponsor_logos_remove on storage.objects for delete to authenticated
      using (bucket_id = 'sponsor-logos' and public.can_manage_sponsor_logo(name));
  end if;
end $$;

-- Statistika: viena eilutė rėmėjui per dieną.
create table if not exists public.sponsor_stats (
  sponsor_id uuid not null references public.tournament_sponsors (id) on delete cascade,
  day        date not null,
  views      integer not null default 0 check (views >= 0),
  clicks     integer not null default 0 check (clicks >= 0),
  primary key (sponsor_id, day)
);
alter table public.sponsor_stats enable row level security;
revoke all on public.sponsor_stats from anon, authenticated;

-- Programėlė praneša: logotipas parodytas (vienam įrenginiui – kartą per dieną) arba paspausta nuoroda.
create or replace function public.sponsor_track(p_ids uuid[], p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Europe/Vilnius')::date;
  v_ids uuid[];
begin
  if p_kind not in ('view', 'click') or p_ids is null then
    return;
  end if;
  select array_agg(distinct x) into v_ids
    from (select unnest(p_ids) x limit case when p_kind = 'click' then 1 else 20 end) s;
  insert into public.sponsor_stats (sponsor_id, day, views, clicks)
  select s.id, v_day, case when p_kind = 'view' then 1 else 0 end, case when p_kind = 'click' then 1 else 0 end
    from public.tournament_sponsors s
   where s.id = any (v_ids)
  on conflict (sponsor_id, day) do update
    set views  = least(public.sponsor_stats.views + excluded.views, 1000000),
        clicks = least(public.sponsor_stats.clicks + excluded.clicks, 1000000);
end;
$$;
revoke all on function public.sponsor_track(uuid[], text) from public;
grant execute on function public.sponsor_track(uuid[], text) to anon, authenticated;

-- Ataskaita rėmėjams: turnyro aprėptis ir kiekvieno rėmėjo parodymai bei paspaudimai.
create or replace function public.sponsor_report(p_tournament uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t record;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found or not (t.organizer_id = auth.uid() or public.has_perm('tournaments')) then
    raise exception 'not allowed';
  end if;
  return jsonb_build_object(
    'participants', (select count(*) from public.entries where tournament_id = t.id),
    'catches', (select count(*) from public.catches c join public.entries e on e.user_id = c.user_id and e.tournament_id = t.id
                 where c.status = 'approved' and c.captured_at_device >= t.starts_at and c.captured_at_device < t.ends_at),
    'sponsors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'tier', s.tier,
               'views', coalesce((select sum(views) from public.sponsor_stats x where x.sponsor_id = s.id), 0),
               'clicks', coalesce((select sum(clicks) from public.sponsor_stats x where x.sponsor_id = s.id), 0),
               'views_7d', coalesce((select sum(views) from public.sponsor_stats x where x.sponsor_id = s.id
                                      and x.day > (now() at time zone 'Europe/Vilnius')::date - 7), 0),
               'clicks_7d', coalesce((select sum(clicks) from public.sponsor_stats x where x.sponsor_id = s.id
                                       and x.day > (now() at time zone 'Europe/Vilnius')::date - 7), 0))
             order by (s.tier = 'main') desc, s.sort)
        from public.tournament_sponsors s where s.tournament_id = t.id), '[]'::jsonb));
end;
$$;
revoke all on function public.sponsor_report(uuid) from public, anon;
grant execute on function public.sponsor_report(uuid) to authenticated;

notify pgrst, 'reload schema';
