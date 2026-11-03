-- Laimikio svėrimas ir turnyrai pagal svorį.
--  * Laimikis gali būti išmatuotas liniuote (ilgis), pasvertas (svoris) arba abu: ilgis nebeprivalomas,
--    bet bent vienas – ilgis ar svoris – būtinas.
--  * Turnyras: measure = 'length' (kaip iki šiol) arba 'weight' – „Sunkiausia žuvis“ / „Kelių svorių suma“,
--    rezultatas gramais, min. svoris min_weight_g. Svorio turnyras – tik su šiais dviem formatais.
--  * Lentelės, dvikovos, klubų rekordai, iššūkiai ir patikros: laimikiai be ilgio į ilgio skaičiavimus nepatenka.
-- Nieko netrinama: esami laimikiai ir turnyrai lieka kaip buvo (visi – pagal ilgį).

-- 1. Laimikis: ilgis arba svoris
alter table public.catches alter column length_mm drop not null;
alter table public.catches drop constraint if exists catches_length_mm_check;
alter table public.catches drop constraint if exists catches_length_ok;
alter table public.catches drop constraint if exists catches_size_ok;
alter table public.catches add constraint catches_length_ok check (length_mm is null or length_mm between 50 and 2500);
alter table public.catches add constraint catches_size_ok check (length_mm is not null or weight_g is not null);

-- 2. Turnyras: kaip matuojama
alter table public.tournaments add column if not exists measure text not null default 'length';
alter table public.tournaments add column if not exists min_weight_g integer not null default 0;
alter table public.tournaments drop constraint if exists tournaments_measure_ok;
alter table public.tournaments add constraint tournaments_measure_ok check (
  measure in ('length', 'weight') and min_weight_g between 0 and 200000
  and (measure = 'length' or format in ('biggest', 'top_n_sum')));

-- 3. Lentelė: svorio turnyre – gramai, ilgio – milimetrai
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
    select c.user_id, c.length_mm as len, public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) as ct,
           case when t.format = 'species_points'
                then (c.length_mm * coalesce((select ts.points_pct from public.tournament_species ts
                                               where ts.tournament_id = t.id and ts.species_id = c.species_id), 100)) / 100
                when t.measure = 'weight' then c.weight_g
                else c.length_mm end as pts
      from public.catches c
      join t on true
      join public.entries e on e.tournament_id = t.id and e.user_id = c.user_id
     where t.format <> 'custom'
       and c.status = 'approved'
       and case when t.measure = 'weight' then c.weight_g is not null and c.weight_g >= t.min_weight_g
                else c.length_mm is not null and c.length_mm >= t.min_length_mm end
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) >= t.starts_at
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) >= e.joined_at   -- vėlai prisijungusiam – tik po prisijungimo pagautos
       and not exists (select 1 from public.user_bans b    -- užblokuoto žvejo rezultatai nerodomi
                        where b.user_id = c.user_id and (b.until is null or b.until > now()))
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) <  t.ends_at
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) <= c.received_at + interval '10 minutes'
       and c.received_at <= t.ends_at + interval '24 hours'
       and (not exists (select 1 from public.tournament_species ts where ts.tournament_id = t.id)
            or c.species_id in (select ts.species_id from public.tournament_species ts
                                 where ts.tournament_id = t.id))
  ),
  eligible as (
    select b.*, row_number() over (partition by b.user_id order by b.pts desc, b.ct asc) as rn
      from base b
  ),
  scored as (
    select el.user_id,
           sum(el.pts)::bigint            as score_mm,
           count(*)::bigint               as counted,
           max(el.ct)                     as last_counted,
           max(el.len)::integer           as best_len
      from eligible el
      join t on true
     where el.rn <= case when t.format = 'biggest' then 1 else t.top_n end
     group by el.user_id
    union all
    select cs.user_id, cs.score, cs.counted, cs.last_counted, cs.best_len
      from t cross join lateral public.custom_scores(t.id) cs
     where t.format = 'custom'
  ),
  keyed as (
    select s.*,
           case when t.format = 'custom' then public.tie_key(t.scoring, 0, s.best_len, s.counted, s.last_counted)
                else extract(epoch from s.last_counted) end as k1,
           case when t.format = 'custom' then public.tie_key(t.scoring, 1, s.best_len, s.counted, s.last_counted) else 0 end as k2,
           case when t.format = 'custom' then public.tie_key(t.scoring, 2, s.best_len, s.counted, s.last_counted) else 0 end as k3
      from scored s
      join t on true
  ),
  ranked as (
    select rank() over (order by k.score_mm desc, k.k1, k.k2, k.k3) as rank,
           k.user_id, p.nickname, p.region, k.score_mm, k.counted, k.last_counted
      from keyed k
      join public.profiles p on p.id = k.user_id
  )
  select r.rank, r.user_id, r.nickname, r.region, r.score_mm, r.counted, r.last_counted
    from ranked r
   order by r.rank, r.nickname;
