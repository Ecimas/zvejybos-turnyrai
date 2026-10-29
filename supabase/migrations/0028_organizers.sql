-- Organizatoriai: privačius turnyrus (su kvietimu) gali kurti visi, viešus (matomus visų sąraše) – tik
-- patvirtinti organizatoriai (rolė „organizer“), administratoriai ir savininkas.
-- Žvejys gali paprašyti organizatoriaus teisių; prašymą patvirtina ar atmeta savininkas.
-- Organizatorius NĖRA komandos narys: is_admin lieka tik komandos rolėms (kitaip matytų nepatvirtintus laimikius ir pan.).

alter table public.profiles drop constraint if exists profiles_roles_valid;
alter table public.profiles add constraint profiles_roles_valid
  check (roles <@ array['owner', 'admin', 'moderator', 'judge', 'guard', 'organizer']::text[]);

create or replace function public.profiles_roles_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.is_admin is distinct from old.is_admin and new.roles is not distinct from old.roles then
    new.roles := case when new.is_admin then array['admin']::text[] || array_remove(old.roles, 'admin')
                      else (select coalesce(array_agg(r), '{}'::text[]) from unnest(old.roles) r where r = 'organizer') end;
  end if;
  new.roles := coalesce((select array_agg(distinct r order by r) from unnest(new.roles) r), '{}'::text[]);
  -- Komandos narys – tik turintis komandos rolę; organizatorius – ne.
  new.is_admin := new.roles && array['owner', 'admin', 'moderator', 'judge', 'guard']::text[];
  return new;
end;
$$;
revoke all on function public.profiles_roles_sync() from public, anon, authenticated;

create or replace function public.has_perm(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select 'owner' = any (roles)
        or (p_perm = 'review'      and roles && array['admin', 'moderator']::text[])
        or (p_perm = 'disputes'    and roles && array['admin', 'judge']::text[])
        or (p_perm = 'ban'         and roles && array['admin', 'guard']::text[])
        or (p_perm = 'tournaments' and roles && array['admin']::text[])
        or (p_perm = 'publish'     and roles && array['admin', 'organizer']::text[])
      from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(p order by p) filter (where public.has_perm(p)), '{}'::text[])
    from unnest(array['review', 'disputes', 'ban', 'roles', 'tournaments', 'publish']) p;
$$;

-- Rolių skyrimas: pridedama „organizer“.
create or replace function public.set_role(p_nickname text, p_role text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_roles text[];
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  if p_role is null or p_role not in ('admin', 'moderator', 'judge', 'guard', 'organizer') then
    raise exception 'role_invalid';
  end if;
  select id, roles into v_id, v_roles from public.profiles where lower(nickname) = lower(trim(p_nickname));
  if v_id is null then
    raise exception 'user not found';
  end if;
  if 'owner' = any (v_roles) then
    raise exception 'role_owner';
  end if;
  if p_on and exists (select 1 from public.user_bans where user_id = v_id and (until is null or until > now())) then
    raise exception 'role_banned';
  end if;
  if (p_role = any (v_roles)) = p_on then
    return;  -- jau toks
  end if;
  update public.profiles
     set roles = case when p_on then roles || p_role else array_remove(roles, p_role) end
   where id = v_id;
  insert into public.role_changes (user_id, role, granted, changed_by) values (v_id, p_role, p_on, auth.uid());
  if p_role = 'organizer' then
    update public.organizer_requests set status = case when p_on then 'approved' else status end,
           decided_at = now(), decided_by = auth.uid()
     where user_id = v_id and status = 'pending';
  end if;
end;
$$;

-- Viešą turnyrą sukurti (ar privatų paversti viešu) gali tik turintis teisę 'publish'.
-- Seni vieši turnyrai lieka vieši; serverio darbai (ne programėlės užklausos) netikrinami.
create or replace function public.tournaments_publish_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('role', true), '') <> 'authenticated' or new.visibility <> 'public' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.visibility = 'public' then
    return new;
  end if;
  if not public.has_perm('publish') then
    raise exception 'public_not_allowed' using hint = 'Viešus turnyrus kuria patvirtinti organizatoriai';
  end if;
  return new;
