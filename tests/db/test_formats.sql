-- 0020: taškai už rūšį, dvikovos, sezono lygos, divizionai.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'F1. Taškai už rūšį'

insert into auth.users (id, email) values
  ('71000000-0000-4000-8000-000000000071', 'fmt7-a@test.lt'),
  ('72000000-0000-4000-8000-000000000072', 'fmt7-b@test.lt'),
  ('73000000-0000-4000-8000-000000000073', 'fmt7-c@test.lt'),
  ('74000000-0000-4000-8000-000000000074', 'fmt7-d@test.lt'),
  ('75000000-0000-4000-8000-000000000075', 'fmt7-e@test.lt'),
  ('76000000-0000-4000-8000-000000000076', 'fmt7-f@test.lt');
update public.profiles set nickname = 'Fmt_' || substr(id::text, 2, 1) where id::text like '7_000000-0000-4000-8000-00000000007_';
create temp table fx (k text primary key, id uuid);
grant select, insert on fx to authenticated, anon;

set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, top_n, starts_at, ends_at, invite_code)
           values ('76000000-0000-4000-8000-000000000076', 'Taškų taurė', 'species_points', 2, now() - interval '1 day', now() + interval '1 day', 'fmt0000001')
           returning id)
insert into fx select 'sp', id from t;
insert into public.tournament_species (tournament_id, species_id, points_pct)
  select (select id from fx where k = 'sp'), s, p from (values (1, 100), (2, 200)) v(s, p);
insert into public.entries (tournament_id, user_id, joined_at)
  select (select id from fx where k = 'sp'), u, now() - interval '2 days'
    from unnest(array['71000000-0000-4000-8000-000000000071', '72000000-0000-4000-8000-000000000072']::uuid[]) u;
insert into public.catches (user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
select u::uuid, gen_random_uuid(), s, len, now() - make_interval(hours => h), now() - make_interval(hours => h), u || '/fmt' || n || '.jpg', md5(u || n) || md5(n || u), 'approved'
  from (values ('71000000-0000-4000-8000-000000000071', 1, 700, 5, 17), ('71000000-0000-4000-8000-000000000071', 1, 600, 4, 18),
               ('71000000-0000-4000-8000-000000000071', 2, 300, 3, 19), ('71000000-0000-4000-8000-000000000071', 3, 990, 2, 20),
               ('72000000-0000-4000-8000-000000000072', 2, 400, 5, 21), ('72000000-0000-4000-8000-000000000072', 1, 450, 4, 22),
               ('72000000-0000-4000-8000-000000000072', 2, 411, 3, 23)) v(u, s, len, h, n);
set session_replication_role = origin;

do $$ declare a bigint; b bigint; ra bigint; rb bigint; begin
  select score_mm, rank into a, ra from public.leaderboard_all((select id from fx where k = 'sp')) where user_id = '71000000-0000-4000-8000-000000000071';
  select score_mm, rank into b, rb from public.leaderboard_all((select id from fx where k = 'sp')) where user_id = '72000000-0000-4000-8000-000000000072';
  -- A: 700×1 + 600×1 (300×2 = 600 lygus, bet vėlesnis), 990 kitos rūšies – neįskaitoma
  assert a = 1300, format('A taškai %s', a);
  -- B: 411×2 = 822 + 400×2 = 800
  assert b = 1622, format('B taškai %s', b);
  assert rb = 1 and ra = 2, 'vietos pagal taškus';
end $$;
do $$ begin
  begin
    insert into public.tournament_species (tournament_id, species_id, points_pct) values ((select id from fx where k = 'sp'), 4, 5);
    raise exception 'FAIL: per mažas koeficientas';
  exception when check_violation then null; end;
end $$;
\echo '   ok'

\echo 'F2. Dvikovos: taisyklės, tinklelis'
-- Kuriant dvikovų turnyrą registracija po starto, slėpimas ir komandos išjungiami
set role authenticated;
set request.jwt.claim.sub = '76000000-0000-4000-8000-000000000076';
with t as (insert into public.tournaments (title, format, top_n, starts_at, ends_at, leaderboard_hidden, late_join_minutes, team_mode)
           values ('Dvikovų būsima', 'duels', 1, now() + interval '1 day', now() + interval '4 days', true, null, true) returning id)
insert into fx select 'duel_future', id from t;
reset role;
do $$ begin
  assert (select late_join_minutes = 0 and not leaderboard_hidden and not team_mode from public.tournaments where id = (select id from fx where k = 'duel_future')),
    'dvikovų taisyklės neįjungtos';
end $$;

-- 5 dalyviai iki starto + 1 vėlavęs; 3 ratai po 1 d.; startas prieš 2,5 d. -> du ratai baigti, trečias vyksta
set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, top_n, starts_at, ends_at, invite_code, late_join_minutes)
           values ('76000000-0000-4000-8000-000000000076', 'Dvikovos', 'duels', 1, now() - interval '60 hours', now() + interval '12 hours', 'fmt0000002', 0)
           returning id)
