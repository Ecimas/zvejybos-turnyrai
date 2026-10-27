-- Vėlai prisijungusio dalyvio įskaitomi tik laimikiai, pagauti po prisiregistravimo.
-- Prisiregistravusiems iki starto niekas nesikeičia (joined_at < starts_at).
create or replace function public.leaderboard(p_tournament_id uuid)
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
    select * from public.tournaments
     where id = p_tournament_id
       and (visibility = 'public'
            or organizer_id = auth.uid()
            or exists (select 1 from public.entries e
                        where e.tournament_id = p_tournament_id and e.user_id = auth.uid()))
  ),
  h as (
    select (t.leaderboard_hidden and now() < t.ends_at
            and t.organizer_id is distinct from auth.uid()
            and not public.is_admin()) as hidden
      from t
  ),
  eligible as (
    select c.user_id, c.length_mm, c.captured_at_device,
           row_number() over (partition by c.user_id
                              order by c.length_mm desc, c.captured_at_device asc) as rn
      from public.catches c
      join t on true
      join public.entries e on e.tournament_id = t.id and e.user_id = c.user_id
     where c.status = 'approved'
       and c.length_mm >= t.min_length_mm
       and c.captured_at_device >= t.starts_at
       and c.captured_at_device >= e.joined_at   -- vėlai prisijungusiam – tik po prisijungimo pagautos
       and c.captured_at_device <  t.ends_at
       and c.captured_at_device <= c.received_at + interval '10 minutes'
       and c.received_at <= t.ends_at + interval '24 hours'
       and (not exists (select 1 from public.tournament_species ts where ts.tournament_id = t.id)
            or c.species_id in (select ts.species_id from public.tournament_species ts
                                 where ts.tournament_id = t.id))
  ),
  scored as (
    select el.user_id,
           sum(el.length_mm)::bigint      as score_mm,
           count(*)::bigint               as counted,
           max(el.captured_at_device)     as last_counted
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
  select case when h.hidden then null else r.rank end,
         r.user_id, r.nickname, r.region, r.score_mm, r.counted, r.last_counted
    from ranked r
    cross join h
   where not h.hidden or r.user_id = auth.uid()
   order by r.rank, r.nickname;
$$;

notify pgrst, 'reload schema';
