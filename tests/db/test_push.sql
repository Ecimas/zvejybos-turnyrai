-- 0015: push pranešimų eilė.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'P1. Prenumeratos ir teisės'

insert into auth.users (id, email) values
  ('f1000000-0000-4000-8000-0000000000f1', 'push-p@test.lt'),
  ('f2000000-0000-4000-8000-0000000000f2', 'push-q@test.lt'),
  ('f3000000-0000-4000-8000-0000000000f3', 'push-r@test.lt'),
  ('f4000000-0000-4000-8000-0000000000f4', 'push-org@test.lt'),
  ('f5000000-0000-4000-8000-0000000000f5', 'push-mod@test.lt');
update public.profiles set nickname = v.n
  from (values ('f1000000-0000-4000-8000-0000000000f1'::uuid, 'Push_P'), ('f2000000-0000-4000-8000-0000000000f2', 'Push_Q'),
               ('f3000000-0000-4000-8000-0000000000f3', 'Push_R'), ('f4000000-0000-4000-8000-0000000000f4', 'Push_Org'),
               ('f5000000-0000-4000-8000-0000000000f5', 'Push_Mod')) v(id, n)
 where profiles.id = v.id;
update public.profiles set roles = array['moderator'] where id = 'f5000000-0000-4000-8000-0000000000f5';

create temp table px2 (k text primary key, id uuid);
grant select on px2 to authenticated, anon;

set role authenticated;
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-0000000000f1';
select public.save_push_subscription('https://push.example.com/p1', repeat('P', 87), repeat('a', 22));
set request.jwt.claim.sub = 'f2000000-0000-4000-8000-0000000000f2';
select public.save_push_subscription('https://push.example.com/q1', repeat('Q', 87), repeat('b', 22));
set request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000f4';
select public.save_push_subscription('https://push.example.com/o1', repeat('O', 87), repeat('c', 22));
do $$ begin
  assert (select count(*) from public.push_subscriptions) = 1, 'mato svetimas prenumeratas';
  begin
    perform count(*) from public.notification_outbox;
    raise exception 'FAIL: mato pranešimų eilę';
  exception when insufficient_privilege then null; end;
  begin
    perform public.push_claim(10);
    raise exception 'FAIL: vartotojas paėmė eilę';
  exception when insufficient_privilege then null; end;
  begin
    perform public.notify_user(auth.uid(), 'test', 'x', 'y', '#/', 'hack');
    raise exception 'FAIL: vartotojas įdėjo pranešimą tiesiogiai';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), 'https://x.lt/1', repeat('x', 87), repeat('x', 22));
    raise exception 'FAIL: tiesioginis įrašas į prenumeratas';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_push_subscription('http://nesaugus.lt/x', repeat('x', 87), repeat('x', 22));
    raise exception 'FAIL: priimta ne https prenumerata';
  exception when check_violation then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.save_push_subscription('https://push.example.com/anon', repeat('A', 87), repeat('a', 22));
    raise exception 'FAIL: anon išsaugojo prenumeratą';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo '   ok'
\echo 'P2. Patvirtinta / atmesta ir „Tave aplenkė“'

-- Vykstantis turnyras, P, Q, R užsiregistravę iki starto
set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code)
           values ('f4000000-0000-4000-8000-0000000000f4', 'Pranešimų taurė', 'biggest', now() - interval '1 day', now() + interval '1 day', 'push000001') returning id)
insert into px2 select 'tour', id from t;
insert into public.entries (tournament_id, user_id, joined_at)
  select id, u, now() - interval '2 days' from px2, unnest(array['f1000000-0000-4000-8000-0000000000f1', 'f2000000-0000-4000-8000-0000000000f2',
                                                                  'f3000000-0000-4000-8000-0000000000f3']::uuid[]) u
   where k = 'tour';
set session_replication_role = origin;

set request.jwt.claim.sub = 'f2000000-0000-4000-8000-0000000000f2';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 800, now() - interval '3 hours', 'f2000000-0000-4000-8000-0000000000f2/q.jpg', repeat('7a', 32)) returning id)
insert into px2 select 'q_catch', id from c;
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-0000000000f1';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 925, now() - interval '2 hours', 'f1000000-0000-4000-8000-0000000000f1/p.jpg', repeat('7b', 32)) returning id)
insert into px2 select 'p_catch', id from c;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 600, now() - interval '1 hour', 'f1000000-0000-4000-8000-0000000000f1/p2.jpg', repeat('7c', 32)) returning id)
insert into px2 select 'p_bad', id from c;
set request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000f3';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 700, now() - interval '2 hours', 'f3000000-0000-4000-8000-0000000000f3/r.jpg', repeat('7d', 32)) returning id)
insert into px2 select 'r_catch', id from c;

