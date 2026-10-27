-- Rolės ir teisės.
--   owner     – Savininkas: viskas + rolių skyrimas (skiriamas tik per SQL, programėlėje nekeičiamas)
--   admin     – Administratorius: laimikiai, ginčai ir pranešimai, blokavimas
--   moderator – Laimikių tikrintojas: laimikių eilė ir GPS vietos
--   judge     – Ginčų teisėjas: ginčai ir pranešimai apie laimikius
--   guard     – Bendruomenės prižiūrėtojas: blokavimas ir slapyvardžių keitimas
-- Teisės: review, disputes, ban, roles. profiles.is_admin lieka kaip „turi bent vieną rolę“ (sinchronizuojama).

alter table public.profiles
  add column if not exists roles text[] not null default '{}'::text[]
    constraint profiles_roles_valid check (roles <@ array['owner', 'admin', 'moderator', 'judge', 'guard']::text[]);

-- is_admin ir roles visada suderinti. Senas būdas (is_admin = true/false) virsta „admin“ role / jokių rolių.
create or replace function public.profiles_roles_sync()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.is_admin is distinct from old.is_admin and new.roles is not distinct from old.roles then
    new.roles := case when new.is_admin then array['admin']::text[] else '{}'::text[] end;
  end if;
  new.roles := coalesce((select array_agg(distinct r order by r) from unnest(new.roles) r), '{}'::text[]);
  new.is_admin := cardinality(new.roles) > 0;
  return new;
end;
$$;
revoke all on function public.profiles_roles_sync() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'profiles_roles_sync' and tgrelid = 'public.profiles'::regclass) then
    create trigger profiles_roles_sync before insert or update on public.profiles
      for each row execute function public.profiles_roles_sync();
  end if;
end $$;

-- Esami administratoriai tampa savininkais (produkcijoje – vienintelis projekto savininkas).
update public.profiles set roles = array['owner']::text[] where is_admin and cardinality(roles) = 0;

-- Ar dabartinis vartotojas turi teisę.
create or replace function public.has_perm(p_perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select 'owner' = any (roles)
        or (p_perm = 'review'   and roles && array['admin', 'moderator']::text[])
        or (p_perm = 'disputes' and roles && array['admin', 'judge']::text[])
        or (p_perm = 'ban'      and roles && array['admin', 'guard']::text[])
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
    from unnest(array['review', 'disputes', 'ban', 'roles']) p;
$$;

-- Rolių keitimų žurnalas (tik pridedama).
create table if not exists public.role_changes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       text not null,
  granted    boolean not null,
  changed_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.role_changes enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'role_changes' and policyname = 'role_changes_select') then
    create policy role_changes_select on public.role_changes for select to authenticated using ((select public.has_perm('roles')));
  end if;
end $$;
revoke insert, update, delete on public.role_changes from anon, authenticated;
revoke select on public.role_changes from anon;

-- Suteikti / atimti rolę pagal slapyvardį. Savininko rolių keisti negalima.
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
  if p_role is null or p_role not in ('admin', 'moderator', 'judge', 'guard') then
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
end;
$$;

-- Senas moderatorių skyrimas = Administratoriaus rolė.
create or replace function public.set_moderator(p_nickname text, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.set_role(p_nickname, 'admin', p_admin);
end;
$$;

-- Veiksmai tikrina konkrečią teisę.
create or replace function public.review_catch(p_catch_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_prev  text;
begin
  if not public.has_perm('review') then
    raise exception 'not allowed';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'reject reason is required';
  end if;
  select user_id, status into v_owner, v_prev from public.catches where id = p_catch_id for update;
  if not found then
    raise exception 'catch not found';
  end if;
  update public.catches
     set status        = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else trim(p_reason) end,
         reviewed_by   = auth.uid(),
         reviewed_at   = now()
   where id = p_catch_id;
  -- Reitingas keičiamas tik pirmą kartą peržiūrint (ne kiekvieną kartą perpatvirtinant).
  if v_prev = 'pending' then
    update public.profiles
       set trust_score = case when p_approve then least(100, trust_score + 1)
                              else greatest(0, trust_score - 5) end
     where id = v_owner;
  end if;
end;
$$;

create or replace function public.resolve_dispute(p_id uuid, p_accept boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_catch uuid; v_owner uuid;
begin
  if not public.has_perm('disputes') then
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

create or replace function public.resolve_report(p_id uuid, p_uphold boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_catch uuid;
begin
  if not public.has_perm('disputes') then
    raise exception 'not allowed';
  end if;
  select catch_id into v_catch from public.catch_reports where id = p_id and status = 'open';
  if v_catch is null then
    raise exception 'report not found';
  end if;
  if p_uphold then
    if coalesce(trim(p_reason), '') = '' then
      raise exception 'reject reason is required';
    end if;
    update public.catches
       set status = 'rejected', reject_reason = trim(p_reason), reviewed_by = auth.uid(), reviewed_at = now()
     where id = v_catch;
    update public.profiles p set trust_score = greatest(0, p.trust_score - 5)
      from public.catches c where c.id = v_catch and p.id = c.user_id;
  end if;
  -- Vienas sprendimas uždaro visus to laimikio pranešimus.
  update public.catch_reports
     set status = case when p_uphold then 'upheld' else 'dismissed' end,
         resolved_by = auth.uid(), resolved_at = now()
   where catch_id = v_catch and status = 'open';
end;
$$;

create or replace function public.ban_user(p_user uuid, p_days integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_reason text := trim(coalesce(p_reason, ''));
begin
  if not public.has_perm('ban') then
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
  if not public.has_perm('ban') then
    raise exception 'not allowed';
  end if;
  -- Netrinam: blokavimas baigiamas dabar, istorija lieka.
  update public.user_bans set until = now()
   where user_id = p_user and (until is null or until > now());
end;
$$;

create or replace function public.reset_nickname(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_nick text := 'zvejys_' || substr(replace(p_user::text, '-', ''), 1, 8);
begin
  if not public.has_perm('ban') then
    raise exception 'not allowed';
  end if;
  update public.profiles set nickname = v_nick where id = p_user;
  if not found then
    raise exception 'user not found';
  end if;
  return v_nick;
end;
$$;

-- Skaitymas: GPS vietos – tik laimikių tikrintojams; ginčai ir pranešimai – teisėjams; blokavimai – prižiūrėtojams.
alter policy catch_locations_select on public.catch_locations
  using ((select public.has_perm('review'))
         or exists (select 1 from public.catches c where c.id = catch_id and c.user_id = (select auth.uid())));
alter policy disputes_select on public.disputes
  using (user_id = (select auth.uid()) or (select public.has_perm('disputes')));
alter policy catch_reports_select on public.catch_reports
  using (reporter_id = (select auth.uid()) or (select public.has_perm('disputes')));
alter policy user_bans_select on public.user_bans
  using (user_id = (select auth.uid()) or (select public.has_perm('ban')));

revoke all on function public.has_perm(text) from public, anon;
revoke all on function public.my_permissions() from public, anon;
revoke all on function public.set_role(text, text, boolean) from public, anon;
grant execute on function public.has_perm(text) to authenticated;
grant execute on function public.my_permissions() to authenticated;
grant execute on function public.set_role(text, text, boolean) to authenticated;

notify pgrst, 'reload schema';
