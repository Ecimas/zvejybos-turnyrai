-- Asmeninės žinutės tarp žvejų (mygtukas „Rašyti“ žvejo profilyje).
--  * Pokalbio rūšis 'direct': du žvejai, be turnyro. Pora saugoma tvarkingai (mažesnis id – organizer_id),
--    todėl tarp dviejų žvejų visada vienas pokalbis.
--  * Rašyti gali bet kuris prisijungęs (neužblokuotas) žvejys; gavėjas gali užblokuoti pokalbį ir pranešti apie žinutę.
--  * Dažnio ribos: ne daugiau 15 naujų pokalbių per parą, žinučių – kaip visur (30 per 10 min.).
--  * Jungiklis „Asmeninės žinutės“ (direct_messages) admin puslapyje: išjungus – nauji pokalbiai ir žinutės negalimi.
-- Nieko netrinama: tik praplečiamos esamų lentelių taisyklės.

insert into public.app_features (key) values ('direct_messages') on conflict (key) do nothing;

alter table public.conversations add column if not exists started_by uuid references public.profiles (id) on delete set null;

-- Rūšių ir laukų taisyklės: 'direct' – be turnyro, su abiem žvejais.
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations drop constraint if exists conversations_check;
alter table public.conversations drop constraint if exists conversations_check1;
alter table public.conversations drop constraint if exists conversations_kind_ok;
alter table public.conversations drop constraint if exists conversations_org_ok;
alter table public.conversations drop constraint if exists conversations_tour_ok;
alter table public.conversations drop constraint if exists conversations_direct_ok;
alter table public.conversations add constraint conversations_kind_ok check (kind in ('org', 'system', 'support', 'direct'));
alter table public.conversations add constraint conversations_org_ok check ((kind in ('org', 'direct')) = (organizer_id is not null));
alter table public.conversations add constraint conversations_tour_ok check ((kind in ('support', 'direct')) = (tournament_id is null));
alter table public.conversations add constraint conversations_direct_ok check (kind <> 'direct' or organizer_id < participant_id);
create unique index if not exists conversations_direct_uniq on public.conversations (organizer_id, participant_id) where kind = 'direct';
create index if not exists conversations_started_idx on public.conversations (started_by, created_at desc) where kind = 'direct';

-- Pradėti (arba atidaryti esamą) pokalbį su žveju.
create or replace function public.start_direct(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  a uuid;
  b uuid;
  v_id uuid;
begin
  if me is null then raise exception 'not allowed'; end if;
  if not public.feature_on('direct_messages') then raise exception 'feature_off'; end if;
  if public.is_banned() then raise exception 'banned'; end if;
  if p_user is null or p_user = me
     or not exists (select 1 from public.profiles where id = p_user and deleting_at is null) then
    raise exception 'not allowed';
  end if;
  a := least(me, p_user);
  b := greatest(me, p_user);
  select id into v_id from public.conversations where kind = 'direct' and organizer_id = a and participant_id = b;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.conversations
       where kind = 'direct' and started_by = me and created_at > now() - interval '24 hours') >= 15 then
    raise exception 'dm_limit' using hint = 'Per parą galima pradėti ne daugiau 15 naujų pokalbių';
  end if;
  insert into public.conversations (kind, organizer_id, participant_id, started_by)
  values ('direct', a, b, me)
  on conflict (organizer_id, participant_id) where kind = 'direct' do nothing;
  select id into v_id from public.conversations where kind = 'direct' and organizer_id = a and participant_id = b;
  return v_id;
end;
$$;
revoke all on function public.start_direct(uuid) from public, anon;
grant execute on function public.start_direct(uuid) to authenticated;

-- Žinutės siuntimas: kaip anksčiau + asmeninėms – jungiklio patikra.
create or replace function public.send_message(p_conversation uuid, p_body text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  me uuid := auth.uid();
  v_body text := trim(coalesce(p_body, ''));
  v_id bigint;
  v_other uuid;
  v_nick text;
begin
  if me is null then raise exception 'not allowed'; end if;
  select * into c from public.conversations where id = p_conversation for update;
  if not found or (c.participant_id <> me and c.organizer_id is distinct from me
                   and not (c.kind = 'support' and public.has_perm('tournaments'))) then
    raise exception 'not allowed';
  end if;
  if c.kind = 'system' then raise exception 'read_only'; end if;
  if c.kind = 'direct' and not public.feature_on('direct_messages') then raise exception 'feature_off'; end if;
  if c.blocked_by is not null then raise exception 'blocked'; end if;
  if public.is_banned() then raise exception 'banned'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'body_invalid'; end if;
  if (select count(*) from public.messages where sender_id = me and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'rate_limit' using hint = 'Per daug žinučių – palauk kelias minutes';
  end if;
  insert into public.messages (conversation_id, sender_id, body) values (c.id, me, v_body) returning id into v_id;
  -- Pagalboje komandos pusė (organizer_id = null) skaitymą žymi org_read_at
  update public.conversations set last_message_at = now(),
         org_read_at = case when me = c.organizer_id or (c.kind = 'support' and me <> c.participant_id) then now() else org_read_at end,
         part_read_at = case when me = c.participant_id then now() else part_read_at end
   where id = c.id;
  select nickname into v_nick from public.profiles where id = me;
  if c.kind = 'support' then
    if me = c.participant_id then
      for v_other in select id from public.profiles where roles && array['owner', 'admin']::text[] and id <> me loop
        perform public.notify_user(v_other, 'announcement', format('Pagalba: žinutė nuo %s', coalesce(v_nick, 'žvejo')),
          left(v_body, 140), '#/zinutes/' || c.id, format('msg:%s:%s', v_id, v_other));
      end loop;
    else
      perform public.notify_user(c.participant_id, 'announcement', 'Atsakė Žvejybos turnyrų komanda',
        left(v_body, 140), '#/zinutes/' || c.id, format('msg:%s', v_id));
    end if;
    return v_id;
  end if;
  v_other := case when me = c.organizer_id then c.participant_id else c.organizer_id end;
  perform public.notify_user(v_other, 'announcement', format('Žinutė nuo %s', coalesce(v_nick, 'žvejo')),
    left(v_body, 140), '#/zinutes/' || c.id, format('msg:%s', v_id));
  return v_id;
end;
$$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

-- Blokuoti galima ir asmeninį pokalbį.
create or replace function public.block_conversation(p_conversation uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from public.conversations where id = p_conversation for update;
  if not found or c.kind not in ('org', 'direct') or (c.participant_id <> auth.uid() and c.organizer_id is distinct from auth.uid()) then
    raise exception 'not allowed';
  end if;
  if p_on then
    update public.conversations set blocked_by = auth.uid() where id = c.id and blocked_by is null;
  elsif c.blocked_by = auth.uid() then
    update public.conversations set blocked_by = null where id = c.id;
  end if;
end;
$$;
revoke all on function public.block_conversation(uuid, boolean) from public, anon;
grant execute on function public.block_conversation(uuid, boolean) to authenticated;

-- Mano pokalbiai: asmeniniuose „organizatoriaus pusės“ nėra (i_organize = false).
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
  select c.id, c.tournament_id, t.title, c.kind, c.side_org and c.kind <> 'direct',
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
   where (not c.side_org and c.kind <> 'direct')
      -- Organizatoriui, komandai ir asmeniniuose pokalbiuose rodomi tik pokalbiai, kuriuose jau yra žmonių žinučių, arba prizininkai
      or c.prize_place is not null or exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id is not null)
   order by c.last_message_at desc
   limit 200;
$$;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

notify pgrst, 'reload schema';
