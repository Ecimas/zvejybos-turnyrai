-- 0033: savos taškų taisyklės. Rinkinys ir laukiami rezultatai – tie patys kaip tests/unit/custom_scoring.test.js.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'S1. Taisyklių tikrinimas'

do $$ begin
  assert public.valid_scoring('{"v":1,"base":"cm","species":[],"bonuses":[],"aggregate":{"mode":"best_n","n":5},"tiebreak":["biggest_fish","earliest"]}'), 'numatytos';
  assert not public.valid_scoring('{"v":1,"base":"x","species":[],"bonuses":[],"aggregate":{"mode":"all","n":1},"tiebreak":[]}'), 'blogas pagrindas';
  assert not public.valid_scoring('{"v":1,"base":"cm","species":[{"id":1,"min_cm":0,"m":100,"max":null},{"id":1,"min_cm":0,"m":100,"max":null}],"bonuses":[],"aggregate":{"mode":"all","n":1},"tiebreak":[]}'), 'rūšis kartojasi';
  assert not public.valid_scoring('{"v":1,"base":"cm","species":[{"id":1,"min_cm":0,"m":1.5,"max":null}],"bonuses":[],"aggregate":{"mode":"all","n":1},"tiebreak":[]}'), 'trupmeninis koef.';
  assert not public.valid_scoring('{"v":1,"base":"cm","species":[{"id":1,"min_cm":0,"m":100}],"bonuses":[],"aggregate":{"mode":"all","n":1},"tiebreak":[]}'), 'be max';
  assert not public.valid_scoring('{"v":1,"base":"cm","species":[],"bonuses":[{"type":"time","from":5,"to":5,"m":100}],"aggregate":{"mode":"all","n":1},"tiebreak":[]}'), 'laikas';
  assert not public.valid_scoring('{"v":1,"base":"cm","species":[],"bonuses":[],"aggregate":{"mode":"best_n","n":0},"tiebreak":[]}'), 'N';
  assert not public.valid_scoring('{"v":1,"base":"cm","species":[],"bonuses":[],"aggregate":{"mode":"all","n":1},"tiebreak":["earliest","earliest"]}'), 'lygiosios';
  assert not public.valid_scoring('"tekstas"'), 'ne objektas';
end $$;

\echo 'S2. Rinkiniai: tik organizatoriai, tik savi'
insert into auth.users (id, email) values
  ('98000000-0000-4000-8000-000000000098', 'cs-org@test.lt'),
  ('99000000-0000-4000-8000-000000000099', 'cs-usr@test.lt'),
  ('9a000000-0000-4000-8000-00000000009a', 'cs-a@test.lt'),
  ('9b000000-0000-4000-8000-00000000009b', 'cs-b@test.lt'),
  ('9c000000-0000-4000-8000-00000000009c', 'cs-c@test.lt'),
  ('9d000000-0000-4000-8000-00000000009d', 'cs-d@test.lt');
update public.profiles set nickname = v.n
  from (values ('98000000-0000-4000-8000-000000000098'::uuid, 'Cs_Org'), ('99000000-0000-4000-8000-000000000099', 'Cs_Usr'),
               ('9a000000-0000-4000-8000-00000000009a', 'Aras'), ('9b000000-0000-4000-8000-00000000009b', 'Benas'),
               ('9c000000-0000-4000-8000-00000000009c', 'Cezis'), ('9d000000-0000-4000-8000-00000000009d', 'Dovas')) v(id, n)
 where profiles.id = v.id;
update public.profiles set roles = array['organizer'] where id = '98000000-0000-4000-8000-000000000098';

create temp table cx (k text primary key, id uuid);
grant select, insert on cx to authenticated, anon;
create temp table rules_json as select '{
  "v": 1, "base": "cm",
  "species": [{"id": 1, "min_cm": 50, "m": 150, "max": 2}, {"id": 2, "min_cm": 20, "m": 200, "max": null}, {"id": 3, "min_cm": 45, "m": 130, "max": 3}],
  "bonuses": [{"type": "len_min", "cm": 70, "add": 200}, {"type": "len_min", "cm": 90, "add": 500}, {"type": "species", "add": 100},
              {"type": "biggest", "add": 300}, {"type": "time", "from": 22, "to": 5, "m": 120}, {"type": "first", "add": 50}],
  "aggregate": {"mode": "best_n", "n": 3}, "tiebreak": ["biggest_fish", "earliest"]}'::jsonb as r;
grant select on rules_json to authenticated;

