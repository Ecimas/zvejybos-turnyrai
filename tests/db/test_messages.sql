-- 0036: vidinės žinutės ir turnyro pabaigos žinutės.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'M1. Turnyro pabaiga: rezultatai visiems, prizininkams – pokalbis su organizatoriumi'

insert into auth.users (id, email) values
  ('3e100000-0000-4000-8000-0000000000c1', 'msg-org@test.lt'),
  ('3e200000-0000-4000-8000-0000000000c2', 'msg-first@test.lt'),
  ('3e300000-0000-4000-8000-0000000000c3', 'msg-second@test.lt'),
  ('3e400000-0000-4000-8000-0000000000c4', 'msg-third@test.lt'),
  ('3e500000-0000-4000-8000-0000000000c5', 'msg-nofish@test.lt'),
  ('3e600000-0000-4000-8000-0000000000c6', 'msg-outsider@test.lt'),
  ('3e700000-0000-4000-8000-0000000000c7', 'msg-owner@test.lt');
update public.profiles set nickname = 'Msg_' || substr(id::text, 1, 3) where id::text like '3e_00000-%';
update public.profiles set roles = array['owner'] where id = '3e700000-0000-4000-8000-0000000000c7';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select id, 'https://push.test/' || id, repeat('x', 87), repeat('x', 22) from auth.users where id::text like '3e_00000-%';
create temp table mx (k text primary key, id uuid);
grant select on mx to authenticated, anon;

set session_replication_role = replica;
-- Baigėsi prieš valandą; fondas 300 € (60/40) – du prizininkai; trečias be prizo; vienas be žuvų.
with t as (insert into public.tournaments (organizer_id, title, format, top_n, starts_at, ends_at, invite_code, prize_fund_cents, prize_split, created_at)
           values ('3e100000-0000-4000-8000-0000000000c1', 'Žinučių taurė', 'biggest', 1, now() - interval '3 days', now() - interval '1 hour',
                   'msg0000001', 30000, '[60, 40]', now() - interval '4 days') returning id)
insert into mx select 'done', id from t;
-- Senas (baigėsi prieš 40 d.) – žinučių nebesiunčiam
with t as (insert into public.tournaments (organizer_id, title, format, top_n, starts_at, ends_at, invite_code, created_at)
           values ('3e100000-0000-4000-8000-0000000000c1', 'Sena taurė', 'biggest', 1, now() - interval '50 days', now() - interval '40 days',
                   'msg0000002', now() - interval '60 days') returning id)
insert into mx select 'old', id from t;
-- Vykstantis – su juo kalbamės
with t as (insert into public.tournaments (organizer_id, title, format, top_n, starts_at, ends_at, invite_code, created_at)
           values ('3e100000-0000-4000-8000-0000000000c1', 'Vykstanti taurė', 'biggest', 1, now() - interval '1 day', now() + interval '2 days',
                   'msg0000003', now() - interval '2 days') returning id)
insert into mx select 'live', id from t;
insert into public.entries (tournament_id, user_id, joined_at)
select (select id from mx where k = 'done'), u, now() - interval '3 days'
  from unnest(array['3e100000-0000-4000-8000-0000000000c1', '3e200000-0000-4000-8000-0000000000c2', '3e300000-0000-4000-8000-0000000000c3',
                    '3e400000-0000-4000-8000-0000000000c4', '3e500000-0000-4000-8000-0000000000c5']::uuid[]) u;
insert into public.entries (tournament_id, user_id, joined_at)
select (select id from mx where k = 'old'), '3e200000-0000-4000-8000-0000000000c2', now() - interval '50 days';
insert into public.entries (tournament_id, user_id, joined_at)
select (select id from mx where k = 'live'), u, now() - interval '1 day'
  from unnest(array['3e100000-0000-4000-8000-0000000000c1', '3e200000-0000-4000-8000-0000000000c2']::uuid[]) u;