end;
$$;
revoke all on function public.tournaments_publish_guard() from public, anon, authenticated;
drop trigger if exists tournaments_publish_guard on public.tournaments;
create trigger tournaments_publish_guard before insert or update on public.tournaments
  for each row execute function public.tournaments_publish_guard();

-- Prašymai tapti organizatoriumi.
create table if not exists public.organizer_requests (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  message    text check (message is null or char_length(message) <= 300),
  status     text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null
);
create index if not exists organizer_requests_pending_idx on public.organizer_requests (created_at) where status = 'pending';
alter table public.organizer_requests enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organizer_requests' and policyname = 'organizer_requests_select') then
    create policy organizer_requests_select on public.organizer_requests for select to authenticated
      using (user_id = (select auth.uid()) or (select public.has_perm('roles')));
  end if;
end $$;
revoke all on public.organizer_requests from anon;
revoke insert, update, delete on public.organizer_requests from authenticated;
grant select on public.organizer_requests to authenticated;

create or replace function public.request_organizer(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_msg text := left(nullif(trim(coalesce(p_message, '')), ''), 300);
  v_nick text;
  o record;
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;
  if public.has_perm('publish') then
    raise exception 'already_organizer';
  end if;
  if exists (select 1 from public.user_bans where user_id = v_uid and (until is null or until > now())) then
    raise exception 'banned';
  end if;
  if exists (select 1 from public.organizer_requests where user_id = v_uid and status = 'pending') then
    raise exception 'request_pending';
  end if;
  if exists (select 1 from public.organizer_requests where user_id = v_uid and status = 'rejected' and decided_at > now() - interval '7 days') then
    raise exception 'request_cooldown' using hint = 'Pakartotinai prašyti galima po 7 dienų';
  end if;
  insert into public.organizer_requests (user_id, message, status, created_at)
  values (v_uid, v_msg, 'pending', now())
  on conflict (user_id) do update set message = excluded.message, status = 'pending', created_at = now(), decided_at = null, decided_by = null;
  select nickname into v_nick from public.profiles where id = v_uid;
  for o in select id from public.profiles where 'owner' = any (roles) loop
    perform public.notify_user(o.id, 'announcement', 'Prašymas tapti organizatoriumi',
      format('%s nori kurti viešus turnyrus.', v_nick), '#/moderavimas/komanda', format('orgreq:%s:%s', v_uid, extract(epoch from now())::bigint));
  end loop;
end;
$$;
revoke all on function public.request_organizer(text) from public, anon;
grant execute on function public.request_organizer(text) to authenticated;

create or replace function public.decide_organizer(p_user uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_nick text;
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  select nickname into v_nick from public.profiles where id = p_user;
  if v_nick is null or not exists (select 1 from public.organizer_requests where user_id = p_user and status = 'pending') then
    raise exception 'request_not_found';
  end if;
  if p_approve then
    perform public.set_role(v_nick, 'organizer', true);
    perform public.notify_user(p_user, 'announcement', 'Tapai organizatoriumi',
      'Dabar gali kurti viešus turnyrus, matomus visų sąraše.', '#/naujas', format('orgok:%s', p_user));
  else
    update public.organizer_requests set status = 'rejected', decided_at = now(), decided_by = auth.uid() where user_id = p_user;
    perform public.notify_user(p_user, 'announcement', 'Prašymas nepatvirtintas',
      'Kol kas gali kurti privačius turnyrus su kvietimu.', '#/profilis', format('orgno:%s:%s', p_user, extract(epoch from now())::bigint));
  end if;
end;
$$;
revoke all on function public.decide_organizer(uuid, boolean) from public, anon;
grant execute on function public.decide_organizer(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
