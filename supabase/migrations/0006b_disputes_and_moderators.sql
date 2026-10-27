-- Funkcijos pirmiems žvejams. Tik nauji objektai, nauji stulpeliai ir create or replace.

-- ---------------------------------------------------------------
-- Ginčai dėl atmestų laimikių
-- ---------------------------------------------------------------
create table if not exists public.disputes (
  id          uuid primary key default gen_random_uuid(),
  catch_id    uuid not null unique references public.catches (id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  message     text not null check (char_length(trim(message)) between 3 and 500),
  status      text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  resolution  text check (resolution is null or char_length(resolution) <= 500),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists disputes_user_idx on public.disputes (user_id);
create index if not exists disputes_resolved_by_idx on public.disputes (resolved_by);
create index if not exists disputes_open_idx on public.disputes (created_at) where status = 'open';
alter table public.disputes enable row level security;

create or replace function public.disputes_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_id     := auth.uid();
  new.status      := 'open';
  new.resolution  := null;
  new.resolved_by := null;
  new.resolved_at := null;
  new.created_at  := now();
  new.message     := trim(new.message);
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'disputes_before_insert') then
    create trigger disputes_before_insert before insert on public.disputes
      for each row execute function public.disputes_before_insert();
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'disputes' and policyname = 'disputes_select') then
    create policy disputes_select on public.disputes for select
      using (user_id = (select auth.uid()) or (select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'disputes' and policyname = 'disputes_insert') then
    create policy disputes_insert on public.disputes for insert to authenticated
      with check (user_id = (select auth.uid())
                  and exists (select 1 from public.catches c
                               where c.id = catch_id and c.user_id = (select auth.uid()) and c.status = 'rejected'));
  end if;
end;
$$;
revoke update on public.disputes from anon, authenticated;  -- trinti neleidžia RLS (nėra taisyklės)

create or replace function public.resolve_dispute(p_id uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_catch uuid; v_owner uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  update public.disputes
     set status = case when p_accept then 'accepted' else 'rejected' end,
         resolution = nullif(trim(coalesce(p_note, '')), ''),
         resolved_by = auth.uid(),
         resolved_at = now()
   where id = p_id and status = 'open'
  returning catch_id, user_id into v_catch, v_owner;
  if v_catch is null then
    raise exception 'dispute not found';
  end if;
  if p_accept then
    update public.catches
       set status = 'approved', reject_reason = null, reviewed_by = auth.uid(), reviewed_at = now()
     where id = v_catch;
    -- Grąžinam už klaidingą atmetimą nuskaičiuotą patikimumą.
    update public.profiles set trust_score = least(100, trust_score + 5) where id = v_owner;
  end if;
end;
$$;

-- ---------------------------------------------------------------
-- Moderatorių skyrimas
-- ---------------------------------------------------------------
create or replace function public.set_moderator(p_nickname text, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  select id into v_id from public.profiles where lower(nickname) = lower(trim(p_nickname));
  if v_id is null then
    raise exception 'user not found';
  end if;
  if not p_admin and (select count(*) from public.profiles where is_admin) <= 1
     and (select is_admin from public.profiles where id = v_id) then
    raise exception 'last_admin';
  end if;
  update public.profiles set is_admin = p_admin where id = v_id;
end;
$$;

revoke all on function public.resolve_dispute(uuid, boolean, text) from public, anon;
revoke all on function public.set_moderator(text, boolean) from public, anon;
revoke all on function public.disputes_before_insert() from public, anon;
grant execute on function public.resolve_dispute(uuid, boolean, text) to authenticated;
grant execute on function public.set_moderator(text, boolean) to authenticated;