set role authenticated;
set request.jwt.claim.sub = '99000000-0000-4000-8000-000000000099';
do $$ begin
  begin
    insert into public.scoring_rules (name, rules) values ('Paprasto žvejo', (select r from rules_json));
    raise exception 'FAIL: ne organizatorius sukūrė taisykles';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '98000000-0000-4000-8000-000000000098';
with x as (insert into public.scoring_rules (name, rules) values ('  Kauno marių plėšrūnai  ', (select r from rules_json)) returning id)
insert into cx select 'rule', id from x;
do $$ begin
  assert (select name from public.scoring_rules) = 'Kauno marių plėšrūnai', 'pavadinimas neapkarpytas';
  begin
    insert into public.scoring_rules (name, rules) values ('Blogos', '{"v":1}');
    raise exception 'FAIL: priimtos netinkamos taisyklės';
  exception when check_violation then null;
  end;
end $$;
set request.jwt.claim.sub = '99000000-0000-4000-8000-000000000099';
do $$ begin
  assert (select count(*) from public.scoring_rules) = 0, 'mato svetimas taisykles';
end $$;
reset role;

\echo 'S3. Turnyras: tik organizatorius, taisyklės užrakinamos po starto'
set role authenticated;
set request.jwt.claim.sub = '99000000-0000-4000-8000-000000000099';
do $$ begin
  begin
    insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility, scoring)
    values (auth.uid(), 'Savos be teisės', 'custom', now() + interval '1 day', now() + interval '2 days', 'private', (select r from rules_json));
    raise exception 'FAIL: ne organizatorius sukūrė savų taisyklių turnyrą';
  exception when raise_exception then
    if sqlerrm not like '%custom_not_allowed%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '98000000-0000-4000-8000-000000000098';
do $$ begin
  begin
    insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility)
    values (auth.uid(), 'Be taisyklių', 'custom', now() + interval '1 day', now() + interval '2 days', 'private');
    raise exception 'FAIL: custom be taisyklių';
  exception when raise_exception then
    if sqlerrm not like '%scoring_required%' then raise; end if;
  end;
end $$;
with x as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility, scoring, scoring_rule_id, min_length_mm)
           values (auth.uid(), 'Savos taisyklės', 'custom', now() + interval '1 day', now() + interval '2 days', 'private',
                   (select r from rules_json), (select id from cx where k = 'rule'), 300) returning id)
insert into cx select 'future', id from x;
do $$ begin
  assert (select min_length_mm from public.tournaments where id = (select id from cx where k = 'future')) = 0, 'min ilgis turi būti 0';
  assert (select scoring_rule_id from public.tournaments where id = (select id from cx where k = 'future')) = (select id from cx where k = 'rule'), 'nuoroda į rinkinį';
end $$;
-- Prieš startą taisykles keisti galima
update public.tournaments set scoring = jsonb_set(scoring, '{aggregate,n}', '4') where id = (select id from cx where k = 'future');
-- Kitas formatas – taisyklės išvalomos
update public.tournaments set format = 'biggest' where id = (select id from cx where k = 'future');
do $$ begin
  assert (select scoring from public.tournaments where id = (select id from cx where k = 'future')) is null, 'kitam formatui taisyklės lieka';
end $$;
reset role;

-- Vykstantis turnyras su rezultatais (sukuriamas be sargų – praeities datos)
set session_replication_role = replica;
insert into public.tournaments (id, organizer_id, title, format, starts_at, ends_at, visibility, scoring, invite_code)
values ('0c0c0000-0000-4000-8000-00000000000c', '98000000-0000-4000-8000-000000000098', 'Plėšrūnų taurė', 'custom',
        '2026-06-01T00:00:00Z', '2026-06-03T00:00:00Z', 'private', (select r from rules_json), 'cst0000001');
insert into public.tournament_species (tournament_id, species_id) values
  ('0c0c0000-0000-4000-8000-00000000000c', 1), ('0c0c0000-0000-4000-8000-00000000000c', 2), ('0c0c0000-0000-4000-8000-00000000000c', 3);
insert into public.entries (tournament_id, user_id, joined_at)
select '0c0c0000-0000-4000-8000-00000000000c', u::uuid, '2026-05-31T00:00:00Z'
  from unnest(array['9a000000-0000-4000-8000-00000000009a', '9b000000-0000-4000-8000-00000000009b',
                    '9c000000-0000-4000-8000-00000000009c', '9d000000-0000-4000-8000-00000000009d']) u;
