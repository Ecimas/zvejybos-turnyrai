-- 0035: Turnyro nustatymai.
--  * Organizatorius gali taisyti savo turnyrą ir jam prasidėjus – tik tai, kas nekeičia rezultatų
--    (pavadinimas, aprašymas, pabaiga, matomumas, prizų aprašas, viršelis).
--  * Savininkas (rolė owner) gali keisti viską bet kada: formatą, rūšis, pradžią, divizionus, prizinį fondą.
--    Taisyklių pakeitimą su priežastimi gauna visi dalyviai (notify_rule_change).
--  * Turnyro viršelis (saugykla tournament-covers).
--  * Dalyvių valdymas: pašalinti dalyvį, pakeisti jo divizioną. Nauja kvietimo nuoroda.
-- Visi pakeitimai po starto rašomi į tournament_admin_log.

-- ---------------------------------------------------------------- Viršelis
alter table public.tournaments add column if not exists cover_path text;
alter table public.tournaments drop constraint if exists tournaments_cover_path_check;
alter table public.tournaments add constraint tournaments_cover_path_check
  check (cover_path is null or cover_path ~ ('^' || id::text || '/cover-[a-z0-9]{6,32}\.(webp|jpg)$'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tournament-covers', 'tournament-covers', true, 512000, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 512000, allowed_mime_types = array['image/webp', 'image/jpeg'];

-- Kas tvarko turnyrą: organizatorius arba administratorius (ir savininkas).
create or replace function public.can_manage_tournament(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.tournaments t
                  where t.id = p_id and (t.organizer_id = auth.uid() or public.has_perm('tournaments')));
$$;
revoke all on function public.can_manage_tournament(uuid) from public, anon;
grant execute on function public.can_manage_tournament(uuid) to authenticated;

create or replace function public.can_manage_tournament_cover(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name ~ '^[0-9a-f-]{36}/cover-[a-z0-9]{6,32}\.(webp|jpg)$'
     and public.can_manage_tournament(split_part(p_name, '/', 1)::uuid);
$$;
revoke all on function public.can_manage_tournament_cover(text) from public, anon;
grant execute on function public.can_manage_tournament_cover(text) to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tournament_covers_insert') then
    create policy tournament_covers_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'tournament-covers' and (select public.can_manage_tournament_cover(name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tournament_covers_delete') then
    create policy tournament_covers_delete on storage.objects for delete to authenticated
      using (bucket_id = 'tournament-covers' and (select public.can_manage_tournament_cover(name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'tournament_covers_select') then
    create policy tournament_covers_select on storage.objects for select
      using (bucket_id = 'tournament-covers');
  end if;
end $$;

-- ---------------------------------------------------------------- Kas ir kada gali keisti turnyrą
-- Organizatorius – bet kada (po starto sargas leidžia tik saugius laukus), administratorius – bet kada.
alter policy tournaments_update on public.tournaments
  using (organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')))
  with check (organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')));

-- Rūšys ir divizionai: iki starto – organizatorius ir administratorius; po starto – tik savininkas.
alter policy tournament_species_write on public.tournament_species
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id
                    and ((t.organizer_id = (select auth.uid()) and (now() < t.starts_at or t.created_at > now() - interval '10 minutes'))
                         or ((select public.has_perm('tournaments')) and now() < t.starts_at)
                         or (select public.has_perm('roles')))))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id
                         and ((t.organizer_id = (select auth.uid()) and (now() < t.starts_at or t.created_at > now() - interval '10 minutes'))
                              or ((select public.has_perm('tournaments')) and now() < t.starts_at)
                              or (select public.has_perm('roles')))));
alter policy tournament_divisions_write on public.tournament_divisions
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id
                    and ((now() < t.starts_at and (t.organizer_id = (select auth.uid()) or (select public.has_perm('tournaments'))))
                         or (select public.has_perm('roles')))))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id
                         and ((now() < t.starts_at and (t.organizer_id = (select auth.uid()) or (select public.has_perm('tournaments'))))
                              or (select public.has_perm('roles')))));

-- Sargas: po starto organizatorius ir administratorius keičia tik tai, kas nekeičia rezultatų; savininkas – viską.
-- Pakeitimai po starto (ir administratoriaus – bet kada) rašomi į žurnalą; organizatoriui – pranešimas, jei keitė kitas.
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
  v_owner boolean;
  v_invite boolean := coalesce(current_setting('zt.invite_regen', true), '') = '1';
  k text;
begin
  -- Tik užklausos iš programėlės (PostgREST nustato role = authenticated); serverio darbai ir migracijos – be sargo.
  if v_uid is null or coalesce(current_setting('role', true), '') <> 'authenticated' then
    return new;
  end if;
  if v_uid = old.organizer_id and now() < old.starts_at then
    return new; -- įprastas organizatoriaus redagavimas iki starto
  end if;
  v_owner := public.has_perm('roles');
  if now() >= old.starts_at and not v_owner then
    if new.format is distinct from old.format or new.top_n is distinct from old.top_n
       or new.min_length_mm is distinct from old.min_length_mm or new.starts_at is distinct from old.starts_at
       or new.team_mode is distinct from old.team_mode or new.league_id is distinct from old.league_id
       or new.prize_fund_cents is distinct from old.prize_fund_cents or new.prize_split is distinct from old.prize_split
       or new.fee_cents is distinct from old.fee_cents
       or (new.invite_code is distinct from old.invite_code and not v_invite) then
      raise exception 'started_rules_locked' using hint = 'Prasidėjusio turnyro taisyklių keisti negalima';
    end if;
  end if;
  if now() >= old.starts_at and new.ends_at is distinct from old.ends_at and new.ends_at < now() - interval '1 minute' then
    raise exception 'ends_in_past' using hint = 'Pabaiga negali būti praeityje';
  end if;
  for k in select jsonb_object_keys(v_new) loop
    if k not in ('created_at', 'organizer_id') and v_new -> k is distinct from v_old -> k then
      -- Kvietimo kodo į žurnalą nerašom (jis – kaip slaptažodis į privatų turnyrą).
      v_changes := v_changes || jsonb_build_object(k,
        case when k = 'invite_code' then jsonb_build_array('…', 'nauja nuoroda') else jsonb_build_array(v_old -> k, v_new -> k) end);
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
revoke all on function public.tournaments_admin_guard() from public, anon, authenticated;

-- Savos taškų taisyklės (0033): po starto keisti gali tik savininkas.
create or replace function public.tournaments_custom_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.format = 'custom' then
    if new.scoring is null then raise exception 'scoring_required'; end if;
    if (tg_op = 'INSERT' or old.format is distinct from 'custom' or old.scoring is distinct from new.scoring)
       and not public.has_perm('publish') then
      raise exception 'custom_not_allowed';
    end if;
    new.min_length_mm := 0;
    if new.scoring_rule_id is not null and not exists (
         select 1 from public.scoring_rules r where r.id = new.scoring_rule_id and r.owner_id = new.organizer_id) then
      new.scoring_rule_id := null;
    end if;
  else
    new.scoring := null;
    new.scoring_rule_id := null;
  end if;
  if tg_op = 'UPDATE' and old.starts_at <= now() and (old.format = 'custom' or new.format = 'custom')
     and (new.scoring is distinct from old.scoring or new.format is distinct from old.format)
     and not public.has_perm('roles') then
    raise exception 'scoring_locked';
  end if;
  return new;
end;
$$;
revoke all on function public.tournaments_custom_guard() from public, anon, authenticated;

-- ---------------------------------------------------------------- Taisyklių pakeitimas po starto: pranešimas dalyviams
create or replace function public.notify_rule_change(p_id uuid, p_reason text, p_summary text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  e record;
  n integer := 0;
  v_reason text := left(nullif(trim(coalesce(p_reason, '')), ''), 300);
  v_summary text := left(nullif(trim(coalesce(p_summary, '')), ''), 300);
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  if v_reason is null or char_length(v_reason) < 5 then
    raise exception 'reason_required' using hint = 'Nurodyk priežastį (bent 5 simboliai)';
  end if;
  select * into t from public.tournaments where id = p_id;
  if not found then
    raise exception 'not_found';
  end if;
  insert into public.tournament_admin_log (tournament_id, title, organizer_id, actor_id, action, changes, reason)
  values (t.id, t.title, t.organizer_id, auth.uid(), 'update', jsonb_build_object('rules_notice', jsonb_build_array(null, v_summary)), v_reason);
  for e in select distinct u.user_id from (
             select user_id from public.entries where tournament_id = t.id
             union select t.organizer_id) u
           where u.user_id is not null and u.user_id <> auth.uid() loop
    if public.notify_user(e.user_id, 'announcement', 'Pakeistos turnyro taisyklės',
         format('„%s“: %s. Priežastis: %s', t.title, coalesce(v_summary, 'taisyklės pakeistos'), v_reason), '#/t/' || t.id,
         format('trules:%s:%s:%s', t.id, md5(coalesce(v_summary, '') || v_reason), e.user_id)) then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.notify_rule_change(uuid, text, text) from public, anon;
grant execute on function public.notify_rule_change(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- Dalyvių valdymas
create or replace function public.remove_participant(p_tournament uuid, p_user uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_nick text;
  v_reason text := left(nullif(trim(coalesce(p_reason, '')), ''), 300);
begin
  if not public.can_manage_tournament(p_tournament) then
    raise exception 'not allowed';
  end if;
  select * into t from public.tournaments where id = p_tournament;
  select nickname into v_nick from public.profiles where id = p_user;
  delete from public.entries where tournament_id = p_tournament and user_id = p_user;
  if not found then
    raise exception 'not_found';
  end if;
  insert into public.tournament_admin_log (tournament_id, title, organizer_id, actor_id, action, changes, reason)
  values (t.id, t.title, t.organizer_id, auth.uid(), 'update',
          jsonb_build_object('participant_removed', jsonb_build_array(coalesce(v_nick, p_user::text), null)), v_reason);
  if p_user <> auth.uid() then
    perform public.notify_user(p_user, 'announcement', 'Pašalintas iš turnyro',
      format('Organizatorius pašalino tave iš turnyro „%s“.%s', t.title, coalesce(' Priežastis: ' || v_reason, '')), '#/t/' || t.id,
      format('tkick:%s:%s:%s', t.id, p_user, floor(extract(epoch from now()))::bigint));
  end if;
end;
$$;
revoke all on function public.remove_participant(uuid, uuid, text) from public, anon;
grant execute on function public.remove_participant(uuid, uuid, text) to authenticated;

create or replace function public.set_participant_division(p_tournament uuid, p_user uuid, p_division uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_tournament(p_tournament) then
    raise exception 'not allowed';
  end if;
  if p_division is not null and not exists (
       select 1 from public.tournament_divisions d where d.id = p_division and d.tournament_id = p_tournament) then
    raise exception 'division_invalid';
  end if;
  update public.entries set division_id = p_division where tournament_id = p_tournament and user_id = p_user;
  if not found then
    raise exception 'not_found';
  end if;
end;
$$;
revoke all on function public.set_participant_division(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_participant_division(uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- Nauja kvietimo nuoroda (senoji nustoja veikti)
create or replace function public.regenerate_invite(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.can_manage_tournament(p_id) then
    raise exception 'not allowed';
  end if;
  perform set_config('zt.invite_regen', '1', true);
  update public.tournaments set invite_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
   where id = p_id returning invite_code into v_code;
  perform set_config('zt.invite_regen', '', true);
  if v_code is null then
    raise exception 'not_found';
  end if;
  return v_code;
end;
$$;
revoke all on function public.regenerate_invite(uuid) from public, anon;
grant execute on function public.regenerate_invite(uuid) to authenticated;

notify pgrst, 'reload schema';