insert into fx select 'duel', id from t;
insert into public.entries (tournament_id, user_id, joined_at)
  select (select id from fx where k = 'duel'), u, now() - interval '61 hours'
    from unnest(array['71000000-0000-4000-8000-000000000071', '72000000-0000-4000-8000-000000000072', '73000000-0000-4000-8000-000000000073',
                      '74000000-0000-4000-8000-000000000074', '75000000-0000-4000-8000-000000000075']::uuid[]) u;
insert into public.entries (tournament_id, user_id, joined_at) values ((select id from fx where k = 'duel'), '76000000-0000-4000-8000-000000000076', now() - interval '59 hours');
-- Kiekvienas žvejys kiekviename rate pagauna žuvį pagal savo „jėgą“ (A=100 … E=500 mm)
do $$
declare u uuid; i int := 0; r int;
begin
  foreach u in array array['71000000-0000-4000-8000-000000000071', '72000000-0000-4000-8000-000000000072', '73000000-0000-4000-8000-000000000073',
                           '74000000-0000-4000-8000-000000000074', '75000000-0000-4000-8000-000000000075', '76000000-0000-4000-8000-000000000076']::uuid[] loop
    i := i + 1;
    for r in 0..2 loop
      insert into public.catches (user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
      values (u, gen_random_uuid(), 1, case when i = 6 then 990 else i * 100 end, now() - interval '59 hours' + make_interval(hours => r * 24),
              now() - interval '59 hours' + make_interval(hours => r * 24), u || '/duel' || i || r || '.jpg', md5(u::text || r) || md5(r || u::text), 'approved');
    end loop;
  end loop;
end $$;
set session_replication_role = origin;

set role anon;
do $$
declare n int; champ uuid;
begin
  assert (select count(*) from public.duel_bracket((select id from fx where k = 'duel')) where round = 1) = 3, 'pirmame rate 3 poros (5 dalyviai)';
  assert (select max(rounds) from public.duel_bracket((select id from fx where k = 'duel'))) = 3, 'ratų skaičius';
  assert not exists (select 1 from public.duel_bracket((select id from fx where k = 'duel'))
                      where '76000000-0000-4000-8000-000000000076' in (a_id, b_id)), 'vėlavęs žvejys pateko į tinklelį';
  assert (select count(*) from public.duel_bracket((select id from fx where k = 'duel')) where b_id is null and round = 1) = 1, 'turi būti viena laisva vieta';
  assert (select bool_and(winner_id = a_id and b_score is null) from public.duel_bracket((select id from fx where k = 'duel')) where b_id is null), 'laisva vieta – praeina';
  -- Baigtuose ratuose laimi stipresnis (didesnis ID skaitmuo = didesnė žuvis)
  assert (select bool_and(status = 'done' and winner_id = case when a_score >= coalesce(b_score, -1) then a_id else b_id end)
            from public.duel_bracket((select id from fx where k = 'duel')) where round < 3), 'baigtų ratų nugalėtojai';
  assert (select bool_and(a_score = (substr(a_id::text, 2, 1))::int * 100) from public.duel_bracket((select id from fx where k = 'duel')) where round < 3),
    'rato rezultatas – tik to rato laimikis';
  assert (select count(*) from public.duel_bracket((select id from fx where k = 'duel')) where round = 2) = 2, 'antrame rate 2 poros (3 nugalėtojai)';
  select count(*) into n from public.duel_bracket((select id from fx where k = 'duel')) where round = 3;
  assert n = 1, format('finale 1 pora, yra %s', n);
  assert (select status = 'live' and winner_id is null and '75000000-0000-4000-8000-000000000075' in (a_id, b_id)
            from public.duel_bracket((select id from fx where k = 'duel')) where round = 3), 'stipriausias finale, rezultatas dar nežinomas';
  assert (select starts_at = (select t.starts_at from public.tournaments t where t.id = (select id from fx where k = 'duel')) + interval '48 hours'
            from public.duel_bracket((select id from fx where k = 'duel')) where round = 3 limit 1), 'rato laikas';
  -- Ne dvikovų turnyrui – tuščia
  assert (select count(*) from public.duel_bracket((select id from fx where k = 'sp'))) = 0;
end $$;
reset role;
-- Privatus dvikovų turnyras pašaliniam nematomas
set session_replication_role = replica;
update public.tournaments set visibility = 'private' where id = (select id from fx where k = 'duel');
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = '76000000-0000-4000-8000-000000000076';
do $$ begin assert (select count(*) from public.duel_bracket((select id from fx where k = 'duel'))) > 0, 'dalyvis mato privatų'; end $$;
reset role;
reset request.jwt.claim.sub;
set role anon;
do $$ begin assert (select count(*) from public.duel_bracket((select id from fx where k = 'duel'))) = 0, 'privatus tinklelis matomas neprisijungusiam'; end $$;
reset role;
set session_replication_role = replica;
update public.tournaments set visibility = 'public' where id = (select id from fx where k = 'duel');
set session_replication_role = origin;
\echo '   ok'

\echo 'F3. Sezono lygos'
set role authenticated;
set request.jwt.claim.sub = '71000000-0000-4000-8000-000000000071';
with l as (insert into public.leagues (name, season) values ('  Kauno lyga  ', 2026) returning id)
insert into fx select 'league', id from l;
do $$ begin
  assert (select name from public.leagues where id = (select id from fx where k = 'league')) = 'Kauno lyga';
  begin insert into public.leagues (name, season) values ('kauno LYGA', 2026); raise exception 'FAIL: dublis'; exception when unique_violation then null; end;
  insert into public.leagues (name, season) values ('Kauno lyga', 2027);
  begin insert into public.leagues (name, season) values ('<img src=x>', 2026); raise exception 'FAIL: blogas vardas'; exception when check_violation then null; end;
  begin insert into public.leagues (name, season) values ('Senovė', 1999); raise exception 'FAIL: sezonas'; exception when check_violation then null; end;
  insert into public.leagues (name, season) values ('L3 lyga', 2026), ('L4 lyga', 2026), ('L5 lyga', 2026);
  begin insert into public.leagues (name, season) values ('L6 lyga', 2026); raise exception 'FAIL: limitas'; exception when raise_exception then null; end;
  begin
    update public.leagues set owner_id = '72000000-0000-4000-8000-000000000072' where id = (select id from fx where k = 'league');
    raise exception 'FAIL: savininko keitimas';
  exception when insufficient_privilege then null; end;
end $$;
-- Savininkas įtraukia savo būsimą turnyrą; kitas – negali
with t as (insert into public.tournaments (title, format, starts_at, ends_at, league_id)
           values ('Lygos etapas', 'biggest', now() + interval '1 day', now() + interval '2 days', (select id from fx where k = 'league')) returning id)
insert into fx select 'stage', id from t;
set request.jwt.claim.sub = '72000000-0000-4000-8000-000000000072';
do $$ declare n int; begin
  begin
    insert into public.tournaments (title, format, starts_at, ends_at, league_id)
    values ('Svetimas etapas', 'biggest', now() + interval '1 day', now() + interval '2 days', (select id from fx where k = 'league'));
    raise exception 'FAIL: svetima lyga';
  exception when raise_exception then
    if sqlerrm <> 'league_owner' then raise; end if;
  end;
  update public.leagues set name = 'Pagrobta' where id = (select id from fx where k = 'league');
  get diagnostics n = row_count;
  assert n = 0, 'svetimos lygos keitimas';
end $$;
reset role;

-- Įskaita: taškų turnyras (B 1, A 2) + didžiausios žuvies (B 900, A 500, C 400) + privatus (neįskaitomas) + paslėptas vykstantis
set session_replication_role = replica;
update public.tournaments set league_id = (select id from fx where k = 'league') where id = (select id from fx where k = 'sp');
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code, league_id, visibility, leaderboard_hidden)
           values ('71000000-0000-4000-8000-000000000071', 'Etapas 2', 'biggest', now() - interval '3 days', now() - interval '1 day', 'fmt0000003', (select id from fx where k = 'league'), 'public', false),
                  ('71000000-0000-4000-8000-000000000071', 'Privatus etapas', 'biggest', now() - interval '3 days', now() - interval '1 day', 'fmt0000004', (select id from fx where k = 'league'), 'private', false),
                  ('71000000-0000-4000-8000-000000000071', 'Slaptas etapas', 'biggest', now() - interval '3 days', now() + interval '1 day', 'fmt0000005', (select id from fx where k = 'league'), 'public', true)
           returning id, invite_code)
