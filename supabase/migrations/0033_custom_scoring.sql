-- Savos taškų taisyklės (formatas „custom“): organizatoriai kuria ir išsisaugo taisyklių rinkinius,
-- turnyrui nukopijuojama taisyklių kopija (pakeitus rinkinį vykstantys turnyrai nesikeičia).
-- Skaičiavimas – tas pats kaip src/lib/custom_scoring.js (visi skaičiai sveikieji, taškai dešimtosiomis).

-- ---------------------------------------------------------------- Taisyklių tikrinimas
create or replace function public.scoring_int(j jsonb, lo integer, hi integer)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_typeof(j) = 'number' and (j::text)::numeric = trunc((j::text)::numeric)
         and (j::text)::numeric between lo and hi, false);
$$;

create or replace function public.valid_scoring(r jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare s jsonb; b jsonb; t text; ids integer[] := '{}'; tb text[] := '{}';
begin
  if r is null then return true; end if;
  if jsonb_typeof(r) <> 'object' or not public.scoring_int(r->'v', 1, 1) then return false; end if;
  if coalesce(r->>'base', '') not in ('cm', 'cm_over_min', 'fish', 'kg') then return false; end if;
  if jsonb_typeof(r->'species') is distinct from 'array' or jsonb_array_length(r->'species') > 30 then return false; end if;
  for s in select x from jsonb_array_elements(r->'species') x loop
    if jsonb_typeof(s) <> 'object' or not public.scoring_int(s->'id', 1, 32767)
       or not public.scoring_int(s->'min_cm', 0, 300) or not public.scoring_int(s->'m', 0, 100000)
       or not (s ? 'max') or (jsonb_typeof(s->'max') <> 'null' and not public.scoring_int(s->'max', 1, 100)) then
      return false;
    end if;
    if (s->>'id')::integer = any (ids) then return false; end if;
    ids := ids || (s->>'id')::integer;
  end loop;
  if jsonb_typeof(r->'bonuses') is distinct from 'array' or jsonb_array_length(r->'bonuses') > 20 then return false; end if;
  for b in select x from jsonb_array_elements(r->'bonuses') x loop
    t := b->>'type';
    if t is null or t not in ('len_min', 'weight_min', 'per_fish', 'time', 'species', 'biggest', 'first') then return false; end if;
    if t = 'time' then
      if not public.scoring_int(b->'from', 0, 23) or not public.scoring_int(b->'to', 0, 23) or (b->>'from') = (b->>'to')
         or not public.scoring_int(b->'m', 0, 100000) then return false; end if;
    else
      if not public.scoring_int(b->'add', -100000, 100000) then return false; end if;
      if t = 'len_min' and not public.scoring_int(b->'cm', 1, 300) then return false; end if;
      if t = 'weight_min' and not public.scoring_int(b->'g', 1, 200000) then return false; end if;
    end if;
  end loop;
  if jsonb_typeof(r->'aggregate') is distinct from 'object'
     or coalesce(r->'aggregate'->>'mode', '') not in ('all', 'best_n', 'best_n_per_species', 'best')
     or not public.scoring_int(r->'aggregate'->'n', 1, 100) then return false; end if;
  if jsonb_typeof(r->'tiebreak') is distinct from 'array' or jsonb_array_length(r->'tiebreak') > 3 then return false; end if;
  for t in select x from jsonb_array_elements_text(r->'tiebreak') x loop
    if t not in ('biggest_fish', 'earliest', 'most_fish') or t = any (tb) then return false; end if;
    tb := tb || t;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------- Formatas ir turnyro taisyklių kopija
alter table public.tournaments drop constraint if exists tournaments_format_check;
alter table public.tournaments add constraint tournaments_format_check
  check (format in ('biggest', 'top_n_sum', 'species_points', 'duels', 'custom'));

create table if not exists public.scoring_rules (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 3 and 60),
  rules      jsonb not null check (public.valid_scoring(rules)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists scoring_rules_name_uniq on public.scoring_rules (owner_id, lower(trim(name)));
alter table public.scoring_rules enable row level security;

alter table public.tournaments add column if not exists scoring jsonb;
alter table public.tournaments drop constraint if exists tournaments_scoring_check;
alter table public.tournaments add constraint tournaments_scoring_check check (public.valid_scoring(scoring));
alter table public.tournaments add column if not exists scoring_rule_id uuid references public.scoring_rules (id) on delete set null;
create index if not exists tournaments_scoring_rule_idx on public.tournaments (scoring_rule_id) where scoring_rule_id is not null;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scoring_rules' and policyname = 'scoring_rules_select') then
    create policy scoring_rules_select on public.scoring_rules for select to authenticated using (owner_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scoring_rules' and policyname = 'scoring_rules_insert') then
    create policy scoring_rules_insert on public.scoring_rules for insert to authenticated
      with check (owner_id = (select auth.uid()) and (select public.has_perm('publish')) and not (select public.is_banned()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scoring_rules' and policyname = 'scoring_rules_update') then
    create policy scoring_rules_update on public.scoring_rules for update to authenticated
      using (owner_id = (select auth.uid()))
      with check (owner_id = (select auth.uid()) and (select public.has_perm('publish')) and not (select public.is_banned()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'scoring_rules' and policyname = 'scoring_rules_delete') then
    create policy scoring_rules_delete on public.scoring_rules for delete to authenticated using (owner_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.scoring_rules from anon;
revoke insert, update on public.scoring_rules from authenticated;
grant select, delete on public.scoring_rules to authenticated;
grant insert (name, rules), update (name, rules) on public.scoring_rules to authenticated;

create or replace function public.scoring_rules_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name := trim(new.name);
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
    if (select count(*) from public.scoring_rules where owner_id = new.owner_id) >= 30 then
      raise exception 'rules_limit';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.scoring_rules_before_write() from public, anon, authenticated;
drop trigger if exists scoring_rules_before_write on public.scoring_rules;
create trigger scoring_rules_before_write before insert or update on public.scoring_rules
  for each row execute function public.scoring_rules_before_write();

-- Savas taisykles turnyrui pasirenka tik organizatoriai; prasidėjus turnyrui taisyklės nebekeičiamos.
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
     and (new.scoring is distinct from old.scoring or new.format is distinct from old.format) then
    raise exception 'scoring_locked';
  end if;
  return new;
end;
$$;
revoke all on function public.tournaments_custom_guard() from public, anon, authenticated;
drop trigger if exists tournaments_custom_guard on public.tournaments;
create trigger tournaments_custom_guard before insert or update on public.tournaments
  for each row execute function public.tournaments_custom_guard();

-- ---------------------------------------------------------------- Skaičiavimas
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
       and c.length_mm >= t.min_length_mm
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
       and b.length_mm >= coalesce(s.min_cm, 0) * 10
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
  big as (select p.user_id from pts p order by p.length_mm desc, p.ct, p.id limit 1),
  fst as (select p.user_id from pts p order by p.ct, p.id limit 1)
  select k.user_id,
         (sum(k.pts)
          + coalesce((select sum(b.add) from bon b where b.type = 'species'), 0) * count(distinct k.species_id)
          + case when k.user_id = (select big.user_id from big) then coalesce((select sum(b.add) from bon b where b.type = 'biggest'), 0) else 0 end
          + case when k.user_id = (select fst.user_id from fst) then coalesce((select sum(b.add) from bon b where b.type = 'first'), 0) else 0 end)::bigint,
         count(*)::bigint,
         max(k.ct),
         max(k.length_mm)::integer
    from kept k
   group by k.user_id;
$$;
revoke all on function public.custom_scores(uuid) from public, anon, authenticated;

-- Lygiųjų raktas (mažesnis – aukščiau), kaip tieKeys JS.
create or replace function public.tie_key(r jsonb, i integer, best_len integer, counted bigint, last_counted timestamptz)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case r->'tiebreak'->>i
           when 'biggest_fish' then -best_len::numeric
           when 'most_fish' then -counted::numeric
           when 'earliest' then extract(epoch from last_counted)
           else 0 end;
$$;
revoke all on function public.tie_key(jsonb, integer, integer, bigint, timestamptz) from public, anon, authenticated;

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
                else c.length_mm end as pts
      from public.catches c
      join t on true
      join public.entries e on e.tournament_id = t.id and e.user_id = c.user_id
     where t.format <> 'custom'
       and c.status = 'approved'
       and c.length_mm >= t.min_length_mm
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
revoke all on function public.leaderboard_all(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
