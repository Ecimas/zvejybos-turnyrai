-- Vėlyva registracija: organizatorius nusprendžia, kiek laiko po starto dar galima prisiregistruoti.
--   late_join_minutes = null  – iki turnyro pabaigos (kaip buvo iki šiol)
--   late_join_minutes = 0     – tik iki starto
--   late_join_minutes = N     – iki N minučių po starto (bet ne vėliau nei pabaiga)
alter table public.tournaments
  add column if not exists late_join_minutes integer
    constraint tournaments_late_join_minutes check (late_join_minutes is null or late_join_minutes between 0 and 172800);

-- Ar į turnyrą dar galima registruotis.
create or replace function public.registration_open(p_starts timestamptz, p_ends timestamptz, p_late integer)
returns boolean
language sql
stable
set search_path = public
as $$
  select now() < p_ends
     and (p_late is null or now() < p_starts + make_interval(mins => p_late));
$$;

-- Registruotis galima, kol registracija atvira; organizatorius į savo turnyrą – visada iki pabaigos.
alter policy entries_insert on public.entries
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tournaments t
                 where t.id = tournament_id and now() < t.ends_at
                   and (t.organizer_id = (select auth.uid())
                        or (t.visibility = 'public'
                            and public.registration_open(t.starts_at, t.ends_at, t.late_join_minutes))))
  );

-- Kvietimo peržiūra: rodoma tik kol registracija atvira.
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
   where t.invite_code = lower(trim(p_code))
     and public.registration_open(t.starts_at, t.ends_at, t.late_join_minutes);
$$;

create or replace function public.join_with_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_open boolean;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  select id, public.registration_open(starts_at, ends_at, late_join_minutes)
    into v_id, v_open
    from public.tournaments
   where invite_code = lower(trim(p_code)) and now() < ends_at;
  if v_id is null then
    raise exception 'invite_invalid';
  end if;
  -- Jau užsiregistravęs dalyvis per kvietimą tiesiog nukreipiamas į turnyrą.
  if exists (select 1 from public.entries where tournament_id = v_id and user_id = auth.uid()) then
    return v_id;
  end if;
  if not v_open then
    raise exception 'registration_closed';
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

notify pgrst, 'reload schema';
