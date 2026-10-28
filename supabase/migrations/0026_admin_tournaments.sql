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