insert into public.catches (user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
select u, gen_random_uuid(), 1, len, now() - interval '2 days', now() - interval '2 days', u || '/m' || len || '.jpg', md5(u::text || len) || md5(len::text), 'approved'
  from (values ('3e200000-0000-4000-8000-0000000000c2'::uuid, 900), ('3e300000-0000-4000-8000-0000000000c3'::uuid, 800),
               ('3e400000-0000-4000-8000-0000000000c4'::uuid, 700)) v(u, len);
set session_replication_role = origin;

do $$ declare n int; v uuid := (select id from mx where k = 'done'); begin
  assert (select array_agg(cents order by rank) from public.prize_payouts(v)) = array[18000, 12000], 'prizų sumos';
  n := public.finish_tournaments();  -- apdoroja ir kitų testų pasibaigusius turnyrus
  n := (select count(*) from public.messages m join public.conversations c on c.id = m.conversation_id where c.tournament_id = v and m.meta->>'event' = 'result');
  assert n = 5, format('rezultatų žinučių %s', n);
  assert (select results_sent_at is not null from public.tournaments where id = v), 'nepažymėta';
  assert (select results_sent_at is null from public.tournaments where id = (select id from mx where k = 'old')), 'senas turnyras apdorotas';
  -- Prizininkai – pokalbis su organizatoriumi, su terminu
  assert (select count(*) from public.conversations where tournament_id = v and kind = 'org' and prize_place is not null and deadline_at > now()) = 2, 'prizininkų pokalbiai';
  assert (select prize_cents from public.conversations where tournament_id = v and participant_id = '3e200000-0000-4000-8000-0000000000c2') = 18000, '1 vietos suma';
  assert exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
                  where c.participant_id = '3e300000-0000-4000-8000-0000000000c3' and m.sender_id is null
                    and m.body like 'Sveikiname! Užėmei 2 vietą%120 €%3 darbo dienas%' and (m.meta->>'place')::int = 2), '2 vietos žinutė';
  -- Kiti – sisteminis pokalbis
  assert exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
                  where c.participant_id = '3e400000-0000-4000-8000-0000000000c4' and c.kind = 'system' and m.body like '%Užėmei 3 vietą iš 5%'), '3 vieta';
  assert exists (select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
                  where c.participant_id = '3e500000-0000-4000-8000-0000000000c5' and c.kind = 'system' and m.body like '%įskaitytų laimikių neturėjai%'), 'be žuvų';
  assert exists (select 1 from public.notification_outbox where user_id = '3e200000-0000-4000-8000-0000000000c2' and dedupe like 'result:%' and title like 'Sveikiname%'), 'push prizininkui';
  assert exists (select 1 from public.notification_outbox where user_id = '3e100000-0000-4000-8000-0000000000c1' and dedupe = 'prizers:' || v), 'push organizatoriui';
  -- Antras paleidimas nieko nebesiunčia
  assert public.finish_tournaments() = 0, 'dubliuota';
end $$;

\echo 'M2. Skaitymas ir rašymas'
set role authenticated;
set request.jwt.claim.sub = '3e600000-0000-4000-8000-0000000000c6';
do $$ declare v uuid := (select id from mx where k = 'done'); c uuid; begin
  assert (select count(*) from public.conversations) = 0, 'pašalinis mato pokalbius';
  assert (select count(*) from public.messages) = 0, 'pašalinis mato žinutes';
  c := (select id from mx where k = 'done');
  begin perform public.start_conversation(v, '3e100000-0000-4000-8000-0000000000c1'); raise exception 'FAIL: pašalinis pradėjo pokalbį';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin insert into public.messages (conversation_id, body) values (gen_random_uuid(), 'x'); raise exception 'FAIL: tiesioginis įrašas';
  exception when insufficient_privilege then null; end;
