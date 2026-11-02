-- 0037: Žinutės suskirstytos į „Svarbu“, „Žmonės“, „Klubai“.
--  * user_notices: kiekvienas programėlės pranešimas (laimikis patvirtintas, aplenkė, taisyklės pakeistos…) išsaugomas
--    ir rodomas skiltyje „Svarbu“ – net jei telefonas pranešimų negauna. Pokalbių žinutės čia nepatenka.
--  * Klubų bendri pokalbiai: rašo visi nariai; valdytojai prisega, trina, nutildo; reakcijos 👍 🔥 🎣; laimikio kortelė;
--    pranešimas į telefoną – ne dažniau kaip kartą per 15 min. vienam klubui; jungiklis „club_chat“.

-- ---------------------------------------------------------------- Pranešimų centras („Svarbu“)
create table if not exists public.user_notices (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       text not null,
  title      text not null check (char_length(title) <= 120),
  body       text not null check (char_length(body) <= 300),
  url        text not null default '#/',
  dedupe     text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists user_notices_user_idx on public.user_notices (user_id, created_at desc);
alter table public.user_notices enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'user_notices' and policyname = 'user_notices_select') then
    create policy user_notices_select on public.user_notices for select to authenticated using (user_id = (select auth.uid()));
  end if;
end $$;
revoke all on public.user_notices from anon;
revoke insert, update, delete on public.user_notices from authenticated;
grant select on public.user_notices to authenticated;

create table if not exists public.notice_reads (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  seen_at timestamptz not null default now()
);
alter table public.notice_reads enable row level security;
revoke all on public.notice_reads from anon, authenticated;

-- Kiekvienas pranešimas išsaugomas pranešimų centre (be pokalbių žinučių – jos pokalbiuose),
-- o į telefoną siunčiamas, kaip ir anksčiau, tik jei įjungti pranešimai.
create or replace function public.notify_user(p_user uuid, p_kind text, p_title text, p_body text, p_url text, p_dedupe text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null then
    return false;
  end if;
  if p_kind <> 'test' and p_dedupe !~ '^(msg|cmsg|result|handed):' then
    insert into public.user_notices (user_id, kind, title, body, url, dedupe)
    values (p_user, p_kind, left(p_title, 120), left(p_body, 300), coalesce(p_url, '#/'), p_dedupe)
    on conflict (dedupe) do nothing;
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = p_user and gone_at is null) then
    return false;
  end if;
  if exists (select 1 from public.notification_settings s
              where s.user_id = p_user
                and case p_kind when 'review' then not s.review when 'overtaken' then not s.overtaken
                                when 'start' then not s.start when 'announcement' then not s.announcements else false end) then
    return false;
  end if;
  insert into public.notification_outbox (user_id, kind, title, body, url, dedupe)
  values (p_user, p_kind, left(p_title, 120), left(p_body, 300), coalesce(p_url, '#/'), p_dedupe)
  on conflict (dedupe) do nothing;
  return found;
end;
$$;

create or replace function public.my_notices()
returns table (id bigint, kind text, title text, body text, url text, created_at timestamptz, unread boolean)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.kind, n.title, n.body, n.url, n.created_at,
         n.created_at > coalesce((select r.seen_at from public.notice_reads r where r.user_id = auth.uid()), '-infinity'::timestamptz)
    from public.user_notices n
   where n.user_id = auth.uid() and n.created_at > now() - interval '90 days'
   order by n.created_at desc
   limit 80;
$$;
revoke all on function public.my_notices() from public, anon;
grant execute on function public.my_notices() to authenticated;

create or replace function public.mark_notices_seen()
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notice_reads (user_id, seen_at) values (auth.uid(), now())
  on conflict (user_id) do update set seen_at = now();
$$;
revoke all on function public.mark_notices_seen() from public, anon;
grant execute on function public.mark_notices_seen() to authenticated;

-- ---------------------------------------------------------------- Klubų pokalbiai
insert into public.app_features (key) values ('club_chat') on conflict (key) do nothing;

create table if not exists public.club_messages (
  id         bigint generated always as identity primary key,
  club_id    uuid not null references public.clubs (id) on delete cascade,
  sender_id  uuid references public.profiles (id) on delete set null,
  body       text check (body is null or char_length(body) between 1 and 2000),
  catch      jsonb,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (body is not null or catch is not null or deleted_at is not null)
);
create index if not exists club_messages_club_idx on public.club_messages (club_id, created_at desc);
create index if not exists club_messages_sender_idx on public.club_messages (sender_id, created_at desc) where sender_id is not null;

