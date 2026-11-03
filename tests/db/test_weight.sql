-- 0040: laimikio svėrimas ir turnyrai pagal svorį.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'W1. Laimikis: ilgis arba svoris (bent vienas)'

insert into auth.users (id, email) values
  ('b4100000-0000-4000-8000-0000000000b1', 'w-org@test.lt'),
  ('b4200000-0000-4000-8000-0000000000b2', 'w-a@test.lt'),
  ('b4300000-0000-4000-8000-0000000000b3', 'w-b@test.lt'),
  ('b4400000-0000-4000-8000-0000000000b4', 'w-c@test.lt');
update public.profiles set nickname = v.n
  from (values ('b4100000-0000-4000-8000-0000000000b1'::uuid, 'W_Org'), ('b4200000-0000-4000-8000-0000000000b2', 'Wa_a'),
               ('b4300000-0000-4000-8000-0000000000b3', 'Wb_b'), ('b4400000-0000-4000-8000-0000000000b4', 'Wc_c')) v(id, n)
 where profiles.id = v.id;
update public.profiles set roles = array['organizer'] where id = 'b4100000-0000-4000-8000-0000000000b1';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('b4200000-0000-4000-8000-0000000000b2', 'https://push.test/w-b2', repeat('x', 87), repeat('x', 22));

set role authenticated;
set request.jwt.claim.sub = 'b4200000-0000-4000-8000-0000000000b2';
-- Tik pasvertas karpis (be ilgio) – priimamas
insert into public.catches (client_id, species_id, length_mm, weight_g, captured_at_device, photo_path, photo_sha256)
values ('e4000000-0000-4000-8000-000000000001', (select id from public.species where code = 'karpis'), null, 12450, now() - interval '1 hour',
        'b4200000-0000-4000-8000-0000000000b2/e4000000-0000-4000-8000-000000000001.webp', md5('w1') || md5('1w'));
do $$ begin
  -- Nei ilgio, nei svorio – ne
  begin
    insert into public.catches (client_id, species_id, length_mm, weight_g, captured_at_device, photo_path, photo_sha256)
    values (gen_random_uuid(), 1, null, null, now(), auth.uid()::text || '/w2.jpg', md5('w2') || md5('2w'));
    raise exception 'FAIL: laimikis be ilgio ir svorio';
  exception when check_violation then null;
  end;
  -- Netikras ilgis – ne
  begin
    insert into public.catches (client_id, species_id, length_mm, weight_g, captured_at_device, photo_path, photo_sha256)
    values (gen_random_uuid(), 1, 10, null, now(), auth.uid()::text || '/w3.jpg', md5('w3') || md5('3w'));
    raise exception 'FAIL: 1 cm ilgis';
  exception when check_violation then null;
  end;
end $$;
reset role;

\echo 'W2. Turnyras pagal svorį: tik „Sunkiausia“ ir „Kelių svorių suma“'
set role authenticated;
set request.jwt.claim.sub = 'b4100000-0000-4000-8000-0000000000b1';
do $$ begin
  begin
    insert into public.tournaments (organizer_id, title, format, measure, starts_at, ends_at, visibility)
    values (auth.uid(), 'Taškai pagal svorį', 'species_points', 'weight', now() + interval '1 day', now() + interval '2 days', 'private');
    raise exception 'FAIL: svorio turnyras su taškais už rūšį';
  exception when check_violation then null;
  end;
  begin
    insert into public.tournaments (organizer_id, title, format, measure, starts_at, ends_at, visibility)
    values (auth.uid(), 'Nežinomas matavimas', 'biggest', 'volume', now() + interval '1 day', now() + interval '2 days', 'private');
    raise exception 'FAIL: nežinomas matavimas';
  exception when check_violation then null;
  end;
end $$;
reset role;