insert into public.catches (id, user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
select ('c0000000-0000-4000-8000-0000000000' || v.n)::uuid, v.u::uuid, gen_random_uuid(), v.s, v.len, v.at::timestamptz, v.at::timestamptz,
       v.u || '/cs' || v.n || '.jpg', md5(v.u || v.n) || md5(v.n || v.u), 'approved'
  from (values
    ('01', '9a000000-0000-4000-8000-00000000009a', 1, 720, '2026-06-01T10:00:00Z'),
    ('02', '9a000000-0000-4000-8000-00000000009a', 2, 315, '2026-06-01T20:30:00Z'),
    ('03', '9a000000-0000-4000-8000-00000000009a', 1, 480, '2026-06-01T11:00:00Z'),
    ('04', '9a000000-0000-4000-8000-00000000009a', 1, 910, '2026-06-02T08:00:00Z'),
    ('05', '9a000000-0000-4000-8000-00000000009a', 1, 600, '2026-06-02T09:00:00Z'),
    ('06', '9b000000-0000-4000-8000-00000000009b', 3, 500, '2026-06-01T08:00:00Z'),
    ('07', '9b000000-0000-4000-8000-00000000009b', 3, 455, '2026-06-01T09:00:00Z'),
    ('08', '9b000000-0000-4000-8000-00000000009b', 2, 250, '2026-06-01T12:00:00Z'),
    ('09', '9b000000-0000-4000-8000-00000000009b', 2, 199, '2026-06-01T13:00:00Z'),
    ('10', '9c000000-0000-4000-8000-00000000009c', 4, 700, '2026-06-01T14:00:00Z'),
    ('11', '9c000000-0000-4000-8000-00000000009c', 2, 300, '2026-06-02T21:00:00Z'),
    ('12', '9d000000-0000-4000-8000-00000000009d', 2, 360, '2026-06-01T11:00:00Z')) v(n, u, s, len, at);
set session_replication_role = origin;

\echo 'S4. Rezultatai sutampa su programėle'
do $$
declare got text;
begin
  select string_agg(format('%s:%s:%s:%s', nickname, rank, score_mm, counted), ' ' order by rank, nickname) into got
    from public.leaderboard_all('0c0c0000-0000-4000-8000-00000000000c');
  assert got = 'Aras:1:4401:3 Benas:2:1991:3 Dovas:3:820:1 Cezis:4:820:1', got;
end $$;

-- Lygiosios „anksčiau pasiekė“: Cezis (00:00) vėliau nei Dovas (14:00 išvakarėse)
set session_replication_role = replica;
update public.tournaments set scoring = jsonb_set(scoring, '{tiebreak}', '["earliest"]') where id = '0c0c0000-0000-4000-8000-00000000000c';
set session_replication_role = origin;
do $$
declare got text;
begin
  select string_agg(format('%s:%s', nickname, rank), ' ' order by rank, nickname) into got
    from public.leaderboard_all('0c0c0000-0000-4000-8000-00000000000c');
  assert got = 'Aras:1 Benas:2 Dovas:3 Cezis:4', got;
end $$;

-- Prasidėjusiam turnyrui taisyklių keisti nebegalima (organizatorių sustabdo sargas; keisti gali tik savininkas, 0035)
set role authenticated;
set request.jwt.claim.sub = '98000000-0000-4000-8000-000000000098';
do $$ begin
  update public.tournaments set scoring = jsonb_set(scoring, '{aggregate,n}', '5') where id = '0c0c0000-0000-4000-8000-00000000000c';
  raise exception 'FAIL: organizatorius pakeitė taisykles';
exception when raise_exception then
  if sqlerrm not like '%scoring_locked%' and sqlerrm not like '%started_rules_locked%' then raise; end if;
end $$;
reset role;
do $$ begin
  assert (select scoring->'aggregate'->>'n' from public.tournaments where id = '0c0c0000-0000-4000-8000-00000000000c') = '3', 'organizatorius pakeitė prasidėjusio turnyro taisykles';
end $$;
do $$ begin
  begin
    update public.tournaments set scoring = jsonb_set(scoring, '{aggregate,n}', '5') where id = '0c0c0000-0000-4000-8000-00000000000c';
    raise exception 'FAIL: pakeistos prasidėjusio turnyro taisyklės';
  exception when raise_exception then
    if sqlerrm not like '%scoring_locked%' then raise; end if;
  end;
end $$;
reset role;

-- Ištrynus rinkinį turnyras lieka su savo kopija
set role authenticated;
set request.jwt.claim.sub = '98000000-0000-4000-8000-000000000098';
delete from public.scoring_rules where id = (select id from cx where k = 'rule');
reset role;
do $$ begin
  assert (select count(*) from public.leaderboard_all('0c0c0000-0000-4000-8000-00000000000c')) = 4, 'lentelė po rinkinio ištrynimo';
end $$;

\echo 'SAVŲ TAISYKLIŲ TESTAI PRAĖJO'