$$;

-- 4. Patikra: didžiausias lyderio laimikis (ilgis, o jei jo nėra – svoris)
create or replace function public.random_check_candidate()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v uuid;
begin
  if not public.has_perm('review') then
    raise exception 'not allowed';
  end if;
  -- Kiekvieno lyderio (1–3 vieta vykstančiame turnyre) didžiausias patvirtintas laimikis; atsitiktinai vienas.
  select b.id into v
    from public.tournaments t
    cross join lateral public.leaderboard_all(t.id) l
    cross join lateral (select c.id from public.catches c
                         where c.user_id = l.user_id and c.status = 'approved'
                           and c.captured_at_device >= t.starts_at and c.captured_at_device < t.ends_at
                         order by c.length_mm desc nulls last, c.weight_g desc nulls last, c.captured_at_device asc limit 1) b
   where now() >= t.starts_at and now() < t.ends_at
     and l.rank <= 3
     and l.user_id <> auth.uid()
     and not exists (select 1 from public.catch_checks k where k.catch_id = b.id and k.created_at > now() - interval '7 days')
   order by random()
   limit 1;
  return v;
end;
$$;

-- 5. Dvikovos – tik pagal ilgį
create or replace function public.duel_score(p_tournament uuid, p_user uuid, p_from timestamptz, p_to timestamptz)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  with t as (select * from public.tournaments where id = p_tournament),
  el as (
    select c.length_mm, row_number() over (order by c.length_mm desc, public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) asc) as rn
      from public.catches c join t on true
     where c.user_id = p_user and c.status = 'approved'
       and c.length_mm is not null and c.length_mm >= t.min_length_mm
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) >= p_from
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) < p_to
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) <= c.received_at + interval '10 minutes'
       and c.received_at <= t.ends_at + interval '24 hours'
       and not exists (select 1 from public.user_bans b where b.user_id = c.user_id and (b.until is null or b.until > now()))
       and (not exists (select 1 from public.tournament_species ts where ts.tournament_id = t.id)
            or c.species_id in (select ts.species_id from public.tournament_species ts where ts.tournament_id = t.id))
  )
  select coalesce(sum(el.length_mm), 0)::bigint from el join t on true where el.rn <= t.top_n;
$$;

-- 6. Klubo mėnesio iššūkis, sezono taškai ir rekordai – pagal ilgį
create or replace function public.club_challenge(p_club uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from timestamptz; v_to timestamptz; v_sp int; v_m date;
begin
  if not public.is_club_member(p_club) then raise exception 'not allowed'; end if;
  v_m := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Vilnius')::date))::date;
  v_from := v_m::timestamp at time zone 'Europe/Vilnius';
  v_to := (v_m + interval '1 month')::timestamp at time zone 'Europe/Vilnius';
  v_sp := public.challenge_species(v_m);
  return jsonb_build_object('month', v_m, 'species_id', nullif(v_sp, 0), 'ends_at', v_to,
    'top', coalesce((select jsonb_agg(x order by x.len desc) from (
      select distinct on (c.user_id) c.user_id, p.nickname, c.length_mm as len, c.id as catch_id, c.species_id
        from public.catches c join public.club_members m on m.user_id = c.user_id and m.club_id = p_club
        join public.profiles p on p.id = c.user_id
       where c.status = 'approved' and c.length_mm is not null and c.captured_at_device >= v_from and c.captured_at_device < v_to
         and (v_sp = 0 or c.species_id = v_sp)
       order by c.user_id, c.length_mm desc) x), '[]'::jsonb));
end;
$$;

create or replace function public.season_points(p_user uuid, p_year int)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(sum(len) / 10.0)::int, 0) from (
    select length_mm as len from public.catches
     where user_id = p_user and status = 'approved' and length_mm is not null and extract(year from captured_at_device at time zone 'Europe/Vilnius') = p_year
     order by length_mm desc limit 10) t;
$$;

