-- 0036: Vidinės žinutės (organizatorius ↔ dalyviai) ir turnyro pabaigos žinutės.
--  * Pokalbis: vienas turnyro organizatoriaus ir vieno dalyvio (kind = 'org'). Žvejai tarpusavyje nerašo.
--  * Sisteminis pokalbis (kind = 'system'): automatinė rezultato žinutė dalyviui, į ją atsakyti negalima.
--  * Turnyrui pasibaigus visi dalyviai gauna rezultatą; prizininkai – pokalbyje su organizatoriumi su žinia,
--    kad organizatorius susisieks per 3 darbo dienas. Nesusisiekus – priminimas organizatoriui ir savininkui.
--  * Rašoma tik per serverio funkcijas (tikrinamos teisės, blokavimas, užblokuoti vartotojai, dažnio riba).

-- ---------------------------------------------------------------- Lentelės
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references public.tournaments (id) on delete cascade,
  kind            text not null check (kind in ('org', 'system')),
  organizer_id    uuid references public.profiles (id) on delete cascade,
  participant_id  uuid not null references public.profiles (id) on delete cascade,
  prize_place     integer,
  prize_cents     integer,
  deadline_at     timestamptz,
  reminded_at     timestamptz,
  handed_at       timestamptz,
  org_read_at     timestamptz,
  part_read_at    timestamptz,
  blocked_by      uuid references public.profiles (id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  unique (tournament_id, participant_id, kind),
  check ((kind = 'org') = (organizer_id is not null))
);
create index if not exists conversations_participant_idx on public.conversations (participant_id, last_message_at desc);
create index if not exists conversations_organizer_idx on public.conversations (organizer_id, last_message_at desc) where organizer_id is not null;
create index if not exists conversations_deadline_idx on public.conversations (deadline_at) where deadline_at is not null and reminded_at is null;

create table if not exists public.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid references public.profiles (id) on delete set null, -- null = automatinė žinutė
  body            text not null check (char_length(body) between 1 and 2000),
  meta            jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc) where sender_id is not null;

create table if not exists public.message_reports (
  id          bigint generated always as identity primary key,
  message_id  bigint not null references public.messages (id) on delete cascade,
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  reason      text check (reason is null or char_length(reason) <= 300),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, reporter_id)
);

alter table public.tournaments add column if not exists results_sent_at timestamptz;
-- Jau pasibaigusiems turnyrams rezultatų žinučių nesiunčiam (kad nepasipiltų sena informacija).
update public.tournaments set results_sent_at = now() where ends_at <= now() and results_sent_at is null;