set role authenticated;
set request.jwt.claim.sub = 'f5000000-0000-4000-8000-0000000000f5';
select public.review_catch(id, true, null) from px2 where k = 'q_catch';   -- Q #1
select public.review_catch(id, true, null) from px2 where k = 'r_catch';   -- R #2 (be prenumeratos)
select public.review_catch(id, true, null) from px2 where k = 'p_catch';   -- P aplenkia Q ir R
select public.review_catch(id, false, 'Nesimato liniuotės') from px2 where k = 'p_bad';
reset role;

do $$
declare v record;
begin
  assert (select count(*) from public.notification_outbox where user_id = 'f3000000-0000-4000-8000-0000000000f3') = 0,
    'pranešimai be prenumeratos';
  select * into v from public.notification_outbox where kind = 'review' and dedupe like 'review:' || (select id from px2 where k = 'p_catch') || ':%';
  assert v.user_id = 'f1000000-0000-4000-8000-0000000000f1' and v.title = 'Laimikis patvirtintas', 'nėra patvirtinimo pranešimo';
  assert v.body like 'Lydeka 92,5 cm%', format('blogas tekstas: %s', v.body);
  assert v.url = '#/l/' || (select id from px2 where k = 'p_catch'), 'bloga nuoroda';
  select * into v from public.notification_outbox where dedupe = 'review:' || (select id from px2 where k = 'p_bad') || ':rejected';
  assert v.title = 'Laimikis atmestas' and v.body like '%Priežastis: Nesimato liniuotės', format('atmetimas: %s', v.body);
  select * into v from public.notification_outbox where kind = 'overtaken';
  assert v.user_id = 'f2000000-0000-4000-8000-0000000000f2', 'aplenktas turi būti Q';
  assert v.title = 'Tave aplenkė Push_P', format('pavadinimas: %s', v.title);
  assert v.body like 'Dabar esi #2 turnyre „Pranešimų taurė“%', format('tekstas: %s', v.body);
  assert (select count(*) from public.notification_outbox where kind = 'overtaken') = 1, 'per daug „aplenkė“ pranešimų';
  assert (select rank from public.tournament_ranks where user_id = 'f1000000-0000-4000-8000-0000000000f1') = 1, 'vietos neišsaugotos';
end $$;

-- Pakartotinis patvirtinimas nedubliuoja; paslėptoje lentelėje „aplenkė“ nesiunčiama
set role authenticated;
set request.jwt.claim.sub = 'f5000000-0000-4000-8000-0000000000f5';
select public.review_catch(id, true, null) from px2 where k = 'p_catch';
reset role;
update public.tournaments set leaderboard_hidden = true where id = (select id from px2 where k = 'tour');
set request.jwt.claim.sub = 'f2000000-0000-4000-8000-0000000000f2';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 990, now() - interval '30 minutes', 'f2000000-0000-4000-8000-0000000000f2/q2.jpg', repeat('7e', 32)) returning id)
insert into px2 select 'q_big', id from c;
set role authenticated;
set request.jwt.claim.sub = 'f5000000-0000-4000-8000-0000000000f5';
select public.review_catch(id, true, null) from px2 where k = 'q_big';
reset role;
do $$ begin
  assert (select count(*) from public.notification_outbox where dedupe like 'review:' || (select id from px2 where k = 'p_catch') || ':%') = 1, 'dublis';
  assert (select count(*) from public.notification_outbox where kind = 'overtaken') = 1, 'paslėptoje lentelėje išsiųsta „aplenkė“';
  assert (select rank from public.tournament_ranks where user_id = 'f2000000-0000-4000-8000-0000000000f2') = 1, 'vietos neatnaujintos';
end $$;
update public.tournaments set leaderboard_hidden = false where id = (select id from px2 where k = 'tour');

-- Išjungtas „aplenkė“ – nesiunčiama
set role authenticated;
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-0000000000f1';
insert into public.notification_settings (overtaken) values (false);
do $$ begin
  assert (select count(*) from public.notification_settings) = 1;
end $$;
reset role;
do $$ begin
  assert not public.notify_user('f1000000-0000-4000-8000-0000000000f1', 'overtaken', 'x', 'y', '#/', 'off-test'), 'siunčia išjungtą rūšį';
  assert public.notify_user('f1000000-0000-4000-8000-0000000000f1', 'review', 'x', 'y', '#/', 'on-test'), 'nesiunčia įjungtos rūšies';
  assert not public.notify_user('f1000000-0000-4000-8000-0000000000f1', 'review', 'x', 'y', '#/', 'on-test'), 'dedupe neveikia';
