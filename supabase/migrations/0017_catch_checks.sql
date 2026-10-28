-- Atsitiktiniai patikrinimai: laimikių tikrintojas paprašo papildomos nuotraukos su užduotimi
-- (pvz. „su atviru delnu šalia žuvies“). Žvejys atsako tik programėlės kamera iki termino.
-- Neatsakius laiku arba nepraėjus patikros – laimikis atmetamas. Pranešimai – per push eilę.

create table if not exists public.catch_checks (
  id           uuid primary key default gen_random_uuid(),
  catch_id     uuid not null references public.catches (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid references public.profiles (id) on delete set null,
  instruction  text not null check (char_length(instruction) between 3 and 200),
  due_at       timestamptz not null,
  status       text not null default 'open' check (status in ('open', 'answered', 'passed', 'failed', 'expired')),
  photo_path   text,
  photo_sha256 text check (photo_sha256 is null or photo_sha256 ~ '^[0-9a-f]{64}$'),
  answered_at  timestamptz,
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id) on delete set null,
  note         text check (note is null or char_length(note) <= 200),
  created_at   timestamptz not null default now()
);
create unique index if not exists catch_checks_one_active on public.catch_checks (catch_id) where status in ('open', 'answered');
create index if not exists catch_checks_user_idx on public.catch_checks (user_id, status);
create index if not exists catch_checks_status_idx on public.catch_checks (status, due_at);
alter table public.catch_checks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_checks' and policyname = 'catch_checks_select') then
    create policy catch_checks_select on public.catch_checks for select to authenticated
      using (user_id = (select auth.uid()) or (select public.has_perm('review')));
  end if;
end $$;
revoke insert, update, delete on public.catch_checks from anon, authenticated;
revoke select on public.catch_checks from anon;

-- Paprašyti patikros (laimikių tikrintojas). p_hours – per kiek valandų atsakyti (1–48).
create or replace function public.request_catch_check(p_catch uuid, p_instruction text, p_hours integer default 2)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid; v_status text; v_id uuid; v_text text := trim(coalesce(p_instruction, ''));
begin
  if not public.has_perm('review') then
    raise exception 'not allowed';
  end if;
  select user_id, status into v_owner, v_status from public.catches where id = p_catch;
  if v_owner is null then
    raise exception 'catch not found';
  end if;
  if v_owner = auth.uid() then
    raise exception 'check_own';
  end if;
  if v_status not in ('pending', 'approved') then
    raise exception 'check_status';
  end if;
  if char_length(v_text) < 3 then
    raise exception 'check_instruction';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 48 then
    raise exception 'check_hours';
  end if;
  if exists (select 1 from public.catch_checks where catch_id = p_catch and status in ('open', 'answered')) then
    raise exception 'check_exists';
  end if;
  insert into public.catch_checks (catch_id, user_id, requested_by, instruction, due_at)
  values (p_catch, v_owner, auth.uid(), left(v_text, 200), now() + make_interval(hours => p_hours))
  returning id into v_id;
  begin
    perform public.notify_user(v_owner, 'review', 'Papildoma patikra',
      format('%s. Atsiųsk nuotrauką per %s val.', left(v_text, 150), p_hours), '#/patikra/' || v_id, 'check:' || v_id);
  exception when others then null;
  end;
  return v_id;
end;
$$;