-- ---------------------------------------------------------------- Teisės (skaitymas – tik pokalbio dalyviams)
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_reports enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'conversations' and policyname = 'conversations_select') then
    create policy conversations_select on public.conversations for select to authenticated
      using (participant_id = (select auth.uid()) or organizer_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages' and policyname = 'messages_select') then
    create policy messages_select on public.messages for select to authenticated
      using (exists (select 1 from public.conversations c where c.id = conversation_id
                      and (c.participant_id = (select auth.uid()) or c.organizer_id = (select auth.uid()))));
  end if;
end $$;
revoke all on public.conversations, public.messages, public.message_reports from anon;
revoke insert, update, delete on public.conversations, public.messages, public.message_reports from authenticated;
grant select on public.conversations, public.messages to authenticated;

-- ---------------------------------------------------------------- Pagalbinės
create or replace function public.eur_text(p_cents integer)
returns text
language sql
immutable
as $$
  select case when p_cents % 100 = 0 then (p_cents / 100)::text
              else replace(to_char(p_cents / 100.0, 'FM999999990.00'), '.', ',') end || ' €';
$$;

-- Po n darbo dienų (šeštadieniai ir sekmadieniai neskaičiuojami).
create or replace function public.add_business_days(p_from timestamptz, p_days integer)
returns timestamptz
language plpgsql
immutable
as $$
declare
  d timestamptz := p_from;
  n integer := 0;
begin
  while n < p_days loop
    d := d + interval '1 day';
    if extract(isodow from d at time zone 'Europe/Vilnius') < 6 then
      n := n + 1;
    end if;
  end loop;
  return d;
end;
$$;

-- Kiek kiekvienai vietai: kaip programėlėje (prizes.js payouts): lygiosios dalijasi užimtų vietų sumas.
create or replace function public.prize_payouts(p_tournament uuid)
returns table (user_id uuid, rank bigint, cents integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t record;
  amounts integer[] := '{}';
  rows_ uuid[];
  ranks bigint[];
  i integer;
  j integer;
  k integer;
  pool integer;
  each_ integer;
  total integer := 0;
  pct numeric;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found or coalesce(t.prize_fund_cents, 0) <= 0 or t.prize_split is null then
    return;
  end if;
  for pct in select value::numeric from jsonb_array_elements_text(t.prize_split) loop
    amounts := amounts || floor(t.prize_fund_cents * pct / 100)::integer;
    total := total + floor(t.prize_fund_cents * pct / 100)::integer;
  end loop;
  if array_length(amounts, 1) is null then
    return;
  end if;
  amounts[1] := amounts[1] + (t.prize_fund_cents - total);
  select array_agg(l.user_id order by l.rank, l.nickname), array_agg(l.rank order by l.rank, l.nickname)
    into rows_, ranks
    from public.leaderboard_all(p_tournament) l where l.rank is not null;
  if rows_ is null then
    return;
  end if;
  i := 1;
  while i <= array_length(rows_, 1) and i <= array_length(amounts, 1) loop
    j := i;
    while j <= array_length(rows_, 1) and ranks[j] = ranks[i] loop
      j := j + 1;
    end loop;
    pool := 0;
    for k in i .. least(j - 1, array_length(amounts, 1)) loop
      pool := pool + amounts[k];
    end loop;
    each_ := floor(pool / (j - i));
    for k in i .. j - 1 loop
      user_id := rows_[k];
      rank := ranks[k];
      cents := each_ + case when k = i then pool - each_ * (j - i) else 0 end;
      return next;
    end loop;
    i := j;
  end loop;
end;
$$;
revoke all on function public.prize_payouts(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- Pokalbiai
create or replace function public.start_conversation(p_tournament uuid, p_user uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  me uuid := auth.uid();
  v_part uuid;
  v_id uuid;
begin
  if me is null then raise exception 'not allowed'; end if;
  if public.is_banned() then raise exception 'banned'; end if;
  select * into t from public.tournaments where id = p_tournament;
  if not found then raise exception 'not_found'; end if;
  if me = t.organizer_id then
    if p_user is null or p_user = me or not exists (select 1 from public.entries where tournament_id = t.id and user_id = p_user) then
      raise exception 'not allowed';
    end if;
    v_part := p_user;
  elsif exists (select 1 from public.entries where tournament_id = t.id and user_id = me)
        and (p_user is null or p_user = t.organizer_id) then
    v_part := me;
  else
    raise exception 'not allowed';
  end if;
  insert into public.conversations (tournament_id, kind, organizer_id, participant_id)
  values (t.id, 'org', t.organizer_id, v_part)
  on conflict (tournament_id, participant_id, kind) do nothing;
  select id into v_id from public.conversations where tournament_id = t.id and participant_id = v_part and kind = 'org';
  return v_id;
end;
$$;
revoke all on function public.start_conversation(uuid, uuid) from public, anon;
grant execute on function public.start_conversation(uuid, uuid) to authenticated;

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
  if not found or (c.participant_id <> me and c.organizer_id is distinct from me) then
    raise exception 'not allowed';
  end if;
  if c.kind <> 'org' then raise exception 'read_only'; end if;
  if c.blocked_by is not null then raise exception 'blocked'; end if;
  if public.is_banned() then raise exception 'banned'; end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then raise exception 'body_invalid'; end if;
  if (select count(*) from public.messages where sender_id = me and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'rate_limit' using hint = 'Per daug žinučių – palauk kelias minutes';
  end if;
  insert into public.messages (conversation_id, sender_id, body) values (c.id, me, v_body) returning id into v_id;
  update public.conversations set last_message_at = now(),
         org_read_at = case when me = c.organizer_id then now() else org_read_at end,
         part_read_at = case when me = c.participant_id then now() else part_read_at end
   where id = c.id;
  v_other := case when me = c.organizer_id then c.participant_id else c.organizer_id end;
  select nickname into v_nick from public.profiles where id = me;
  perform public.notify_user(v_other, 'announcement', format('Žinutė nuo %s', coalesce(v_nick, 'žvejo')),
    left(v_body, 140), '#/zinutes/' || c.id, format('msg:%s', v_id));
  return v_id;
end;
$$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.conversations
     set org_read_at = case when organizer_id = auth.uid() then now() else org_read_at end,
         part_read_at = case when participant_id = auth.uid() then now() else part_read_at end
   where id = p_conversation and (participant_id = auth.uid() or organizer_id = auth.uid());
$$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Mano pokalbiai su paskutine žinute ir neperskaitytų skaičiumi.
create or replace function public.my_conversations()
returns table (id uuid, tournament_id uuid, tournament_title text, kind text, i_organize boolean, other_id uuid, other_nick text,
               prize_place integer, prize_cents integer, handed_at timestamptz, deadline_at timestamptz, blocked boolean, blocked_by_me boolean,
               last_message_at timestamptz, last_body text, last_mine boolean, last_system boolean, unread bigint)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.tournament_id, t.title, c.kind, c.organizer_id = auth.uid(),
         case when c.organizer_id = auth.uid() then c.participant_id else c.organizer_id end,
         p.nickname, c.prize_place, c.prize_cents, c.handed_at, c.deadline_at, c.blocked_by is not null, c.blocked_by = auth.uid(),
         c.last_message_at, lm.body, lm.sender_id = auth.uid(), lm.sender_id is null,
         (select count(*) from public.messages m
           where m.conversation_id = c.id and m.sender_id is distinct from auth.uid()
             and m.created_at > coalesce(case when c.organizer_id = auth.uid() then c.org_read_at else c.part_read_at end, '-infinity'::timestamptz)
             and not (c.organizer_id = auth.uid() and m.sender_id is null))
    from public.conversations c
    join public.tournaments t on t.id = c.tournament_id
    left join public.profiles p on p.id = case when c.organizer_id = auth.uid() then c.participant_id else c.organizer_id end
    left join lateral (select m.body, m.sender_id from public.messages m where m.conversation_id = c.id order by m.created_at desc, m.id desc limit 1) lm on true
   where (c.participant_id = auth.uid() or c.organizer_id = auth.uid())
     -- Organizatoriui rodomi tik pokalbiai, kuriuose jau yra žmonių žinučių arba prizininkai
     and (c.participant_id = auth.uid() or c.prize_place is not null or exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id is not null))
   order by c.last_message_at desc
   limit 200;
$$;
revoke all on function public.my_conversations() from public, anon;
grant execute on function public.my_conversations() to authenticated;

create or replace function public.my_unread_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(x.unread), 0)::bigint from public.my_conversations() x;
$$;
revoke all on function public.my_unread_count() from public, anon;
grant execute on function public.my_unread_count() to authenticated;

-- Organizatorius pažymi, kad prizas įteiktas (arba atšaukia žymę).
create or replace function public.set_prize_handed(p_conversation uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from public.conversations where id = p_conversation for update;
  if not found or c.organizer_id is distinct from auth.uid() or c.prize_place is null then
    raise exception 'not allowed';
  end if;
  if p_on and c.handed_at is null then
    update public.conversations set handed_at = now(), last_message_at = now() where id = c.id;
    insert into public.messages (conversation_id, sender_id, body, meta)
    values (c.id, null, 'Organizatorius pažymėjo, kad prizas įteiktas.', jsonb_build_object('event', 'handed'));
    perform public.notify_user(c.participant_id, 'announcement', 'Prizas įteiktas',
      'Organizatorius pažymėjo, kad prizas įteiktas.', '#/zinutes/' || c.id, format('handed:%s', c.id));
  elsif not p_on then
    update public.conversations set handed_at = null where id = c.id;
  end if;
end;
$$;
revoke all on function public.set_prize_handed(uuid, boolean) from public, anon;
grant execute on function public.set_prize_handed(uuid, boolean) to authenticated;

-- Prizininkų būsena organizatoriui (ir administratoriui).
create or replace function public.tournament_prize_status(p_tournament uuid)
returns table (participant_id uuid, nickname text, prize_place integer, prize_cents integer, conversation_id uuid,
               organizer_wrote boolean, replied boolean, handed_at timestamptz, deadline_at timestamptz, reminded_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.participant_id, p.nickname, c.prize_place, c.prize_cents, c.id,
         exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = c.organizer_id),
         exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = c.participant_id),
         c.handed_at, c.deadline_at, c.reminded_at
    from public.conversations c
    join public.profiles p on p.id = c.participant_id
   where c.tournament_id = p_tournament and c.kind = 'org' and c.prize_place is not null
     and public.can_manage_tournament(p_tournament)
   order by c.prize_place, p.nickname;
$$;
revoke all on function public.tournament_prize_status(uuid) from public, anon;
grant execute on function public.tournament_prize_status(uuid) to authenticated;

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
  if not found or (c.participant_id <> auth.uid() and c.organizer_id is distinct from auth.uid()) then
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

-- Pranešti apie netinkamą žinutę: įrašas ir pranešimas savininkui (ištrauka – tik pranešime).
create or replace function public.report_message(p_message bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m record;
  o record;
begin
  select m2.*, c.participant_id, c.organizer_id into m
    from public.messages m2 join public.conversations c on c.id = m2.conversation_id where m2.id = p_message;
  if not found or (m.participant_id <> auth.uid() and m.organizer_id is distinct from auth.uid())
     or m.sender_id is null or m.sender_id = auth.uid() then
    raise exception 'not allowed';
  end if;
  insert into public.message_reports (message_id, reporter_id, reason)
  values (p_message, auth.uid(), left(nullif(trim(coalesce(p_reason, '')), ''), 300))
  on conflict (message_id, reporter_id) do nothing;
  for o in select id from public.profiles where 'owner' = any (roles) loop
    perform public.notify_user(o.id, 'announcement', 'Pranešimas apie žinutę',
      format('Žvejys pranešė apie žinutę: „%s“', left(m.body, 100)), '#/moderavimas/zinutes', format('msgrep:%s:%s', p_message, o.id));
  end loop;
end;
$$;
revoke all on function public.report_message(bigint, text) from public, anon;
grant execute on function public.report_message(bigint, text) to authenticated;

-- Savininkui ir administratoriams (teisė 'ban'): žinutės, apie kurias pranešta.
create or replace function public.reported_messages()
returns table (report_id bigint, message_id bigint, body text, sender_id uuid, sender_nick text, reporter_nick text, reason text,
               tournament_title text, created_at timestamptz, resolved_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, m.id, m.body, m.sender_id, ps.nickname, pr.nickname, r.reason, t.title, r.created_at, r.resolved_at
    from public.message_reports r
    join public.messages m on m.id = r.message_id
    join public.conversations c on c.id = m.conversation_id
    join public.tournaments t on t.id = c.tournament_id
    left join public.profiles ps on ps.id = m.sender_id
    left join public.profiles pr on pr.id = r.reporter_id
   where public.has_perm('ban')
   order by r.resolved_at nulls first, r.created_at desc
   limit 100;
$$;
revoke all on function public.reported_messages() from public, anon;
grant execute on function public.reported_messages() to authenticated;

create or replace function public.resolve_message_report(p_report bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_perm('ban') then raise exception 'not allowed'; end if;
  update public.message_reports set resolved_at = now() where id = p_report and resolved_at is null;
end;
$$;
revoke all on function public.resolve_message_report(bigint) from public, anon;
grant execute on function public.resolve_message_report(bigint) to authenticated;

-- ---------------------------------------------------------------- Turnyro pabaiga: rezultatų žinutės ir priminimai
create or replace function public.finish_tournaments()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  e record;
  o record;
  n integer := 0;
  v_total integer;
  v_items boolean;
  v_prize boolean;
  v_cents integer;
  v_conv uuid;
  v_body text;
  v_deadline timestamptz;
  v_prizers integer;
begin
  for t in select * from public.tournaments
            where results_sent_at is null and ends_at <= now() and ends_at > now() - interval '30 days'
            order by ends_at limit 20 for update skip locked loop
    v_total := (select count(*) from public.entries where tournament_id = t.id);
    v_items := coalesce(t.prize_fund_cents, 0) <= 0 and nullif(trim(coalesce(t.prizes, '')), '') is not null;
    v_deadline := public.add_business_days(now(), 3);
    v_prizers := 0;
    for e in select en.user_id, l.rank, l.score_mm, l.counted, pp.cents
               from public.entries en
               left join public.leaderboard_all(t.id) l on l.user_id = en.user_id
               left join public.prize_payouts(t.id) pp on pp.user_id = en.user_id
              where en.tournament_id = t.id loop
      v_cents := coalesce(e.cents, 0);
      v_prize := v_cents > 0 or (v_items and e.rank is not null and e.rank <= 3);
      if v_prize then
        v_body := format('Sveikiname! Užėmei %s vietą turnyre „%s“%s.', e.rank, t.title,
                         case when v_cents > 0 then ' – prizas ' || public.eur_text(v_cents) else ' – laimėjai prizą' end);
      elsif e.rank is not null then
        v_body := format('Turnyras „%s“ baigėsi. Užėmei %s vietą iš %s. Ačiū, kad dalyvavai!', t.title, e.rank, v_total);
      else
        v_body := format('Turnyras „%s“ baigėsi. Šį kartą įskaitytų laimikių neturėjai – sėkmės kitą kartą!', t.title);
      end if;
      if v_prize and e.user_id <> t.organizer_id then
        v_prizers := v_prizers + 1;
        insert into public.conversations (tournament_id, kind, organizer_id, participant_id, prize_place, prize_cents, deadline_at, last_message_at)
        values (t.id, 'org', t.organizer_id, e.user_id, e.rank, nullif(v_cents, 0), v_deadline, now())
        on conflict (tournament_id, participant_id, kind) do update
          set prize_place = excluded.prize_place, prize_cents = excluded.prize_cents, deadline_at = excluded.deadline_at, last_message_at = now()
        returning id into v_conv;
        v_body := v_body || ' Organizatorius su tavimi susisieks per 3 darbo dienas čia, programėlės žinutėse.';
      else
        insert into public.conversations (tournament_id, kind, organizer_id, participant_id, prize_place, prize_cents, last_message_at)
        values (t.id, 'system', null, e.user_id, case when v_prize then e.rank end, nullif(v_cents, 0), now())
        on conflict (tournament_id, participant_id, kind) do update set last_message_at = now()
        returning id into v_conv;
      end if;
      insert into public.messages (conversation_id, sender_id, body, meta)
      values (v_conv, null, v_body, jsonb_build_object('event', 'result', 'place', e.rank, 'total', v_total, 'score_mm', e.score_mm,
                                                       'counted', e.counted, 'prize', v_prize, 'prize_cents', nullif(v_cents, 0)));
      perform public.notify_user(e.user_id, 'announcement',
        case when v_prize then 'Sveikiname – laimėjai prizą!' else 'Turnyras baigėsi' end,
        v_body, '#/zinutes/' || v_conv, format('result:%s:%s', t.id, e.user_id));
      n := n + 1;
    end loop;
    if v_prizers > 0 then
      perform public.notify_user(t.organizer_id, 'announcement', 'Turnyras baigėsi – susisiek su prizininkais',
        format('„%s“: %s prizininkams išsiųsta žinutė. Susisiek su jais per 3 darbo dienas.', t.title, v_prizers),
        '#/t/' || t.id || '/redaguoti', format('prizers:%s', t.id));
    end if;
    update public.tournaments set results_sent_at = now() where id = t.id;
  end loop;

  -- Priminimai: organizatorius per 3 darbo dienas neparašė prizininkui
  for e in select c.id, c.tournament_id, c.organizer_id, c.prize_place, p.nickname, tt.title
             from public.conversations c
             join public.profiles p on p.id = c.participant_id
             join public.tournaments tt on tt.id = c.tournament_id
            where c.kind = 'org' and c.prize_place is not null and c.deadline_at < now() and c.reminded_at is null and c.handed_at is null
              and not exists (select 1 from public.messages m where m.conversation_id = c.id and m.sender_id = c.organizer_id) loop
    perform public.notify_user(e.organizer_id, 'announcement', 'Primename: susisiek su prizininku',
      format('%s (%s vieta, „%s“) laukia tavo žinutės.', e.nickname, e.prize_place, e.title), '#/zinutes/' || e.id, format('remind:%s', e.id));
    for o in select id from public.profiles where 'owner' = any (roles) and id <> e.organizer_id loop
      perform public.notify_user(o.id, 'announcement', 'Organizatorius nesusisiekė su prizininku',
        format('„%s“: %s (%s vieta) per 3 darbo dienas negavo žinutės.', e.title, e.nickname, e.prize_place),
        '#/t/' || e.tournament_id, format('remind-owner:%s:%s', e.id, o.id));
    end loop;
    update public.conversations set reminded_at = now() where id = e.id;
  end loop;
  return n;
end;
$$;
revoke all on function public.finish_tournaments() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('finish-tournaments', '*/5 * * * *', 'select public.finish_tournaments()');
  end if;
end;
$$;

notify pgrst, 'reload schema';
