-- Klubai+: administratoriai, prašymai prisijungti, logotipas ir viršelis, patvirtinti klubai, pranešimai, išvykos,
-- reakcijos ir komentarai, patarimai, mėnesio iššūkis, rekordai ir sezono reitingas, klubų lyga, klubo žemėlapis,
-- rėmėjų nuolaidos nariams. Ir funkcijų jungikliai (būsimai administravimo panelei).

-- ---------------------------------------------------------------- Funkcijų jungikliai
create table if not exists public.app_features (
  key        text primary key check (key ~ '^[a-z_]{2,40}$'),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
alter table public.app_features enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_features' and policyname = 'app_features_select') then
    create policy app_features_select on public.app_features for select using (true);
  end if;
end $$;
revoke insert, update, delete on public.app_features from anon, authenticated;
grant select on public.app_features to anon, authenticated;
insert into public.app_features (key) values
  ('map_vector'), ('club_posts'), ('club_trips'), ('club_reactions'), ('club_comments'), ('club_tips'), ('club_challenge'),
  ('club_records'), ('club_league'), ('club_map'), ('club_perks'), ('club_tournament')
on conflict (key) do nothing;

create or replace function public.set_feature(p_key text, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  update public.app_features set enabled = p_on, updated_at = now(), updated_by = auth.uid() where key = p_key;
  if not found then raise exception 'feature not found'; end if;
end;
$$;
revoke all on function public.set_feature(text, boolean) from public, anon;
grant execute on function public.set_feature(text, boolean) to authenticated;

create or replace function public.feature_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select enabled from public.app_features where key = p_key), true);
$$;
grant execute on function public.feature_on(text) to anon, authenticated;

-- ---------------------------------------------------------------- Klubas: rolės, išvaizda, patvirtinimas
alter table public.club_members drop constraint if exists club_members_role_check;
alter table public.club_members add constraint club_members_role_check check (role in ('owner', 'admin', 'member'));
alter table public.club_members add column if not exists share_map boolean not null default false;

alter table public.clubs add column if not exists logo_path text;
alter table public.clubs add column if not exists cover_path text;
alter table public.clubs add column if not exists verified boolean not null default false;
alter table public.clubs drop constraint if exists clubs_logo_path_check;
alter table public.clubs add constraint clubs_logo_path_check
  check (logo_path is null or logo_path ~ ('^' || id::text || '/logo-[a-z0-9]{6,32}\.(webp|png|jpg)$'));
alter table public.clubs drop constraint if exists clubs_cover_path_check;
alter table public.clubs add constraint clubs_cover_path_check
  check (cover_path is null or cover_path ~ ('^' || id::text || '/cover-[a-z0-9]{6,32}\.(webp|jpg)$'));
grant select (logo_path, cover_path, verified) on public.clubs to anon, authenticated;
grant update (logo_path, cover_path) on public.clubs to authenticated;

-- Klubo valdytojas: savininkas arba administratorius.
create or replace function public.is_club_admin(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.club_members where club_id = p_club and user_id = auth.uid() and role in ('owner', 'admin'));
$$;
create or replace function public.is_club_member(p_club uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.club_members where club_id = p_club and user_id = auth.uid());
$$;
grant execute on function public.is_club_admin(uuid) to authenticated;
grant execute on function public.is_club_member(uuid) to authenticated;

-- Klubo duomenis (pavadinimą, aprašymą, nuotraukas) keičia ir administratoriai; patvirtinimo – tik komanda.
drop policy if exists clubs_update on public.clubs;
create policy clubs_update on public.clubs for update to authenticated
  using ((select public.is_club_admin(id))) with check ((select public.is_club_admin(id)));

create or replace function public.clubs_verified_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('role', true), '') = 'authenticated' and new.verified is distinct from old.verified
     and not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  return new;
end;
$$;
revoke all on function public.clubs_verified_guard() from public, anon, authenticated;
drop trigger if exists clubs_verified_guard on public.clubs;
create trigger clubs_verified_guard before update on public.clubs for each row execute function public.clubs_verified_guard();