end $$;
-- Prizininkas mato savo pokalbį ir gali atsakyti
set request.jwt.claim.sub = '3e200000-0000-4000-8000-0000000000c2';
do $$ declare c uuid; n bigint; r record; begin
  assert (select count(*) from public.conversations) = 1, 'prizininkas mato ne savo pokalbius';
  select * into r from public.my_conversations() limit 1;
  assert r.kind = 'org' and r.prize_place = 1 and r.other_nick like 'Msg_3e1%' and r.unread = 1 and r.last_system, format('mano pokalbiai %s', r);
  assert public.my_unread_count() = 1, 'neperskaityta';
  c := r.id;
  perform public.send_message(c, '  Ačiū! Kada galėčiau atsiimti?  ');
  assert (select body from public.messages where conversation_id = c order by id desc limit 1) = 'Ačiū! Kada galėčiau atsiimti?', 'tekstas neapkarpytas';
  assert public.my_unread_count() = 0, 'parašius – perskaityta';
  begin perform public.send_message(c, '   '); raise exception 'FAIL: tuščia žinutė';
  exception when raise_exception then if sqlerrm <> 'body_invalid' then raise; end if; end;
  begin perform public.send_message(c, repeat('x', 2001)); raise exception 'FAIL: per ilga';
  exception when raise_exception then if sqlerrm <> 'body_invalid' then raise; end if; end;
  begin perform public.set_prize_handed(c, true); raise exception 'FAIL: dalyvis pažymėjo įteikimą';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  -- Dalyvis gali parašyti vykstančio turnyro organizatoriui
  c := public.start_conversation((select id from mx where k = 'live'));
  assert c is not null and public.start_conversation((select id from mx where k = 'live')) = c, 'pokalbis dubliuojasi';
  perform public.send_message(c, 'Ar galima žvejoti iš valties?');
end $$;
-- Trečia vieta (sisteminis pokalbis) – atsakyti negalima, bet gali pradėti pokalbį su organizatoriumi
set request.jwt.claim.sub = '3e400000-0000-4000-8000-0000000000c4';
do $$ declare c uuid; begin
  c := (select id from public.conversations where kind = 'system');
  begin perform public.send_message(c, 'Labas'); raise exception 'FAIL: atsakyta į sisteminę';
  exception when raise_exception then if sqlerrm <> 'read_only' then raise; end if; end;
  begin perform public.start_conversation((select id from mx where k = 'done'), '3e200000-0000-4000-8000-0000000000c2'); raise exception 'FAIL: rašo kitam žvejui';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
-- Organizatorius: prizininkų būsena, atsakymas, įteikimas, rašymas dalyviui
set request.jwt.claim.sub = '3e100000-0000-4000-8000-0000000000c1';
do $$ declare v uuid := (select id from mx where k = 'done'); c uuid; r record; begin
  assert (select count(*) from public.tournament_prize_status(v)) = 2, 'prizininkų sąrašas';
  select * into r from public.tournament_prize_status(v) where prize_place = 1;
  assert not r.organizer_wrote and r.replied, format('būsena %s', r);
  assert (select count(*) from public.my_conversations() where tournament_id = v and i_organize) = 2, 'organizatoriui – tik prizininkai';
  assert (select count(*) from public.my_conversations()) = 4, format('organizatoriaus pokalbiai (2 prizininkai + klausimas + jo paties rezultatas): %s', (select count(*) from public.my_conversations()));
  assert (select unread from public.my_conversations() where id = r.conversation_id) = 1, 'organizatoriui sisteminė žinutė – ne neperskaityta';
  perform public.send_message(r.conversation_id, 'Sveikinu! Šeštadienį 10 val. prieplaukoje.');
  perform public.set_prize_handed(r.conversation_id, true);
  assert (select organizer_wrote and handed_at is not null from public.tournament_prize_status(v) where prize_place = 1), 'įteikta';
  c := public.start_conversation(v, '3e400000-0000-4000-8000-0000000000c4');
  perform public.send_message(c, 'Ačiū, kad dalyvavai!');
  begin perform public.start_conversation(v, '3e600000-0000-4000-8000-0000000000c6'); raise exception 'FAIL: rašo ne dalyviui';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.notification_outbox where user_id = '3e200000-0000-4000-8000-0000000000c2' and dedupe like 'msg:%' and body like 'Sveikinu!%'), 'push apie žinutę';
  assert exists (select 1 from public.notification_outbox where user_id = '3e100000-0000-4000-8000-0000000000c1' and dedupe like 'msg:%' and body like 'Ar galima%'), 'push organizatoriui';
  assert exists (select 1 from public.notification_outbox where user_id = '3e200000-0000-4000-8000-0000000000c2' and dedupe like 'handed:%'), 'push apie įteikimą';