end $$;

\echo '   ok'
\echo 'P3. Organizatoriaus pranešimas, „rytoj startas“, bandomasis'

set role authenticated;
set request.jwt.claim.sub = 'f4000000-0000-4000-8000-0000000000f4';
insert into public.tournament_announcements (tournament_id, message) select id, 'Startas perkeltas į 6 val.' from px2 where k = 'tour';
reset role;
do $$ begin
  assert (select count(*) from public.notification_outbox where kind = 'announcement') = 2, 'pranešimas turi būti P ir Q';
  assert not exists (select 1 from public.notification_outbox where kind = 'announcement' and user_id = 'f4000000-0000-4000-8000-0000000000f4'), 'autorius gavo savo pranešimą';
  assert (select title from public.notification_outbox where kind = 'announcement' limit 1) = '„Pranešimų taurė“';
end $$;

set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code)
           values ('f4000000-0000-4000-8000-0000000000f4', 'Rytojaus turnyras', 'biggest', now() + interval '24 hours', now() + interval '2 days', 'push000002'),
                  ('f4000000-0000-4000-8000-0000000000f4', 'Poryt', 'biggest', now() + interval '48 hours', now() + interval '3 days', 'push000003') returning id, invite_code)
insert into px2 select invite_code, id from t;
insert into public.entries (tournament_id, user_id) select id, 'f2000000-0000-4000-8000-0000000000f2' from px2 where k in ('push000002', 'push000003');
set session_replication_role = origin;
do $$ begin
  assert public.notify_upcoming_starts() = 1, 'turėjo būti vienas „rytoj startas“';
  assert public.notify_upcoming_starts() = 0, 'pakartotinai siunčia';
  assert (select title from public.notification_outbox where kind = 'start') = 'Rytoj startas: „Rytojaus turnyras“';
end $$;

set role authenticated;
set request.jwt.claim.sub = 'f1000000-0000-4000-8000-0000000000f1';
do $$ begin assert public.send_test_push(), 'bandomasis neįdėtas'; end $$;
set request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000f3';
do $$ begin assert not public.send_test_push(), 'bandomasis be prenumeratos'; end $$;
reset role;

\echo '   ok'
\echo 'P4. Siuntimo eilė: paėmimas, rezultatai, dingę įrenginiai, įrenginio perėmimas'
do $$
declare n int; v record;
begin
  select count(*) into n from public.notification_outbox where claimed_at is null;
  assert (select count(*) from public.push_claim(500)) = n, 'paimta ne viskas';
  assert (select count(*) from public.push_claim(500)) = 0, 'paimta antrą kartą';
  select * into v from public.notification_outbox where kind = 'test';
  perform public.push_done(jsonb_build_array(jsonb_build_object('id', v.id, 'sent', 0, 'error', '410')), array['https://push.example.com/p1']);
  assert (select sent_count = 0 and error = '410' from public.notification_outbox where id = v.id), 'rezultatas neįrašytas';
  assert (select gone_at is not null from public.push_subscriptions where endpoint = 'https://push.example.com/p1'), 'dingęs neatžymėtas';
  assert not public.notify_user('f1000000-0000-4000-8000-0000000000f1', 'review', 'x', 'y', '#/', 'after-gone'), 'siunčia į dingusį įrenginį';
end $$;
-- Tas pats telefonas – kitas žvejys: įrenginys pereina naujam savininkui
set role authenticated;
set request.jwt.claim.sub = 'f3000000-0000-4000-8000-0000000000f3';
select public.save_push_subscription('https://push.example.com/q1', repeat('R', 87), repeat('d', 22));
set request.jwt.claim.sub = 'f2000000-0000-4000-8000-0000000000f2';
select public.remove_push_subscription('https://push.example.com/q1');  -- svetimo išjungti negali
reset role;
do $$ begin
  assert (select user_id from public.push_subscriptions where endpoint = 'https://push.example.com/q1') = 'f3000000-0000-4000-8000-0000000000f3', 'neperėmė';
  assert (select gone_at is null from public.push_subscriptions where endpoint = 'https://push.example.com/q1'), 'Q išjungė svetimą įrenginį';
end $$;
-- Viešoji lentelė veikia per naują vidinę funkciją
set role anon;
reset request.jwt.claim.sub;
do $$ begin
  assert (select count(*) from public.leaderboard((select id from px2 where k = 'tour'))) = 3, 'lentelė sugedo';
end $$;
reset role;

\echo '   ok'