insert into fx select invite_code, id from t;
insert into public.entries (tournament_id, user_id, joined_at)
  select t.id, u, now() - interval '4 days' from fx t,
         unnest(array['71000000-0000-4000-8000-000000000071', '72000000-0000-4000-8000-000000000072', '73000000-0000-4000-8000-000000000073']::uuid[]) u
   where t.k in ('fmt0000003', 'fmt0000004', 'fmt0000005');
insert into public.catches (user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
select u::uuid, gen_random_uuid(), 1, len, now() - interval '2 days', now() - interval '2 days', u || '/lg' || len || '.jpg', md5(u || len) || md5(len || u), 'approved'
  from (values ('72000000-0000-4000-8000-000000000072', 900), ('71000000-0000-4000-8000-000000000071', 500), ('73000000-0000-4000-8000-000000000073', 400)) v(u, len);
set session_replication_role = origin;

set role anon;
do $$
declare a record; b record; c record;
begin
  select * into a from public.league_standings((select id from fx where k = 'league')) where user_id = '71000000-0000-4000-8000-000000000071';
  select * into b from public.league_standings((select id from fx where k = 'league')) where user_id = '72000000-0000-4000-8000-000000000072';
  select * into c from public.league_standings((select id from fx where k = 'league')) where user_id = '73000000-0000-4000-8000-000000000073';
  -- „Taškų taurė“: B 25, A 18. „Etapas 2“: B 25, A 18, C 15. Privatus ir paslėptas neįskaitomi.
  assert b.points = 50 and b.events = 2 and b.wins = 2 and b.rank = 1, format('B %s', b);
  assert a.points = 36 and a.events = 2 and a.wins = 0 and a.best_place = 2 and a.rank = 2, format('A %s', a);
  assert c.points = 15 and c.events = 1 and c.rank = 3, format('C %s', c);
  assert public.league_points(1) = 25 and public.league_points(10) = 1 and public.league_points(11) = 0;
end $$;
reset role;
\echo '   ok'

\echo 'F4. Divizionai'
set role authenticated;
set request.jwt.claim.sub = '76000000-0000-4000-8000-000000000076';
with t as (insert into public.tournaments (title, format, starts_at, ends_at) values ('Divizionų taurė', 'biggest', now() + interval '1 day', now() + interval '2 days') returning id)
insert into fx select 'div', id from t;
with d as (insert into public.tournament_divisions (tournament_id, name, sort)
           select (select id from fx where k = 'div'), n, s from (values (' Jaunimas ', 0), ('Moterys', 1)) v(n, s) returning id, name)
insert into fx select 'div_' || name, id from d;
do $$ begin
  assert exists (select 1 from fx where k = 'div_Jaunimas'), 'pavadinimas neapkarpytas';
  begin
    insert into public.tournament_divisions (tournament_id, name) values ((select id from fx where k = 'div'), 'jaunimas');
    raise exception 'FAIL: dublis';
  exception when unique_violation then null; end;
  begin
    insert into public.tournament_divisions (tournament_id, name) values ((select id from fx where k = 'div'), '<b>');
    raise exception 'FAIL: blogas vardas';
  exception when check_violation then null; end;
  insert into public.tournament_divisions (tournament_id, name) select (select id from fx where k = 'div'), 'D' || g from generate_series(3, 8) g;
  begin
    insert into public.tournament_divisions (tournament_id, name) values ((select id from fx where k = 'div'), 'D9');
    raise exception 'FAIL: limitas';
  exception when raise_exception then null; end;
end $$;
-- Kitas žvejys divizionų kurti negali; registruojasi su kito turnyro divizionu -> null; pasirenka teisingą
set request.jwt.claim.sub = '72000000-0000-4000-8000-000000000072';
do $$ begin
  begin
    insert into public.tournament_divisions (tournament_id, name) values ((select id from fx where k = 'duel_future'), 'Įsilaužėliai');
    raise exception 'FAIL: svetimas divizionas';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.entries (tournament_id, division_id) values ((select id from fx where k = 'div'), gen_random_uuid());
do $$ begin
  assert (select division_id from public.entries where tournament_id = (select id from fx where k = 'div') and user_id = auth.uid()) is null, 'svetimas divizionas priimtas';
  perform public.set_entry_division((select id from fx where k = 'div'), (select id from fx where k = 'div_Moterys'));
  assert (select division_id from public.entries where tournament_id = (select id from fx where k = 'div') and user_id = auth.uid()) = (select id from fx where k = 'div_Moterys');
  begin
    perform public.set_entry_division((select id from fx where k = 'div'), gen_random_uuid());
    raise exception 'FAIL: neegzistuojantis divizionas';
  exception when raise_exception then if sqlerrm <> 'division_invalid' then raise; end if; end;
  begin
    perform public.set_entry_division((select id from fx where k = 'duel_future'), null);
    raise exception 'FAIL: nedalyvauja';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;
-- Registracijai pasibaigus divizionas nebekeičiamas
set session_replication_role = replica;
update public.tournaments set starts_at = now() - interval '2 hours', late_join_minutes = 60 where id = (select id from fx where k = 'div');
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = '72000000-0000-4000-8000-000000000072';
do $$ begin
  begin
    perform public.set_entry_division((select id from fx where k = 'div'), (select id from fx where k = 'div_Jaunimas'));
    raise exception 'FAIL: pakeista po registracijos';
  exception when raise_exception then if sqlerrm <> 'division_closed' then raise; end if; end;
end $$;
-- Prasidėjus turnyrui organizatorius divizionų keisti nebegali
set request.jwt.claim.sub = '76000000-0000-4000-8000-000000000076';
do $$ declare n int; begin
  update public.tournament_divisions set name = 'Kita' where tournament_id = (select id from fx where k = 'div');
  get diagnostics n = row_count;
  assert n = 0, 'divizionai pakeisti po starto';
end $$;
reset role;
-- Ištrynus divizioną dalyvio pasirinkimas tampa null
delete from public.tournament_divisions where id = (select id from fx where k = 'div_Moterys');
do $$ begin
  assert (select division_id from public.entries where tournament_id = (select id from fx where k = 'div') and user_id = '72000000-0000-4000-8000-000000000072') is null;
end $$;
\echo '   ok'

\echo 'F5. Dvikovų tvarka sutampa su naršyklės skaičiavimu (src/lib/duels.js)'
do $$ begin
  assert (select array_agg(u order by encode(sha256(convert_to('aaaaaaaa-0000-4000-8000-000000000020' || u::text, 'UTF8')), 'hex'))
            from unnest(array['71000000-0000-4000-8000-000000000071', '72000000-0000-4000-8000-000000000072', '73000000-0000-4000-8000-000000000073',
                              '74000000-0000-4000-8000-000000000074', '75000000-0000-4000-8000-000000000075']::uuid[]) u)
         = array['74000000-0000-4000-8000-000000000074', '72000000-0000-4000-8000-000000000072', '75000000-0000-4000-8000-000000000075',
                 '73000000-0000-4000-8000-000000000073', '71000000-0000-4000-8000-000000000071']::uuid[], 'SQL ir JS tvarka skiriasi';
end $$;
\echo '   ok'