create or replace function public.club_records(p_club uuid, p_year int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_year int := coalesce(p_year, extract(year from now() at time zone 'Europe/Vilnius')::int);
begin
  if not exists (select 1 from public.clubs where id = p_club) then raise exception 'club not found'; end if;
  return jsonb_build_object(
    'records', coalesce((select jsonb_agg(r order by r.len desc) from (
      select distinct on (c.species_id) c.species_id, c.length_mm as len, c.id as catch_id, c.user_id, p.nickname, c.captured_at_device as at
        from public.catches c join public.club_members m on m.user_id = c.user_id and m.club_id = p_club
        join public.profiles p on p.id = c.user_id
       where c.status = 'approved' and c.length_mm is not null
       order by c.species_id, c.length_mm desc, c.captured_at_device) r), '[]'::jsonb),
    'season', coalesce((select jsonb_agg(s order by s.points desc, s.catches desc) from (
      select m.user_id, p.nickname, public.season_points(m.user_id, v_year) as points,
             (select count(*) from public.catches c where c.user_id = m.user_id and c.status = 'approved'
                and extract(year from c.captured_at_device at time zone 'Europe/Vilnius') = v_year) as catches
        from public.club_members m join public.profiles p on p.id = m.user_id where m.club_id = p_club) s
      where s.points > 0), '[]'::jsonb),
    'year', v_year);
end;
$$;

-- 7. Savos taisyklės: be ilgio žuvis tinka taškams už svorį ar už žuvį
create or replace function public.custom_scores(p_tournament uuid)
returns table (user_id uuid, score bigint, counted bigint, last_counted timestamptz, best_len integer)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select id, scoring as r, starts_at, ends_at, min_length_mm
      from public.tournaments where id = p_tournament and format = 'custom' and scoring is not null
  ),
  sp as (
    select (x->>'id')::integer as species_id, (x->>'min_cm')::integer as min_cm, (x->>'m')::integer as m,
           case when jsonb_typeof(x->'max') = 'number' then (x->>'max')::integer end as mx
      from t, jsonb_array_elements(t.r->'species') x
  ),
  bon as (
    select x->>'type' as type, (x->>'add')::integer as add, (x->>'cm')::integer as cm, (x->>'g')::integer as g,
           (x->>'from')::integer as hf, (x->>'to')::integer as ht, (x->>'m')::integer as m, e.ord
      from t, jsonb_array_elements(t.r->'bonuses') with ordinality as e(x, ord)
  ),
  base as (
    select c.id, c.user_id, c.species_id, c.length_mm, c.weight_g,
           public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) as ct
      from public.catches c
      join t on true
      join public.entries e on e.tournament_id = t.id and e.user_id = c.user_id
     where c.status = 'approved'
       and coalesce(c.length_mm, 0) >= t.min_length_mm
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) >= t.starts_at
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) >= e.joined_at
       and not exists (select 1 from public.user_bans b where b.user_id = c.user_id and (b.until is null or b.until > now()))
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) <  t.ends_at
       and public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) <= c.received_at + interval '10 minutes'
       and c.received_at <= t.ends_at + interval '24 hours'
       and (not exists (select 1 from public.tournament_species ts where ts.tournament_id = t.id)
            or c.species_id in (select ts.species_id from public.tournament_species ts where ts.tournament_id = t.id))
  ),
  el as (
    select b.*, coalesce(s.min_cm, 0) as min_cm, coalesce(s.m, 100) as m, s.mx, t.r->>'base' as base_kind
      from base b
      join t on true
      left join sp s on s.species_id = b.species_id
     where (not exists (select 1 from sp) or s.species_id is not null)
       -- Be ilgio (tik pasverta) žuvis tinka tik taškams už svorį ar už žuvį ir kai rūšiai nėra min. ilgio
       and case when b.length_mm is null then t.r->>'base' in ('kg', 'fish') and coalesce(s.min_cm, 0) = 0
                else b.length_mm >= coalesce(s.min_cm, 0) * 10 end
       and (t.r->>'base' <> 'kg' or coalesce(b.weight_g, 0) > 0)
  ),
  p0 as (
    select el.*,
           (case el.base_kind
              when 'cm' then floor(el.length_mm::numeric * el.m / 100)
              when 'cm_over_min' then floor(greatest(0, el.length_mm - el.min_cm * 10)::numeric * el.m / 100)
              when 'fish' then floor(el.m::numeric / 10)
              else floor(coalesce(el.weight_g, 0)::numeric * el.m / 10000) end)::bigint as p0,
           extract(hour from el.ct at time zone 'Europe/Vilnius')::integer as hr
      from el
  ),
  pts as (
    select p.*,
           coalesce((select floor(p.p0::numeric * b.m / 100)::bigint from bon b
                      where b.type = 'time' and case when b.hf < b.ht then p.hr >= b.hf and p.hr < b.ht else p.hr >= b.hf or p.hr < b.ht end
                      order by b.ord limit 1), p.p0)
           + coalesce((select b.add from bon b where b.type = 'len_min' and p.length_mm >= b.cm * 10 order by b.cm desc, b.ord limit 1), 0)
           + coalesce((select b.add from bon b where b.type = 'weight_min' and coalesce(p.weight_g, 0) >= b.g order by b.g desc, b.ord limit 1), 0)
           + coalesce((select sum(b.add) from bon b where b.type = 'per_fish'), 0) as pts
      from p0 p
  ),
  capped as (
    select q.*, row_number() over (partition by q.user_id, q.species_id order by q.pts desc, q.ct, q.id) as rs from pts q
  ),
  c2 as (select * from capped where mx is null or rs <= mx),
  ranked as (
    select c2.*,
           row_number() over (partition by c2.user_id order by c2.pts desc, c2.ct, c2.id) as ru,
           row_number() over (partition by c2.user_id, c2.species_id order by c2.pts desc, c2.ct, c2.id) as rsp
      from c2
  ),
  kept as (
    select k.* from ranked k join t on true
     where case t.r->'aggregate'->>'mode'
             when 'all' then true
             when 'best' then k.ru = 1
             when 'best_n' then k.ru <= (t.r->'aggregate'->>'n')::integer
             else k.rsp <= (t.r->'aggregate'->>'n')::integer end
  ),
  big as (select p.user_id from pts p order by p.length_mm desc nulls last, p.ct, p.id limit 1),
  fst as (select p.user_id from pts p order by p.ct, p.id limit 1)
  select k.user_id,
         (sum(k.pts)
          + coalesce((select sum(b.add) from bon b where b.type = 'species'), 0) * count(distinct k.species_id)
          + case when k.user_id = (select big.user_id from big) then coalesce((select sum(b.add) from bon b where b.type = 'biggest'), 0) else 0 end
          + case when k.user_id = (select fst.user_id from fst) then coalesce((select sum(b.add) from bon b where b.type = 'first'), 0) else 0 end)::bigint,
         count(*)::bigint,
         max(k.ct),
         coalesce(max(k.length_mm), 0)::integer
    from kept k
   group by k.user_id;