-- Žvejys atsako: nuotrauka jau įkelta į savo aplanką kaip <uid>/check-<id>.jpg.
create or replace function public.answer_catch_check(p_id uuid, p_photo_path text, p_sha256 text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c record;
begin
  select * into c from public.catch_checks where id = p_id for update;
  if c.id is null or c.user_id is distinct from auth.uid() then
    raise exception 'not allowed';
  end if;
  if c.status <> 'open' then
    raise exception 'check_closed';
  end if;
  if now() > c.due_at then
    raise exception 'check_late';
  end if;
  if p_photo_path is distinct from (auth.uid()::text || '/check-' || p_id::text || '.jpg') then
    raise exception 'check_path';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'check_sha';
  end if;
  if exists (select 1 from public.catches where photo_sha256 = p_sha256)
     or exists (select 1 from public.catch_checks where photo_sha256 = p_sha256) then
    raise exception 'check_duplicate';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'catch-photos' and name = p_photo_path) then
    raise exception 'check_no_photo';
  end if;
  update public.catch_checks
     set status = 'answered', photo_path = p_photo_path, photo_sha256 = p_sha256, answered_at = now()
   where id = p_id;
end;
$$;

-- Sprendimas (laimikių tikrintojas): praėjo – laimikis lieka; nepraėjo – laimikis atmetamas.
create or replace function public.resolve_catch_check(p_id uuid, p_pass boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c record; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.has_perm('review') then
    raise exception 'not allowed';
  end if;
  select * into c from public.catch_checks where id = p_id for update;
  if c.id is null then
    raise exception 'check not found';
  end if;
  if c.user_id = auth.uid() then
    raise exception 'check_own';
  end if;
  if c.status not in ('answered', 'expired') or (p_pass and c.status <> 'answered') then
    raise exception 'check_state';
  end if;
  update public.catch_checks
     set status = case when p_pass then 'passed' else 'failed' end,
         resolved_at = now(), resolved_by = auth.uid(), note = left(v_note, 200)
   where id = p_id;
  if p_pass then
    update public.profiles set trust_score = least(100, trust_score + 2) where id = c.user_id;
  else
    update public.catches
       set status = 'rejected',
           reject_reason = left('Nepraėjo papildomos patikros' || coalesce(': ' || v_note, ''), 200),
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = c.catch_id and status <> 'rejected';
    update public.profiles set trust_score = greatest(0, trust_score - 10) where id = c.user_id;
  end if;
end;
$$;

-- Pasibaigęs terminas: laimikis atmetamas automatiškai (kas 5 min.).
create or replace function public.expire_catch_checks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare c record; n integer := 0;
begin
  for c in select * from public.catch_checks where status = 'open' and due_at < now() for update skip locked loop
    update public.catch_checks set status = 'expired', resolved_at = now() where id = c.id;
    update public.catches
       set status = 'rejected', reject_reason = 'Laiku neatsiųsta papildoma nuotrauka', reviewed_at = now()
     where id = c.catch_id and status <> 'rejected';
    update public.profiles set trust_score = greatest(0, trust_score - 5) where id = c.user_id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Atsitiktinis kandidatas: vykstančio turnyro trejetuko žvejo didžiausias laimikis, per 7 d. dar netikrintas.
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
                         order by c.length_mm desc, c.captured_at_device asc limit 1) b
   where now() >= t.starts_at and now() < t.ends_at
     and l.rank <= 3
     and l.user_id <> auth.uid()
     and not exists (select 1 from public.catch_checks k where k.catch_id = b.id and k.created_at > now() - interval '7 days')
   order by random()
   limit 1;
  return v;
end;
$$;

revoke all on function public.request_catch_check(uuid, text, integer) from public, anon;
revoke all on function public.answer_catch_check(uuid, text, text) from public, anon;
revoke all on function public.resolve_catch_check(uuid, boolean, text) from public, anon;
revoke all on function public.random_check_candidate() from public, anon;
revoke all on function public.expire_catch_checks() from public, anon, authenticated;
grant execute on function public.request_catch_check(uuid, text, integer) to authenticated;
grant execute on function public.answer_catch_check(uuid, text, text) to authenticated;
grant execute on function public.resolve_catch_check(uuid, boolean, text) to authenticated;
grant execute on function public.random_check_candidate() to authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('catch-checks-expire', '*/5 * * * *', 'select public.expire_catch_checks()');
  end if;
end;
$$;

notify pgrst, 'reload schema';
