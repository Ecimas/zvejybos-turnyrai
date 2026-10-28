-- Tikras laimikio laikas. Telefono laikrodis gali būti pakeistas (pvz. atsuktas atgal prieš turnyro pabaigą). (Įdiegta į Supabase 2026-10-28.)
-- Žinomas skirtumas nuo serverio laiko pataiso laiką lentelėje ir dvikovose:
--   clock_offset_s – išmatuotas fotografuojant (0022), send_offset_s – išmatuotas siunčiant (čia).
-- Skirtumai iki 60 s ignoruojami (tinklo delsa), kad ties pabaigos riba niekas nepasislinktų be reikalo.

alter table public.catches add column if not exists sent_at_device timestamptz;
alter table public.catches add column if not exists send_offset_s integer;
alter table public.catches drop constraint if exists catches_send_offset_s_check;
alter table public.catches add constraint catches_send_offset_s_check
  check (send_offset_s is null or send_offset_s between -31536000 and 31536000);
grant select (send_offset_s) on public.catches to anon, authenticated;

-- Siuntimo skirtumą skaičiuoja serveris: kliento laikas siuntimo metu prieš serverio laiką.
create or replace function public.catches_send_offset()
returns trigger
language plpgsql
set search_path = public
as $$
declare v numeric;
begin
  new.send_offset_s := null;
  if new.sent_at_device is not null then
    v := round(extract(epoch from (now() - new.sent_at_device)));
    if abs(v) <= 31536000 then
      new.send_offset_s := v::int;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.catches_send_offset() from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'catches_send_offset' and tgrelid = 'public.catches'::regclass) then
    create trigger catches_send_offset before insert on public.catches for each row execute function public.catches_send_offset();
  end if;
end $$;

-- Tikras laikas = telefono laikas + žinomas skirtumas (pirmiausia fotografuojant, kitaip – siunčiant), jei jis ≥ 60 s.
create or replace function public.catch_time(p_device timestamptz, p_clock integer, p_send integer)
returns timestamptz
language sql
immutable
set search_path = public
as $$
  select p_device + make_interval(secs => case when abs(coalesce(p_clock, p_send, 0)) >= 60 then coalesce(p_clock, p_send) else 0 end);
$$;

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
    select c.user_id, public.catch_time(c.captured_at_device, c.clock_offset_s, c.send_offset_s) as ct,
           case when t.format = 'species_points'
                then (c.length_mm * coalesce((select ts.points_pct from public.tournament_species ts
                                               where ts.tournament_id = t.id and ts.species_id = c.species_id), 100)) / 100
                else c.length_mm end as pts
      from public.catches c
      join t on true
      join public.entries e on e.tournament_id = t.id and e.user_id = c.user_id
     where c.status = 'approved'
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
           max(el.ct)                     as last_counted
      from eligible el
      join t on true
     where el.rn <= case when t.format = 'biggest' then 1 else t.top_n end
     group by el.user_id
  ),
  ranked as (
    select rank() over (order by s.score_mm desc, s.last_counted asc) as rank,
           s.user_id, p.nickname, p.region, s.score_mm, s.counted, s.last_counted
      from scored s
      join public.profiles p on p.id = s.user_id
  )
  select r.rank, r.user_id, r.nickname, r.region, r.score_mm, r.counted, r.last_counted
    from ranked r
   order by r.rank, r.nickname;
$$;
revoke all on function public.leaderboard_all(uuid) from public, anon, authenticated;

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
       and c.length_mm >= t.min_length_mm
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
revoke all on function public.duel_score(uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated;

notify pgrst, 'reload schema';