-- Vykstantys turnyrai: svorio (sunkiausias karpis, min. 5 kg) ir ilgio (didžiausia žuvis)
set session_replication_role = replica;
insert into public.tournaments (id, organizer_id, title, format, top_n, measure, min_weight_g, starts_at, ends_at, visibility, invite_code) values
  ('f4000000-0000-4000-8000-0000000000a1', 'b4100000-0000-4000-8000-0000000000b1', 'Metų karpis', 'biggest', 1, 'weight', 5000,
   now() - interval '2 days', now() + interval '5 days', 'private', 'wkarp00001'),
  ('f4000000-0000-4000-8000-0000000000a2', 'b4100000-0000-4000-8000-0000000000b1', 'Karpių svorių suma', 'top_n_sum', 2, 'weight', 0,
   now() - interval '2 days', now() + interval '5 days', 'private', 'wkarp00002'),
  ('f4000000-0000-4000-8000-0000000000a3', 'b4100000-0000-4000-8000-0000000000b1', 'Ilgio taurė', 'biggest', 1, 'length', 0,
   now() - interval '2 days', now() + interval '5 days', 'private', 'wkarp00003');
insert into public.tournament_species (tournament_id, species_id)
select 'f4000000-0000-4000-8000-0000000000a1', id from public.species where code = 'karpis';
insert into public.entries (tournament_id, user_id, joined_at)
select t, u::uuid, now() - interval '3 days'
  from unnest(array['f4000000-0000-4000-8000-0000000000a1', 'f4000000-0000-4000-8000-0000000000a2', 'f4000000-0000-4000-8000-0000000000a3']::uuid[]) t,
       unnest(array['b4200000-0000-4000-8000-0000000000b2', 'b4300000-0000-4000-8000-0000000000b3', 'b4400000-0000-4000-8000-0000000000b4']) u;
insert into public.catches (user_id, client_id, species_id, length_mm, weight_g, captured_at_device, received_at, photo_path, photo_sha256, status)
select v.u::uuid, gen_random_uuid(), (select id from public.species where code = v.sp), v.len, v.g, now() - v.ago::interval, now() - v.ago::interval,
       v.u || '/w' || v.n || '.webp', md5('wt' || v.n) || md5(v.n || 'wt'), 'approved'
  from (values
    ('10', 'b4300000-0000-4000-8000-0000000000b3', 'karpis', null, 15200, '30 hours'),  -- Wb: sunkiausias karpis
    ('11', 'b4300000-0000-4000-8000-0000000000b3', 'karpis', 640, 4100, '20 hours'),    -- Wb: per lengvas min. 5 kg, bet su ilgiu
    ('12', 'b4400000-0000-4000-8000-0000000000b4', 'karpis', 720, 9800, '10 hours'),    -- Wc: abu matai
    ('13', 'b4400000-0000-4000-8000-0000000000b4', 'lydeka', 900, 7000, '9 hours'),     -- Wc: ne karpis
    ('14', 'b4200000-0000-4000-8000-0000000000b2', 'karpis', null, 9800, '12 hours')    -- Wa: tiek pat kaip Wc, bet anksčiau
  ) v(n, u, sp, len, g, ago);
set session_replication_role = origin;

\echo 'W3. Lentelės: svoris gramais, ilgio turnyre – tik su ilgiu'
do $$
declare got text;
begin
  select string_agg(format('%s:%s:%s:%s', nickname, rank, score_mm, counted), ' ' order by rank, nickname) into got
    from public.leaderboard_all('f4000000-0000-4000-8000-0000000000a1');
  -- Wb 15,2 kg; Wa ir Wc po 9,8 kg – aukščiau tas, kas pagavo anksčiau (Wa); Wb 4,1 kg karpis neįskaitomas (min. 5 kg)
  assert got = 'Wb_b:1:15200:1 Wa_a:2:9800:1 Wc_c:3:9800:1', got;
  select string_agg(format('%s:%s:%s', nickname, score_mm, counted), ' ' order by rank, nickname) into got
    from public.leaderboard_all('f4000000-0000-4000-8000-0000000000a2');
  -- Dviejų sunkiausių suma, visos rūšys
  assert got = 'Wb_b:19300:2 Wc_c:16800:2 Wa_a:9800:1', got;
  select string_agg(format('%s:%s', nickname, score_mm), ' ' order by rank, nickname) into got
    from public.leaderboard_all('f4000000-0000-4000-8000-0000000000a3');
  -- Ilgio turnyre tik pasverti (be ilgio) laimikiai neįskaitomi
  assert got = 'Wc_c:900 Wb_b:640', got;
end $$;