create or replace function public.set_club_verified(p_club uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid; v_name text;
begin
  if not public.has_perm('roles') then raise exception 'not allowed'; end if;
  update public.clubs set verified = p_on where id = p_club returning owner_id, name into v_owner, v_name;
  if v_owner is null then raise exception 'club not found'; end if;
  if p_on then
    perform public.notify_user(v_owner, 'announcement', 'Klubas patvirtintas', format('„%s“ dabar pažymėtas kaip patvirtintas klubas.', v_name),
      format('#/klubas/%s', p_club), format('clubok:%s', p_club));
  end if;
end;
$$;
revoke all on function public.set_club_verified(uuid, boolean) from public, anon;
grant execute on function public.set_club_verified(uuid, boolean) to authenticated;

create or replace function public.request_club_verification(p_club uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text; o record;
begin
  if not exists (select 1 from public.club_members where club_id = p_club and user_id = auth.uid() and role = 'owner') then
    raise exception 'not allowed';
  end if;
  select name into v_name from public.clubs where id = p_club;
  for o in select id from public.profiles where 'owner' = any (roles) loop
    perform public.notify_user(o.id, 'announcement', 'Prašymas patvirtinti klubą', format('„%s“ prašo patvirtinto klubo žymės.', v_name),
      format('#/klubas/%s', p_club), format('clubreq:%s:%s', p_club, to_char(now(), 'YYYYMMDD')));
  end loop;
end;
$$;
revoke all on function public.request_club_verification(uuid) from public, anon;
grant execute on function public.request_club_verification(uuid) to authenticated;

-- Administratorius skiria savininkas.
create or replace function public.set_club_admin(p_club uuid, p_user uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.club_members where club_id = p_club and user_id = auth.uid() and role = 'owner') then
    raise exception 'not allowed';
  end if;
  update public.club_members set role = case when p_on then 'admin' else 'member' end
   where club_id = p_club and user_id = p_user and role <> 'owner';
  if not found then raise exception 'member not found'; end if;
end;
$$;
revoke all on function public.set_club_admin(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_club_admin(uuid, uuid, boolean) to authenticated;

-- Narius šalinti gali ir administratoriai (ne savininką ir ne kitą administratorių).
drop policy if exists club_members_remove on public.club_members;
create policy club_members_remove on public.club_members for delete to authenticated
  using ((user_id = (select auth.uid()) and role <> 'owner')
         or (role = 'member' and (select public.is_club_admin(club_id)))
         or (role = 'admin' and exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = (select auth.uid()))));

-- Narys pats nusprendžia, ar jo laimikiai matomi klubo žemėlapyje.
create or replace function public.set_club_share_map(p_club uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.club_members set share_map = p_on where club_id = p_club and user_id = auth.uid();
  if not found then raise exception 'not allowed'; end if;
end;
$$;
revoke all on function public.set_club_share_map(uuid, boolean) from public, anon;
grant execute on function public.set_club_share_map(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- Prašymai prisijungti (uždaram klubui)
create table if not exists public.club_join_requests (
  club_id    uuid not null references public.clubs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  message    text check (message is null or char_length(message) <= 200),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);
alter table public.club_join_requests enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_join_requests' and policyname = 'club_join_requests_select') then
    create policy club_join_requests_select on public.club_join_requests for select to authenticated
      using (user_id = (select auth.uid()) or (select public.is_club_admin(club_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_join_requests' and policyname = 'club_join_requests_remove') then
    create policy club_join_requests_remove on public.club_join_requests for delete to authenticated
      using (user_id = (select auth.uid()) or (select public.is_club_admin(club_id)));
  end if;
end $$;
revoke all on public.club_join_requests from anon;
revoke insert, update on public.club_join_requests from authenticated;
grant select, delete on public.club_join_requests to authenticated;

create or replace function public.request_join_club(p_club uuid, p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare c record; v_nick text; a record;
begin
  if auth.uid() is null or public.is_banned() then raise exception 'not allowed'; end if;
  select * into c from public.clubs where id = p_club;
  if c.id is null then raise exception 'club not found'; end if;
  if c.open then raise exception 'club_open'; end if;
  if exists (select 1 from public.club_members where club_id = p_club and user_id = auth.uid()) then return; end if;
  insert into public.club_join_requests (club_id, user_id, message)
  values (p_club, auth.uid(), left(nullif(trim(coalesce(p_message, '')), ''), 200))
  on conflict (club_id, user_id) do update set message = excluded.message, created_at = now();
  select nickname into v_nick from public.profiles where id = auth.uid();
  for a in select user_id from public.club_members where club_id = p_club and role in ('owner', 'admin') loop
    perform public.notify_user(a.user_id, 'announcement', 'Prašymas prisijungti', format('%s nori prisijungti prie „%s“.', v_nick, c.name),
      format('#/klubas/%s?skiltis=nariai', p_club), format('joinreq:%s:%s', p_club, auth.uid()));
  end loop;
end;
$$;
revoke all on function public.request_join_club(uuid, text) from public, anon;
grant execute on function public.request_join_club(uuid, text) to authenticated;

create or replace function public.decide_join_club(p_club uuid, p_user uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_name text;
begin
  if not public.is_club_admin(p_club) then raise exception 'not allowed'; end if;
  delete from public.club_join_requests where club_id = p_club and user_id = p_user;
  if not found then raise exception 'request_not_found'; end if;
  select name into v_name from public.clubs where id = p_club;
  if p_approve then
    if (select count(*) from public.club_members where user_id = p_user) >= 10 then raise exception 'club_member_limit'; end if;
    insert into public.club_members (club_id, user_id) values (p_club, p_user) on conflict do nothing;
    perform public.notify_user(p_user, 'announcement', 'Priimtas į klubą', format('Sveikas prisijungęs prie „%s“!', v_name),
      format('#/klubas/%s', p_club), format('joinok:%s:%s', p_club, p_user));
  end if;
end;
$$;
revoke all on function public.decide_join_club(uuid, uuid, boolean) from public, anon;
grant execute on function public.decide_join_club(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- Klubo nuotraukos (logotipas, viršelis)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('club-images', 'club-images', true, 409600, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 409600, allowed_mime_types = array['image/webp', 'image/png', 'image/jpeg'];

create or replace function public.can_manage_club_image(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name ~ '^[0-9a-f-]{36}/(logo|cover)-[a-z0-9]{6,32}\.(webp|png|jpg)$'
     and public.is_club_admin(split_part(p_name, '/', 1)::uuid);
$$;
revoke all on function public.can_manage_club_image(text) from public, anon;
grant execute on function public.can_manage_club_image(text) to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'club_images_insert') then
    create policy club_images_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'club-images' and (select public.can_manage_club_image(name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'club_images_delete') then
    create policy club_images_delete on storage.objects for delete to authenticated
      using (bucket_id = 'club-images' and (select public.can_manage_club_image(name)));
  end if;
end $$;

-- ---------------------------------------------------------------- Pranešimai ir patarimai
create table if not exists public.club_posts (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind       text not null default 'post' check (kind in ('post', 'tip')),
  body       text not null check (char_length(trim(body)) between 2 and 500),
  created_at timestamptz not null default now()
);
create index if not exists club_posts_club_idx on public.club_posts (club_id, kind, created_at desc);
alter table public.club_posts enable row level security;

create table if not exists public.club_post_likes (
  post_id    uuid not null references public.club_posts (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.club_post_likes enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_posts' and policyname = 'club_posts_select') then
    create policy club_posts_select on public.club_posts for select to authenticated using ((select public.is_club_member(club_id)));
  end if;
  -- Pranešimus rašo valdytojai, patarimus – visi nariai.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_posts' and policyname = 'club_posts_insert') then
    create policy club_posts_insert on public.club_posts for insert to authenticated
      with check (author_id = (select auth.uid()) and not (select public.is_banned())
                  and ((kind = 'post' and (select public.is_club_admin(club_id))) or (kind = 'tip' and (select public.is_club_member(club_id)))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_posts' and policyname = 'club_posts_remove') then
    create policy club_posts_remove on public.club_posts for delete to authenticated
      using (author_id = (select auth.uid()) or (select public.is_club_admin(club_id)) or (select public.has_perm('review')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_post_likes' and policyname = 'club_post_likes_select') then
    create policy club_post_likes_select on public.club_post_likes for select to authenticated
      using (exists (select 1 from public.club_posts p where p.id = post_id and (select public.is_club_member(p.club_id))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_post_likes' and policyname = 'club_post_likes_insert') then
    create policy club_post_likes_insert on public.club_post_likes for insert to authenticated
      with check (user_id = (select auth.uid()) and exists (select 1 from public.club_posts p where p.id = post_id and (select public.is_club_member(p.club_id))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_post_likes' and policyname = 'club_post_likes_remove') then
    create policy club_post_likes_remove on public.club_post_likes for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.club_posts, public.club_post_likes from anon;
revoke update on public.club_posts, public.club_post_likes from authenticated;
grant select, insert, delete on public.club_posts, public.club_post_likes to authenticated;

create or replace function public.club_posts_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.feature_on(case new.kind when 'tip' then 'club_tips' else 'club_posts' end) then raise exception 'feature_off'; end if;
  new.body := trim(new.body);
  new.created_at := now();
  if (select count(*) from public.club_posts where author_id = new.author_id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'post_limit';
  end if;
  return new;
end;
$$;
create or replace function public.club_posts_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare m record; v_name text;
begin
  if new.kind <> 'post' then return new; end if;
  select name into v_name from public.clubs where id = new.club_id;
  for m in select user_id from public.club_members where club_id = new.club_id and user_id <> new.author_id loop
    perform public.notify_user(m.user_id, 'announcement', v_name, left(new.body, 140), format('#/klubas/%s', new.club_id), format('cpost:%s:%s', new.id, m.user_id));
  end loop;
  return new;
end;
$$;
revoke all on function public.club_posts_before_insert() from public, anon, authenticated;
revoke all on function public.club_posts_notify() from public, anon, authenticated;
drop trigger if exists club_posts_before_insert on public.club_posts;
create trigger club_posts_before_insert before insert on public.club_posts for each row execute function public.club_posts_before_insert();
drop trigger if exists club_posts_notify on public.club_posts;
create trigger club_posts_notify after insert on public.club_posts for each row execute function public.club_posts_notify();

-- ---------------------------------------------------------------- Išvykos
create table if not exists public.club_trips (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  starts_at  timestamptz not null,
  place      text not null check (char_length(trim(place)) between 2 and 80),
  notes      text check (notes is null or char_length(notes) <= 300),
  seats      smallint check (seats is null or seats between 0 and 8),
  created_at timestamptz not null default now()
);
create index if not exists club_trips_club_idx on public.club_trips (club_id, starts_at);
alter table public.club_trips enable row level security;

create table if not exists public.club_trip_rsvps (
  trip_id    uuid not null references public.club_trips (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  status     text not null check (status in ('going', 'maybe')),
  updated_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
alter table public.club_trip_rsvps enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_trips' and policyname = 'club_trips_select') then
    create policy club_trips_select on public.club_trips for select to authenticated using ((select public.is_club_member(club_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_trips' and policyname = 'club_trips_insert') then
    create policy club_trips_insert on public.club_trips for insert to authenticated
      with check (author_id = (select auth.uid()) and not (select public.is_banned()) and (select public.is_club_member(club_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_trips' and policyname = 'club_trips_remove') then
    create policy club_trips_remove on public.club_trips for delete to authenticated
      using (author_id = (select auth.uid()) or (select public.is_club_admin(club_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_trip_rsvps' and policyname = 'club_trip_rsvps_select') then
    create policy club_trip_rsvps_select on public.club_trip_rsvps for select to authenticated
      using (exists (select 1 from public.club_trips t where t.id = trip_id and (select public.is_club_member(t.club_id))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_trip_rsvps' and policyname = 'club_trip_rsvps_remove') then
    create policy club_trip_rsvps_remove on public.club_trip_rsvps for delete to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.club_trips, public.club_trip_rsvps from anon;
revoke update on public.club_trips from authenticated;
revoke insert, update on public.club_trip_rsvps from authenticated;
grant select, insert, delete on public.club_trips to authenticated;
grant select, delete on public.club_trip_rsvps to authenticated;

create or replace function public.club_trips_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not public.feature_on('club_trips') then raise exception 'feature_off'; end if;
  if new.starts_at < now() - interval '1 hour' or new.starts_at > now() + interval '120 days' then raise exception 'trip_time'; end if;
  new.place := trim(new.place);
  new.notes := nullif(trim(coalesce(new.notes, '')), '');
  new.created_at := now();
  if (select count(*) from public.club_trips where author_id = new.author_id and created_at > now() - interval '1 day') >= 5 then
    raise exception 'trip_limit';
  end if;
  return new;
end;
$$;
create or replace function public.club_trips_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare m record; v_name text; v_nick text;
begin
  select name into v_name from public.clubs where id = new.club_id;
  select nickname into v_nick from public.profiles where id = new.author_id;
  insert into public.club_trip_rsvps (trip_id, user_id, status) values (new.id, new.author_id, 'going') on conflict do nothing;
  for m in select user_id from public.club_members where club_id = new.club_id and user_id <> new.author_id loop
    perform public.notify_user(m.user_id, 'announcement', format('%s: nauja išvyka', v_name),
      format('%s kviečia: %s, %s', v_nick, new.place, to_char(new.starts_at at time zone 'Europe/Vilnius', 'MM-DD HH24:MI')),
      format('#/klubas/%s', new.club_id), format('ctrip:%s:%s', new.id, m.user_id));
  end loop;
  return new;
end;
$$;
revoke all on function public.club_trips_before_insert() from public, anon, authenticated;
revoke all on function public.club_trips_notify() from public, anon, authenticated;
drop trigger if exists club_trips_before_insert on public.club_trips;
create trigger club_trips_before_insert before insert on public.club_trips for each row execute function public.club_trips_before_insert();
drop trigger if exists club_trips_notify on public.club_trips;
create trigger club_trips_notify after insert on public.club_trips for each row execute function public.club_trips_notify();

create or replace function public.rsvp_trip(p_trip uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare t record;
begin
  select * into t from public.club_trips where id = p_trip;
  if t.id is null or not public.is_club_member(t.club_id) or public.is_banned() then raise exception 'not allowed'; end if;
  if p_status is null then
    delete from public.club_trip_rsvps where trip_id = p_trip and user_id = auth.uid();
    return;
  end if;
  if p_status not in ('going', 'maybe') then raise exception 'bad status'; end if;
  insert into public.club_trip_rsvps (trip_id, user_id, status) values (p_trip, auth.uid(), p_status)
  on conflict (trip_id, user_id) do update set status = excluded.status, updated_at = now();
end;
$$;
revoke all on function public.rsvp_trip(uuid, text) from public, anon;
grant execute on function public.rsvp_trip(uuid, text) to authenticated;

-- ---------------------------------------------------------------- Reakcijos ir komentarai prie laimikių
-- Matomi tiems, kurie dalijasi klubu su laimikio savininku (ir pačiam savininkui).
create or replace function public.shares_club_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user = auth.uid() or exists (
    select 1 from public.club_members a join public.club_members b on a.club_id = b.club_id
     where a.user_id = auth.uid() and b.user_id = p_user);
$$;
grant execute on function public.shares_club_with(uuid) to authenticated;

create table if not exists public.catch_reactions (
  catch_id   uuid not null references public.catches (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  emoji      text not null check (emoji in ('like', 'fire', 'hook')),
  created_at timestamptz not null default now(),
  primary key (catch_id, user_id, emoji)
);
create index if not exists catch_reactions_catch_idx on public.catch_reactions (catch_id);
alter table public.catch_reactions enable row level security;

create table if not exists public.catch_comments (
  id         uuid primary key default gen_random_uuid(),
  catch_id   uuid not null references public.catches (id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null check (char_length(trim(body)) between 1 and 300),
  reported   boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists catch_comments_catch_idx on public.catch_comments (catch_id, created_at);
create index if not exists catch_comments_reported_idx on public.catch_comments (created_at) where reported;
alter table public.catch_comments enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_reactions' and policyname = 'catch_reactions_select') then
    create policy catch_reactions_select on public.catch_reactions for select to authenticated
      using (exists (select 1 from public.catches c where c.id = catch_id and (select public.shares_club_with(c.user_id))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_reactions' and policyname = 'catch_reactions_insert') then
    create policy catch_reactions_insert on public.catch_reactions for insert to authenticated
      with check (user_id = (select auth.uid()) and not (select public.is_banned()) and (select public.feature_on('club_reactions'))
                  and exists (select 1 from public.catches c where c.id = catch_id and c.status = 'approved' and (select public.shares_club_with(c.user_id))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_reactions' and policyname = 'catch_reactions_remove') then
    create policy catch_reactions_remove on public.catch_reactions for delete to authenticated using (user_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_comments' and policyname = 'catch_comments_select') then
    create policy catch_comments_select on public.catch_comments for select to authenticated
      using ((select public.has_perm('review'))
             or exists (select 1 from public.catches c where c.id = catch_id and (select public.shares_club_with(c.user_id))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_comments' and policyname = 'catch_comments_insert') then
    create policy catch_comments_insert on public.catch_comments for insert to authenticated
      with check (user_id = (select auth.uid()) and not (select public.is_banned()) and (select public.feature_on('club_comments'))
                  and exists (select 1 from public.catches c where c.id = catch_id and c.status = 'approved' and (select public.shares_club_with(c.user_id))));
  end if;
  -- Ištrinti: autorius, laimikio savininkas arba moderatorius.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'catch_comments' and policyname = 'catch_comments_remove') then
    create policy catch_comments_remove on public.catch_comments for delete to authenticated
      using (user_id = (select auth.uid()) or (select public.has_perm('review'))
             or exists (select 1 from public.catches c where c.id = catch_id and c.user_id = (select auth.uid())));
  end if;
end $$;
revoke all on public.catch_reactions, public.catch_comments from anon;
revoke update on public.catch_reactions, public.catch_comments from authenticated;
grant select, insert, delete on public.catch_reactions to authenticated;
revoke insert on public.catch_comments from authenticated;
grant select, delete on public.catch_comments to authenticated;
grant insert (catch_id, body) on public.catch_comments to authenticated;

create or replace function public.catch_comments_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.body := trim(new.body);
  new.reported := false;
  new.created_at := now();
  if (select count(*) from public.catch_comments where user_id = new.user_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'comment_limit';
  end if;
  return new;
end;
$$;
create or replace function public.catch_comments_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_owner uuid; v_nick text;
begin
  select user_id into v_owner from public.catches where id = new.catch_id;
  if v_owner is not null and v_owner <> new.user_id then
    select nickname into v_nick from public.profiles where id = new.user_id;
    perform public.notify_user(v_owner, 'announcement', format('%s pakomentavo tavo laimikį', v_nick), left(new.body, 140),
      format('#/l/%s', new.catch_id), format('ccom:%s', new.id));
  end if;
  return new;
end;
$$;
revoke all on function public.catch_comments_before_insert() from public, anon, authenticated;
revoke all on function public.catch_comments_notify() from public, anon, authenticated;
drop trigger if exists catch_comments_before_insert on public.catch_comments;
create trigger catch_comments_before_insert before insert on public.catch_comments for each row execute function public.catch_comments_before_insert();
drop trigger if exists catch_comments_notify on public.catch_comments;
create trigger catch_comments_notify after insert on public.catch_comments for each row execute function public.catch_comments_notify();

create or replace function public.report_comment(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not allowed'; end if;
  update public.catch_comments cc set reported = true
   where cc.id = p_comment
     and exists (select 1 from public.catches c where c.id = cc.catch_id and public.shares_club_with(c.user_id));
  if not found then raise exception 'comment not found'; end if;
end;
$$;
revoke all on function public.report_comment(uuid) from public, anon;
grant execute on function public.report_comment(uuid) to authenticated;

create or replace function public.dismiss_comment_report(p_comment uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_perm('review') then raise exception 'not allowed'; end if;
  update public.catch_comments set reported = false where id = p_comment;
end;
$$;
revoke all on function public.dismiss_comment_report(uuid) from public, anon;
grant execute on function public.dismiss_comment_report(uuid) to authenticated;

-- ---------------------------------------------------------------- Rėmėjų nuolaidos nariams
create table if not exists public.club_perks (
  club_id      uuid primary key references public.clubs (id) on delete cascade,
  sponsor_name text not null check (char_length(trim(sponsor_name)) between 2 and 60),
  offer        text not null check (char_length(trim(offer)) between 2 and 120),
  code         text check (code is null or code ~ '^[A-Za-z0-9_-]{2,24}$'),
  url          text check (url is null or url ~ '^https://[^\s]{4,300}$'),
  updated_at   timestamptz not null default now()
);
alter table public.club_perks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_perks' and policyname = 'club_perks_select') then
    create policy club_perks_select on public.club_perks for select to authenticated using ((select public.is_club_member(club_id)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_perks' and policyname = 'club_perks_write') then
    create policy club_perks_write on public.club_perks for all to authenticated
      using ((select public.is_club_admin(club_id))) with check ((select public.is_club_admin(club_id)) and (select public.feature_on('club_perks')));
  end if;
end $$;
revoke all on public.club_perks from anon;
grant select, insert, update, delete on public.club_perks to authenticated;

-- ---------------------------------------------------------------- Mėnesio iššūkis, rekordai, reitingas, lyga
-- Iššūkio rūšis pagal mėnesį (0 – didžiausia bet kurios rūšies žuvis). Pavasarį ir vasarą – bet kuri rūšis,
-- kad nebūtų skatinama žvejoti plėšrūnų draudimų metu; rudenį ir žiemą – ešerys, starkis, lydeka.
create or replace function public.challenge_species(p_month date)
returns integer
language sql
immutable
as $$
  select (array[2, 2, 0, 0, 0, 0, 0, 0, 3, 1, 2, 1])[extract(month from p_month)::int];
$$;

create or replace function public.club_challenge(p_club uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_from timestamptz; v_to timestamptz; v_sp int; v_m date;
begin
  if not public.is_club_member(p_club) then raise exception 'not allowed'; end if;
  v_m := date_trunc('month', coalesce(p_month, (now() at time zone 'Europe/Vilnius')::date))::date;
  v_from := v_m::timestamp at time zone 'Europe/Vilnius';
  v_to := (v_m + interval '1 month')::timestamp at time zone 'Europe/Vilnius';
  v_sp := public.challenge_species(v_m);
  return jsonb_build_object('month', v_m, 'species_id', nullif(v_sp, 0), 'ends_at', v_to,
    'top', coalesce((select jsonb_agg(x order by x.len desc) from (
      select distinct on (c.user_id) c.user_id, p.nickname, c.length_mm as len, c.id as catch_id, c.species_id
        from public.catches c join public.club_members m on m.user_id = c.user_id and m.club_id = p_club
        join public.profiles p on p.id = c.user_id
       where c.status = 'approved' and c.captured_at_device >= v_from and c.captured_at_device < v_to
         and (v_sp = 0 or c.species_id = v_sp)
       order by c.user_id, c.length_mm desc) x), '[]'::jsonb));
end;
$$;
revoke all on function public.club_challenge(uuid, date) from public, anon;
grant execute on function public.club_challenge(uuid, date) to authenticated;

-- Sezono taškai: 10 geriausių patvirtintų laimikių ilgių suma centimetrais.
create or replace function public.season_points(p_user uuid, p_year int)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(round(sum(len) / 10.0)::int, 0) from (
    select length_mm as len from public.catches
     where user_id = p_user and status = 'approved' and extract(year from captured_at_device at time zone 'Europe/Vilnius') = p_year
     order by length_mm desc limit 10) t;
$$;
revoke all on function public.season_points(uuid, int) from public, anon, authenticated;

create or replace function public.club_records(p_club uuid, p_year int default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_year int := coalesce(p_year, extract(year from now() at time zone 'Europe/Vilnius')::int);
begin
  if not exists (select 1 from public.clubs where id = p_club) then raise exception 'club not found'; end if;
  return jsonb_build_object(
    'records', coalesce((select jsonb_agg(r order by r.len desc) from (
      select distinct on (c.species_id) c.species_id, c.length_mm as len, c.id as catch_id, c.user_id, p.nickname, c.captured_at_device as at
        from public.catches c join public.club_members m on m.user_id = c.user_id and m.club_id = p_club
        join public.profiles p on p.id = c.user_id
       where c.status = 'approved'
       order by c.species_id, c.length_mm desc, c.captured_at_device) r), '[]'::jsonb),
    'season', coalesce((select jsonb_agg(s order by s.points desc, s.catches desc) from (
      select m.user_id, p.nickname, public.season_points(m.user_id, v_year) as points,
             (select count(*) from public.catches c where c.user_id = m.user_id and c.status = 'approved'
                and extract(year from c.captured_at_device at time zone 'Europe/Vilnius') = v_year) as catches
        from public.club_members m join public.profiles p on p.id = m.user_id where m.club_id = p_club) s
      where s.points > 0), '[]'::jsonb),
    'year', v_year);
end;
$$;
revoke all on function public.club_records(uuid, int) from public, anon;
grant execute on function public.club_records(uuid, int) to anon, authenticated;

-- Klubų lyga: klubo taškai – 5 geriausių narių sezono taškų suma.
create or replace function public.club_league(p_year int default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with y as (select coalesce(p_year, extract(year from now() at time zone 'Europe/Vilnius')::int) as v),
  mp as (select m.club_id, public.season_points(m.user_id, (select v from y)) as pts from public.club_members m),
  ranked as (select club_id, pts, row_number() over (partition by club_id order by pts desc) as rn from mp where pts > 0)
  select coalesce(jsonb_agg(x order by x.points desc, x.members desc), '[]'::jsonb) from (
    select c.id, c.name, c.region, c.logo_path, c.verified,
           (select count(*) from public.club_members m where m.club_id = c.id) as members,
           coalesce((select sum(pts) from ranked r where r.club_id = c.id and r.rn <= 5), 0)::int as points
      from public.clubs c) x
   where x.points > 0;
$$;
revoke all on function public.club_league(int) from public, anon;
grant execute on function public.club_league(int) to anon, authenticated;

-- ---------------------------------------------------------------- Klubo žemėlapis (~1 km tikslumu)
create or replace function public.club_map(p_club uuid)
returns table (catch_id uuid, user_id uuid, nickname text, species_id integer, length_mm integer, captured_at timestamptz, lat double precision, lng double precision)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_club_member(p_club) or not public.feature_on('club_map') then raise exception 'not allowed'; end if;
  return query
    select c.id, c.user_id, p.nickname, c.species_id::integer, c.length_mm, c.captured_at_device,
           round(coalesce(l.lat, s.lat)::numeric, 2)::double precision, round(coalesce(l.lng, s.lng)::numeric, 2)::double precision
      from public.catches c
      join public.club_members m on m.user_id = c.user_id and m.club_id = p_club and m.share_map
      join public.profiles p on p.id = c.user_id
      left join public.catch_locations l on l.catch_id = c.id
      left join public.catch_spots s on s.catch_id = c.id
     where c.status = 'approved' and coalesce(l.lat, s.lat) is not null
     order by c.captured_at_device desc
     limit 500;
end;
$$;
revoke all on function public.club_map(uuid) from public, anon;
grant execute on function public.club_map(uuid) to authenticated;

notify pgrst, 'reload schema';