create table if not exists public.club_message_reactions (
  message_id bigint not null references public.club_messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null check (emoji in ('👍', '🔥', '🎣')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create table if not exists public.club_chat_state (
  club_id      uuid not null references public.clubs (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  read_at      timestamptz,
  push         boolean not null default true,
  last_push_at timestamptz,
  muted_until  timestamptz,
  primary key (club_id, user_id)
);

create table if not exists public.club_message_reports (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references public.club_messages (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text check (reason is null or char_length(reason) <= 300),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, reporter_id)
);

alter table public.clubs add column if not exists chat_pin_id bigint references public.club_messages (id) on delete set null;

alter table public.club_messages enable row level security;
alter table public.club_message_reactions enable row level security;
alter table public.club_chat_state enable row level security;
alter table public.club_message_reports enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'club_messages' and policyname = 'club_messages_select') then
    create policy club_messages_select on public.club_messages for select to authenticated using ((select public.is_club_member(club_id)));
  end if;
end $$;
revoke all on public.club_messages, public.club_message_reactions, public.club_chat_state, public.club_message_reports from anon;
revoke insert, update, delete on public.club_messages from authenticated;
revoke all on public.club_message_reactions, public.club_chat_state, public.club_message_reports from authenticated;
grant select on public.club_messages to authenticated;

-- Pokalbio žinutės (naujausios 200, nuo seniausios): autorius, jo rolė klube, reakcijos.
create or replace function public.club_chat_messages(p_club uuid)
returns table (id bigint, sender_id uuid, nickname text, role text, body text, catch jsonb, deleted boolean, created_at timestamptz,
               reactions jsonb, mine text[])
language sql
stable
security definer
set search_path = public
as $$
  select x.id, x.sender_id, p.nickname, cm.role, case when x.deleted_at is null then x.body end, case when x.deleted_at is null then x.catch end,
         x.deleted_at is not null, x.created_at,
         coalesce((select jsonb_object_agg(r.emoji, r.n) from (select emoji, count(*) n from public.club_message_reactions where message_id = x.id group by emoji) r), '{}'::jsonb),
         coalesce((select array_agg(emoji) from public.club_message_reactions where message_id = x.id and user_id = auth.uid()), '{}'::text[])
    from (select * from public.club_messages m where m.club_id = p_club order by m.created_at desc, m.id desc limit 200) x
    left join public.profiles p on p.id = x.sender_id
    left join public.club_members cm on cm.club_id = p_club and cm.user_id = x.sender_id
   where public.is_club_member(p_club)
   order by x.created_at, x.id;
$$;
revoke all on function public.club_chat_messages(uuid) from public, anon;
grant execute on function public.club_chat_messages(uuid) to authenticated;

-- Mano klubų pokalbiai: paskutinė žinutė ir neperskaitytos.
create or replace function public.my_club_chats()
returns table (club_id uuid, name text, logo_path text, members bigint, my_role text, push boolean, muted_until timestamptz,
               last_at timestamptz, last_body text, last_nick text, last_mine boolean, unread bigint, pin_body text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.name, c.logo_path, (select count(*) from public.club_members x where x.club_id = c.id), cm.role,
         coalesce(st.push, true), st.muted_until,
         coalesce(lm.created_at, cm.joined_at), lm.txt, lm.nickname, lm.sender_id = auth.uid(),
         (select count(*) from public.club_messages m
           where m.club_id = c.id and m.deleted_at is null and m.sender_id is distinct from auth.uid()
             and m.created_at > greatest(coalesce(st.read_at, '-infinity'::timestamptz), cm.joined_at)),
         (select coalesce(pm.body, '🐟 laimikis') from public.club_messages pm where pm.id = c.chat_pin_id and pm.deleted_at is null)
    from public.club_members cm
    join public.clubs c on c.id = cm.club_id
    left join public.club_chat_state st on st.club_id = c.id and st.user_id = auth.uid()
    left join lateral (select m.created_at, m.sender_id, p.nickname,
                              case when m.deleted_at is not null then 'Žinutė ištrinta' when m.body is not null then m.body else '🐟 Pasidalino laimikiu' end as txt
                         from public.club_messages m left join public.profiles p on p.id = m.sender_id
                        where m.club_id = c.id order by m.created_at desc, m.id desc limit 1) lm on true
   where cm.user_id = auth.uid()
   order by coalesce(lm.created_at, cm.joined_at) desc;
$$;
revoke all on function public.my_club_chats() from public, anon;
grant execute on function public.my_club_chats() to authenticated;

create or replace function public.club_chat_send(p_club uuid, p_body text, p_catch uuid default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_catch jsonb;
  v_id bigint;
  v_club text;
  v_nick text;
  u record;
begin
  if me is null or not public.is_club_member(p_club) then raise exception 'not allowed'; end if;
  if not public.feature_on('club_chat') then raise exception 'feature_off'; end if;
  if public.is_banned() then raise exception 'banned'; end if;
  if exists (select 1 from public.club_chat_state where club_id = p_club and user_id = me and muted_until > now()) then
    raise exception 'muted';
  end if;
  if v_body is not null and char_length(v_body) > 2000 then raise exception 'body_invalid'; end if;
  if p_catch is not null then
    select jsonb_build_object('id', c.id, 'species_id', c.species_id, 'length_mm', c.length_mm, 'weight_g', c.weight_g,
                              'captured_at', c.captured_at_device, 'status', c.status)
      into v_catch from public.catches c where c.id = p_catch and c.user_id = me and c.status <> 'rejected';
    if v_catch is null then raise exception 'catch_invalid'; end if;
  end if;
  if v_body is null and v_catch is null then raise exception 'body_invalid'; end if;
  if (select count(*) from public.club_messages where sender_id = me and created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'rate_limit';
  end if;
  insert into public.club_messages (club_id, sender_id, body, catch) values (p_club, me, v_body, v_catch) returning id into v_id;
  insert into public.club_chat_state (club_id, user_id, read_at) values (p_club, me, now())
  on conflict (club_id, user_id) do update set read_at = now();
  select name into v_club from public.clubs where id = p_club;
  select nickname into v_nick from public.profiles where id = me;
  -- Pranešimas į telefoną: ne dažniau kaip kartą per 15 min. vienam klubui (kitaip aktyvus pokalbis erzintų)
  for u in select cm.user_id from public.club_members cm
            left join public.club_chat_state st on st.club_id = cm.club_id and st.user_id = cm.user_id
           where cm.club_id = p_club and cm.user_id <> me
             and coalesce(st.push, true)
             and (st.last_push_at is null or st.last_push_at < now() - interval '15 minutes') loop
    if public.notify_user(u.user_id, 'announcement', v_club, format('%s: %s', coalesce(v_nick, 'Narys'), coalesce(left(v_body, 120), 'pasidalino laimikiu 🐟')),
         '#/klubas/' || p_club || '/pokalbis', format('cmsg:%s:%s', v_id, u.user_id)) then
      insert into public.club_chat_state (club_id, user_id, last_push_at) values (p_club, u.user_id, now())
      on conflict (club_id, user_id) do update set last_push_at = now();
    end if;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.club_chat_send(uuid, text, uuid) from public, anon;
grant execute on function public.club_chat_send(uuid, text, uuid) to authenticated;

create or replace function public.club_chat_read(p_club uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_club_member(p_club) then return; end if;
  insert into public.club_chat_state (club_id, user_id, read_at) values (p_club, auth.uid(), now())
  on conflict (club_id, user_id) do update set read_at = now();
end;
$$;
revoke all on function public.club_chat_read(uuid) from public, anon;
grant execute on function public.club_chat_read(uuid) to authenticated;

create or replace function public.club_chat_set_push(p_club uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_club_member(p_club) then raise exception 'not allowed'; end if;
  insert into public.club_chat_state (club_id, user_id, push) values (p_club, auth.uid(), p_on)
  on conflict (club_id, user_id) do update set push = p_on;
end;
$$;
revoke all on function public.club_chat_set_push(uuid, boolean) from public, anon;
grant execute on function public.club_chat_set_push(uuid, boolean) to authenticated;

create or replace function public.club_chat_react(p_message bigint, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club uuid;
begin
  select club_id into v_club from public.club_messages where id = p_message and deleted_at is null;
  if v_club is null or not public.is_club_member(v_club) then raise exception 'not allowed'; end if;
  if p_emoji not in ('👍', '🔥', '🎣') then raise exception 'emoji_invalid'; end if;
  delete from public.club_message_reactions where message_id = p_message and user_id = auth.uid() and emoji = p_emoji;
  if found then return false; end if;
  insert into public.club_message_reactions (message_id, user_id, emoji) values (p_message, auth.uid(), p_emoji);
  return true;
end;
$$;
revoke all on function public.club_chat_react(bigint, text) from public, anon;
grant execute on function public.club_chat_react(bigint, text) to authenticated;

-- Ištrinti: autorius arba klubo valdytojas.
create or replace function public.club_chat_delete(p_message bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
begin
  select * into m from public.club_messages where id = p_message for update;
  if not found or (m.sender_id is distinct from auth.uid() and not public.is_club_admin(m.club_id)) then
    raise exception 'not allowed';
  end if;
  update public.club_messages set body = null, catch = null, deleted_at = now(), deleted_by = auth.uid() where id = m.id and deleted_at is null;
  update public.clubs set chat_pin_id = null where id = m.club_id and chat_pin_id = m.id;
end;
$$;
revoke all on function public.club_chat_delete(bigint) from public, anon;
grant execute on function public.club_chat_delete(bigint) to authenticated;

-- Prisegti (arba nuimti – p_message null): tik valdytojai.
create or replace function public.club_chat_pin(p_club uuid, p_message bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_club_admin(p_club) then raise exception 'not allowed'; end if;
  if p_message is not null and not exists (select 1 from public.club_messages where id = p_message and club_id = p_club and deleted_at is null) then
    raise exception 'not_found';
  end if;
  update public.clubs set chat_pin_id = p_message where id = p_club;
end;
$$;
revoke all on function public.club_chat_pin(uuid, bigint) from public, anon;
grant execute on function public.club_chat_pin(uuid, bigint) to authenticated;

-- Nutildyti narį (valandomis; 0 – atšaukti). Klubo savininko nutildyti negalima.
create or replace function public.club_chat_mute(p_club uuid, p_user uuid, p_hours integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_club_admin(p_club) or p_user = auth.uid() then raise exception 'not allowed'; end if;
  if exists (select 1 from public.club_members where club_id = p_club and user_id = p_user and role = 'owner') then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.club_members where club_id = p_club and user_id = p_user) then raise exception 'not_found'; end if;
  if p_hours < 0 or p_hours > 24 * 30 then raise exception 'hours_invalid'; end if;
  insert into public.club_chat_state (club_id, user_id, muted_until)
  values (p_club, p_user, case when p_hours = 0 then null else now() + make_interval(hours => p_hours) end)
  on conflict (club_id, user_id) do update set muted_until = excluded.muted_until;
  if p_hours > 0 then
    perform public.notify_user(p_user, 'announcement', 'Klubo pokalbyje nutildytas',
      format('Klubo „%s“ valdytojas nutildė tave pokalbyje %s val.', (select name from public.clubs where id = p_club), p_hours),
      '#/klubas/' || p_club, format('cmute:%s:%s:%s', p_club, p_user, floor(extract(epoch from now()))::bigint));
  end if;
end;
$$;
revoke all on function public.club_chat_mute(uuid, uuid, integer) from public, anon;
grant execute on function public.club_chat_mute(uuid, uuid, integer) to authenticated;

-- Pranešti apie žinutę: valdytojams; jei pranešė 3 ar daugiau narių – ir savininkui (programėlės).
create or replace function public.club_chat_report(p_message bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  a record;
  n integer;
begin
  select cm.*, c.name into m from public.club_messages cm join public.clubs c on c.id = cm.club_id where cm.id = p_message;
  if not found or not public.is_club_member(m.club_id) or m.sender_id is null or m.sender_id = auth.uid() or m.deleted_at is not null then
    raise exception 'not allowed';
  end if;
  insert into public.club_message_reports (message_id, reporter_id, reason)
  values (p_message, auth.uid(), left(nullif(trim(coalesce(p_reason, '')), ''), 300))
  on conflict (message_id, reporter_id) do nothing;
  for a in select user_id from public.club_members where club_id = m.club_id and role in ('owner', 'admin') and user_id <> auth.uid() loop
    perform public.notify_user(a.user_id, 'announcement', 'Pranešimas apie klubo žinutę',
      format('„%s“: %s', m.name, left(coalesce(m.body, 'laimikio kortelė'), 100)), '#/klubas/' || m.club_id || '/pokalbis',
      format('crep:%s:%s', p_message, a.user_id));
  end loop;
  select count(*) into n from public.club_message_reports where message_id = p_message;
  if n >= 3 then
    for a in select id from public.profiles where 'owner' = any (roles) loop
      perform public.notify_user(a.id, 'announcement', 'Klubo žinutė – daug pranešimų',
        format('„%s“: %s narių pranešė apie žinutę: %s', m.name, n, left(coalesce(m.body, ''), 80)), '#/klubas/' || m.club_id || '/pokalbis',
        format('crep3:%s:%s', p_message, a.id));
    end loop;
  end if;
end;
$$;
revoke all on function public.club_chat_report(bigint, text) from public, anon;
grant execute on function public.club_chat_report(bigint, text) to authenticated;

-- ---------------------------------------------------------------- Pokalbiai: ar pašnekovas jau parašė (prizo eigai „Svarbu“ skiltyje)
drop function if exists public.my_conversations();
create or replace function public.my_conversations()
returns table (id uuid, tournament_id uuid, tournament_title text, kind text, i_organize boolean, other_id uuid, other_nick text,
               prize_place integer, prize_cents integer, handed_at timestamptz, deadline_at timestamptz, blocked boolean, blocked_by_me boolean,
               last_message_at timestamptz, last_body text, last_mine boolean, last_system boolean, unread bigint, other_wrote boolean)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select c.*, coalesce(c.organizer_id = auth.uid(), false) or (c.kind = 'support' and c.participant_id <> auth.uid()) as side_org
      from public.conversations c
     where c.participant_id = auth.uid() or c.organizer_id = auth.uid()
        or (c.kind = 'support' and public.has_perm('tournaments'))
  )
  select c.id, c.tournament_id, t.title, c.kind, c.side_org,
         case when c.side_org then c.participant_id else c.organizer_id end,
         p.nickname, c.prize_place, c.prize_cents, c.handed_at, c.deadline_at, c.blocked_by is not null, c.blocked_by = auth.uid(),
         c.last_message_at, lm.body, lm.sender_id = auth.uid(), lm.sender_id is null,
         (select count(*) from public.messages m
           where m.conversation_id = c.id
             and m.created_at > coalesce(case when c.side_org then c.org_read_at else c.part_read_at end, '-infinity'::timestamptz)
             and case when c.side_org then m.sender_id = c.participant_id
                      when c.kind = 'support' then m.sender_id is distinct from auth.uid()
                      else m.sender_id is distinct from auth.uid() end),
         exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id is not null
                   and m.sender_id = case when c.side_org then c.participant_id else c.organizer_id end)
    from mine c
    left join public.tournaments t on t.id = c.tournament_id
    left join public.profiles p on p.id = case when c.side_org then c.participant_id else c.organizer_id end
    left join lateral (select m.body, m.sender_id from public.messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) lm on true
   where not c.side_org
      -- Organizatoriui ir komandai rodomi tik pokalbiai, kuriuose jau yra žmonių žinučių, arba prizininkai
      or c.prize_place is not null or exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id is not null)
   order by c.last_message_at desc
   limit 200;
$$;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

-- ---------------------------------------------------------------- Bendras neperskaitytų skaičius (viršutinė juosta)
create or replace function public.my_unread_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select sum(x.unread) from public.my_conversations() x), 0)::bigint
       + coalesce((select count(*) from public.my_notices() n where n.unread), 0)::bigint
       + coalesce((select sum(c.unread) from public.my_club_chats() c), 0)::bigint;
$$;
revoke all on function public.my_unread_count() from public, anon;
grant execute on function public.my_unread_count() to authenticated;

-- Seni pranešimai (po 90 d.) ištrinami kasdien.
create or replace function public.purge_old_notices()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.user_notices where created_at < now() - interval '90 days';
$$;
revoke all on function public.purge_old_notices() from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('purge-old-notices', '25 3 * * *', 'select public.purge_old_notices()');
  end if;
end;
$$;

notify pgrst, 'reload schema';