\echo 'W4. Pranešimas, patikra, klubų skaičiavimai, savos taisyklės'
-- Patvirtinimo pranešimas su svoriu
set session_replication_role = replica;
update public.catches set status = 'pending' where client_id = 'e4000000-0000-4000-8000-000000000001';
set session_replication_role = origin;
update public.catches set status = 'approved' where client_id = 'e4000000-0000-4000-8000-000000000001';
do $$ begin
  assert exists (select 1 from public.notification_outbox where user_id = 'b4200000-0000-4000-8000-0000000000b2'
                   and body like 'Karpis 12,45 kg – patvirtinta%'), 'pranešime nėra svorio';
  assert public.season_points('b4300000-0000-4000-8000-0000000000b3', extract(year from now() at time zone 'Europe/Vilnius')::int) = 64,
    'sezono taškai turi skaičiuoti tik ilgius';
end $$;
-- Savos taisyklės „už kilogramą“: tik pasverti karpiai tinka; „už cm“ – ne
set session_replication_role = replica;
insert into public.tournaments (id, organizer_id, title, format, starts_at, ends_at, visibility, invite_code, scoring) values
  ('f4000000-0000-4000-8000-0000000000a4', 'b4100000-0000-4000-8000-0000000000b1', 'Kg taškai', 'custom',
   now() - interval '2 days', now() + interval '5 days', 'private', 'wkarp00004',
   '{"v":1,"base":"kg","species":[],"bonuses":[],"aggregate":{"mode":"best","n":1},"tiebreak":["earliest"]}'),
  ('f4000000-0000-4000-8000-0000000000a5', 'b4100000-0000-4000-8000-0000000000b1', 'Cm taškai', 'custom',
   now() - interval '2 days', now() + interval '5 days', 'private', 'wkarp00005',
   '{"v":1,"base":"cm","species":[],"bonuses":[],"aggregate":{"mode":"best","n":1},"tiebreak":["earliest"]}');
insert into public.entries (tournament_id, user_id, joined_at)
select t, 'b4300000-0000-4000-8000-0000000000b3', now() - interval '3 days'
  from unnest(array['f4000000-0000-4000-8000-0000000000a4', 'f4000000-0000-4000-8000-0000000000a5']::uuid[]) t;
set session_replication_role = origin;
do $$
declare got text;
begin
  select string_agg(format('%s:%s', nickname, score_mm), ' ') into got from public.leaderboard_all('f4000000-0000-4000-8000-0000000000a4');
  assert got = 'Wb_b:152', got;  -- 15,2 kg × 1 = 15,2 tšk.
  select string_agg(format('%s:%s', nickname, score_mm), ' ') into got from public.leaderboard_all('f4000000-0000-4000-8000-0000000000a5');
  assert got = 'Wb_b:640', got;  -- tik su ilgiu
end $$;

\echo 'W5. Prasidėjusio turnyro matavimo keisti negalima'
set role authenticated;
set request.jwt.claim.sub = 'b4100000-0000-4000-8000-0000000000b1';
do $$ begin
  update public.tournaments set min_weight_g = 1000 where id = 'f4000000-0000-4000-8000-0000000000a1';
  raise exception 'FAIL: pakeitė min. svorį po starto';
exception when raise_exception then
  if sqlerrm not like '%started_rules_locked%' then raise; end if;
end $$;
do $$ begin
  update public.tournaments set measure = 'length' where id = 'f4000000-0000-4000-8000-0000000000a2';
  raise exception 'FAIL: pakeitė matavimą po starto';
exception when raise_exception then
  if sqlerrm not like '%started_rules_locked%' then raise; end if;
end $$;
reset role;
\echo 'W6. Rezultato žinutė žino matavimą'
set session_replication_role = replica;
insert into public.conversations (id, tournament_id, kind, organizer_id, participant_id, last_message_at)
values ('c4000000-0000-4000-8000-0000000000c1', 'f4000000-0000-4000-8000-0000000000a1', 'system', null, 'b4300000-0000-4000-8000-0000000000b3', now());
set session_replication_role = origin;
insert into public.messages (conversation_id, sender_id, body, meta)
values ('c4000000-0000-4000-8000-0000000000c1', null, 'Turnyras baigėsi', '{"event":"result","place":1,"score_mm":15200}');
do $$ begin
  assert (select meta ->> 'measure' from public.messages where conversation_id = 'c4000000-0000-4000-8000-0000000000c1') = 'weight', 'nėra matavimo';
end $$;
\echo '   ok – svėrimas'