$$;

-- 8. Pranešimas apie patvirtinimą: ilgis arba svoris
create or replace function public.catches_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sp text;
  v_len text;
  t record;
begin
  if new.status is not distinct from old.status or new.status not in ('approved', 'rejected') then
    return new;
  end if;
  begin
    select name_lt into v_sp from public.species where id = new.species_id;
    -- Dydis tekstu: ilgis („81 cm“) arba, jei tik pasverta, svoris („12,45 kg“)
    v_len := case when new.length_mm is null then replace(trim(to_char(new.weight_g / 1000.0, 'FM9990.00')), '.', ',') || ' kg'
                  when new.length_mm % 10 = 0 then (new.length_mm / 10)::text || ' cm'
                  else replace(round(new.length_mm / 10.0, 1)::text, '.', ',') || ' cm' end;
    if new.status = 'approved' then
      perform public.notify_user(new.user_id, 'review', 'Laimikis patvirtintas',
        format('%s %s – patvirtinta ir įskaityta turnyruose.', coalesce(v_sp, 'Žuvis'), v_len),
        '#/l/' || new.id, format('review:%s:approved', new.id));
    else
      perform public.notify_user(new.user_id, 'review', 'Laimikis atmestas',
        format('%s %s. Priežastis: %s', coalesce(v_sp, 'Žuvis'), v_len, coalesce(new.reject_reason, 'nenurodyta')),
        '#/l/' || new.id, format('review:%s:rejected', new.id));
    end if;
    for t in select tt.id from public.tournaments tt
               join public.entries e on e.tournament_id = tt.id and e.user_id = new.user_id
              where now() >= tt.starts_at and now() < tt.ends_at + interval '24 hours'
                and new.captured_at_device >= tt.starts_at and new.captured_at_device < tt.ends_at loop
      perform public.refresh_ranks(t.id, case when new.status = 'approved' then new.user_id end, new.id);
    end loop;
  exception when others then
    raise warning 'catches_notify: %', sqlerrm;
  end;
  return new;
end;
$$;

-- 9. Prasidėjusio turnyro matavimo būdo ir min. svorio keisti negalima
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
       or new.min_length_mm is distinct from old.min_length_mm
       or new.measure is distinct from old.measure or new.min_weight_g is distinct from old.min_weight_g or new.starts_at is distinct from old.starts_at
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

-- Turnyro rezultato žinutė (0036): prie meta pridedamas matavimas, kad programėlė rezultatą rodytų kg arba cm.
create or replace function public.messages_result_measure()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.meta ->> 'event' = 'result' and not (new.meta ? 'measure') then
    new.meta := new.meta || jsonb_build_object('measure',
      (select t.measure from public.conversations c join public.tournaments t on t.id = c.tournament_id where c.id = new.conversation_id));
  end if;
  return new;
end;
$$;
revoke execute on function public.messages_result_measure() from public, anon, authenticated;
drop trigger if exists messages_result_measure on public.messages;
create trigger messages_result_measure before insert on public.messages
  for each row execute function public.messages_result_measure();

notify pgrst, 'reload schema';
