-- Funkcijos pirmiems žvejams. Tik nauji objektai, nauji stulpeliai ir create or replace.

-- ---------------------------------------------------------------
-- Laimikis: svoris, masalas, pastabos, oras
-- ---------------------------------------------------------------
alter table public.catches
  add column if not exists weight_g integer check (weight_g is null or weight_g between 1 and 200000),
  add column if not exists bait     text    check (bait is null or char_length(bait) <= 80),
  add column if not exists notes    text    check (notes is null or char_length(notes) <= 500),
  add column if not exists weather  jsonb   check (weather is null or (jsonb_typeof(weather) = 'object' and pg_column_size(weather) < 1000));

-- Savininkas po įkėlimo gali keisti tik masalą ir pastabas (ne ilgį, rūšį, laiką ar būseną).
grant update (bait, notes) on public.catches to authenticated;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catches' and policyname = 'catches_update_own') then
    create policy catches_update_own on public.catches for update to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- Turnyras: prizai, rėmėjas, paslėpta lentelė, kvietimo kodas
-- ---------------------------------------------------------------
alter table public.tournaments
  add column if not exists prizes             text    check (prizes is null or char_length(prizes) <= 500),
  add column if not exists sponsor_name       text    check (sponsor_name is null or char_length(sponsor_name) <= 60),
  add column if not exists sponsor_url        text    check (sponsor_url is null or sponsor_url ~ '^https://[^[:space:]<>"'']{3,200}$'),
  add column if not exists leaderboard_hidden boolean not null default false,
  add column if not exists invite_code        text    not null default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
create unique index if not exists tournaments_invite_code_uniq on public.tournaments (invite_code);

-- Lentelė: kai paslėpta ir turnyras dar vyksta, dalyvis mato tik savo rezultatą be vietos.
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

-- Kvietimas į privatų turnyrą: peržiūra ir prisijungimas pagal kodą.
create or replace function public.get_invite(p_code text)
returns table (id uuid, title text, format text, top_n smallint, min_length_mm integer,
               starts_at timestamptz, ends_at timestamptz, participants bigint)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.title, t.format, t.top_n, t.min_length_mm, t.starts_at, t.ends_at,
         (select count(*) from public.entries e where e.tournament_id = t.id)
    from public.tournaments t
   where t.invite_code = lower(trim(p_code)) and now() < t.ends_at;
$$;

create or replace function public.join_with_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  select id into v_id from public.tournaments
   where invite_code = lower(trim(p_code)) and now() < ends_at;
  if v_id is null then
    raise exception 'invite_invalid';
  end if;
  insert into public.entries (tournament_id, user_id) values (v_id, auth.uid())
  on conflict do nothing;
  return v_id;
end;
$$;

revoke all on function public.get_invite(text) from public;
revoke all on function public.join_with_invite(text) from public, anon;
grant execute on function public.get_invite(text) to anon, authenticated;
grant execute on function public.join_with_invite(text) to authenticated;
