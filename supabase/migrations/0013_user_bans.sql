-- Vartotojų blokavimas: administratorius gali laikinai ar visam laikui užblokuoti žvejį.
-- Užblokuotas gali prisijungti, žiūrėti, atsisiųsti ar ištrinti savo duomenis, bet negali:
-- registruoti laimikių, dalyvauti ar kurti turnyrų, rašyti pranešimų, ginčų, keisti slapyvardžio.
-- Kol blokavimas galioja, jo rezultatai lentelėse nerodomi.

create table if not exists public.user_bans (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  until      timestamptz,                                   -- null – visam laikui
  reason     text not null check (char_length(reason) between 3 and 300),
  banned_by  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.user_bans enable row level security;

-- Priežastį mato tik pats žvejys ir moderatoriai.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_bans' and policyname = 'user_bans_select') then
    create policy user_bans_select on public.user_bans for select to authenticated
      using (user_id = (select auth.uid()) or (select public.is_admin()));
  end if;
end $$;
revoke insert, update, delete on public.user_bans from anon, authenticated;
revoke select on public.user_bans from anon;

-- Ar dabartinis vartotojas užblokuotas.
create or replace function public.is_banned()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_bans
                  where user_id = auth.uid() and (until is null or until > now()));
$$;

-- Ribojimai (restrictive – papildomai prie esamų taisyklių).
do $$
declare r record;
begin
  for r in select * from (values
      ('catches', 'insert'), ('entries', 'insert'), ('tournaments', 'insert'), ('tournaments', 'update'),
      ('catch_reports', 'insert'), ('tournament_announcements', 'insert'), ('disputes', 'insert'),
      ('profiles', 'update')) v(tbl, cmd)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tbl
                    and policyname = r.tbl || '_not_banned_' || r.cmd) then
      if r.cmd = 'insert' then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (not (select public.is_banned()))',
                       r.tbl || '_not_banned_' || r.cmd, r.tbl);
      else
        execute format('create policy %I on public.%I as restrictive for update to authenticated using (not (select public.is_banned()))',
                       r.tbl || '_not_banned_' || r.cmd, r.tbl);
      end if;
    end if;
  end loop;
end;
$$;

-- Užblokuoti: p_days null – visam laikui. Moderatoriaus ar savęs blokuoti negalima.
create or replace function public.ban_user(p_user uuid, p_days integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if p_user = auth.uid() then
    raise exception 'ban_self';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'user not found';
  end if;
  if (select is_admin from public.profiles where id = p_user) then
    raise exception 'ban_admin';
  end if;
  if p_days is not null and (p_days < 1 or p_days > 3650) then
    raise exception 'ban_days';
  end if;
  if char_length(v_reason) < 3 then
    raise exception 'ban_reason';
  end if;
  insert into public.user_bans (user_id, until, reason, banned_by)
  values (p_user, case when p_days is null then null else now() + make_interval(days => p_days) end,
          left(v_reason, 300), auth.uid())
  on conflict (user_id) do update
    set until = excluded.until, reason = excluded.reason, banned_by = excluded.banned_by, created_at = now();
end;
$$;

create or replace function public.unban_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  -- Netrinam: blokavimas baigiamas dabar, istorija lieka.
  update public.user_bans set until = now()
   where user_id = p_user and (until is null or until > now());
end;
$$;

-- Netinkamą slapyvardį moderatorius pakeičia į automatinį (zvejys_xxxxxxxx).
create or replace function public.reset_nickname(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_nick text := 'zvejys_' || substr(replace(p_user::text, '-', ''), 1, 8);
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  update public.profiles set nickname = v_nick where id = p_user;
  if not found then
    raise exception 'user not found';
  end if;
  return v_nick;
end;
$$;

revoke all on function public.is_banned() from public, anon;
revoke all on function public.ban_user(uuid, integer, text) from public, anon;
revoke all on function public.unban_user(uuid) from public, anon;
revoke all on function public.reset_nickname(uuid) from public, anon;
grant execute on function public.is_banned() to authenticated;
grant execute on function public.ban_user(uuid, integer, text) to authenticated;
grant execute on function public.unban_user(uuid) to authenticated;
grant execute on function public.reset_nickname(uuid) to authenticated;

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
       and not exists (select 1 from public.user_bans b    -- užblokuoto žvejo rezultatai nerodomi
                        where b.user_id = c.user_id and (b.until is null or b.until > now()))
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