end $$;

\echo 'M3. Blokavimas, pranešimai, dažnio riba, priminimai'
set role authenticated;
set request.jwt.claim.sub = '3e300000-0000-4000-8000-0000000000c3';
do $$ declare c uuid := (select id from public.conversations where kind = 'org'); i int; begin
  perform public.send_message(c, 'Sveiki');
  perform public.block_conversation(c, true);
  begin perform public.send_message(c, 'dar'); raise exception 'FAIL: rašo užblokavęs';
  exception when raise_exception then if sqlerrm <> 'blocked' then raise; end if; end;
  perform public.block_conversation(c, false);
  for i in 1..29 loop perform public.send_message(c, 'žinutė ' || i); end loop;
  begin perform public.send_message(c, 'per daug'); raise exception 'FAIL: dažnio riba';
  exception when raise_exception then if sqlerrm <> 'rate_limit' then raise; end if; end;
end $$;
set request.jwt.claim.sub = '3e100000-0000-4000-8000-0000000000c1';
do $$ declare c uuid := (select id from public.conversations where participant_id = '3e300000-0000-4000-8000-0000000000c3' and kind = 'org');
  mid bigint := (select id from public.messages where body = 'Sveiki'); begin
  perform public.block_conversation(c, true);
  begin perform public.send_message(c, 'x'); raise exception 'FAIL: rašo užblokuotas';
  exception when raise_exception then if sqlerrm <> 'blocked' then raise; end if; end;
  perform public.block_conversation(c, false);
  perform public.report_message(mid, 'Įžeidinėja');
  begin perform public.report_message((select id from public.messages where sender_id = auth.uid() limit 1), 'savo'); raise exception 'FAIL: pranešė apie savo';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  assert (select count(*) from public.reported_messages()) = 0, 'organizatorius mato pranešimus';
end $$;
set request.jwt.claim.sub = '3e700000-0000-4000-8000-0000000000c7';
do $$ declare r record; begin
  select * into r from public.reported_messages() limit 1;
  assert r.body = 'Sveiki' and r.reason = 'Įžeidinėja' and r.resolved_at is null, format('pranešimas %s', r);
  perform public.resolve_message_report(r.report_id);
  assert (select resolved_at is not null from public.reported_messages() limit 1), 'neišspręsta';
  assert (select count(*) from public.conversations) = 0, 'savininkas mato svetimus pokalbius';
end $$;
reset role;
do $$ declare n int; begin
  assert exists (select 1 from public.notification_outbox where user_id = '3e700000-0000-4000-8000-0000000000c7' and dedupe like 'msgrep:%'), 'savininkas negavo pranešimo';
  -- Priminimas: 2 vietai organizatorius neparašė, terminas praėjo
  update public.conversations set deadline_at = now() - interval '1 minute' where participant_id = '3e300000-0000-4000-8000-0000000000c3' and kind = 'org';
  n := public.finish_tournaments();
  assert exists (select 1 from public.notification_outbox where user_id = '3e100000-0000-4000-8000-0000000000c1' and dedupe like 'remind:%'), 'organizatorius negavo priminimo';
  assert exists (select 1 from public.notification_outbox where user_id = '3e700000-0000-4000-8000-0000000000c7' and dedupe like 'remind-owner:%'), 'savininkas negavo priminimo';
  assert (select count(*) from public.conversations where reminded_at is not null) = 1, 'priminta ne tiems';
  assert public.add_business_days('2026-11-06 12:00+02'::timestamptz, 3) = '2026-11-11 12:00+02'::timestamptz, 'darbo dienos (penktadienis + 3 = trečiadienis)';
  assert public.eur_text(12050) = '120,50 €' and public.eur_text(30000) = '300 €', 'eurai';
end $$;
set role anon;
do $$ begin
  begin perform public.my_conversations(); raise exception 'FAIL: anonimas';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.messages; raise exception 'FAIL: anonimas mato žinutes';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.sub;
\echo '   ok – žinutės'
