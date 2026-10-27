-- 0005–0006 testai: limitai, patikimumas, laimikio laukai, paslėpta lentelė, kvietimai,
-- ginčai, moderatoriai, paskyros ištrynimas. Paleidžiama po test_schema.sql (tests/db/run.sh).
\set ON_ERROR_STOP 1
\set QUIET 1

insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444', 'c@test.lt'),
  ('55555555-5555-5555-5555-555555555555', 'd@test.lt'),
  ('66666666-6666-6666-6666-666666666666', 'm2@test.lt');
update public.profiles set is_admin = false where id <> '66666666-6666-6666-6666-666666666666';
update public.profiles set roles = array['owner'] where id = '66666666-6666-6666-6666-666666666666';  -- 0014: savininkas

create function pg_temp.c(p_len int, p_captured timestamptz)
returns uuid language plpgsql as $$
declare v_id uuid; v_client uuid := gen_random_uuid();
begin
  insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
  values (v_client, 1, p_len, p_captured, auth.uid()::text || '/' || v_client::text || '.jpg',
          encode(digest(v_client::text, 'sha256'), 'hex'))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function pg_temp.c(int, timestamptz) to authenticated;
create temp table x (k text primary key, id uuid);
grant select, insert, update on x to authenticated, anon;

-- ---------------------------------------------------------------
\echo 'F1. Laimikių limitas: 50 per parą'
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  for i in 1..50 loop perform pg_temp.c(500 + i, now() - interval '1 hour'); end loop;
  begin
    perform pg_temp.c(999, now());
    raise exception 'FAIL: 51-as laimikis priimtas';
  exception when raise_exception then
    if sqlerrm <> 'catch_limit' then raise; end if;
  end;
end $$;
reset role;
delete from public.catches where user_id = '44444444-4444-4444-4444-444444444444';

-- ---------------------------------------------------------------
\echo 'F2. Turnyrų limitas: 10 per parą; sukūrimo laiko ir organizatoriaus pakeisti negalima'
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  for i in 1..10 loop
    insert into public.tournaments (title, format, starts_at, ends_at)
    values ('Limitas ' || i, 'biggest', now() + interval '1 day', now() + interval '2 days');
  end loop;
  begin
    insert into public.tournaments (title, format, starts_at, ends_at)
    values ('Per daug', 'biggest', now() + interval '1 day', now() + interval '2 days');
    raise exception 'FAIL: 11-as turnyras priimtas';
  exception when raise_exception then
    if sqlerrm <> 'tournament_limit' then raise; end if;
  end;
  update public.tournaments set created_at = now() + interval '1 year',
         organizer_id = '55555555-5555-5555-5555-555555555555', title = 'Pakeista'
   where title = 'Limitas 1';
  assert (select organizer_id from public.tournaments where title = 'Pakeista') = '44444444-4444-4444-4444-444444444444',
    'organizatorius pakeistas';
  assert (select created_at from public.tournaments where title = 'Pakeista') < now() + interval '1 minute',
    'sukūrimo laikas pakeistas';
end $$;
reset role;
delete from public.tournaments where organizer_id = '44444444-4444-4444-4444-444444444444';

-- ---------------------------------------------------------------
\echo 'F3. Turnyras T (paslėpta lentelė) ir P (privatus)'
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
insert into public.tournaments (id, title, format, starts_at, ends_at, leaderboard_hidden)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'Paslėpta', 'biggest', now() + interval '1 hour', now() + interval '2 days', true);
insert into public.tournaments (id, title, format, starts_at, ends_at, visibility)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'Privatus', 'biggest', now() + interval '1 hour', now() + interval '2 days', 'private');
insert into public.entries (tournament_id) values ('bbbbbbbb-0000-0000-0000-000000000001');
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
insert into public.entries (tournament_id) values ('bbbbbbbb-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.tournaments where id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0,
    'D mato privatų turnyrą neprisijungęs';
  begin
    insert into public.entries (tournament_id) values ('bbbbbbbb-0000-0000-0000-000000000002');
    raise exception 'FAIL: D užsiregistravo į privatų be kodo';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.tournaments set starts_at = now() - interval '1 day'
 where id in ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');
update public.entries set joined_at = now() - interval '2 days'
 where tournament_id in ('bbbbbbbb-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------
\echo 'F4. Laimikiai, patikimumas ir laukai'
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
insert into x values ('c1', pg_temp.c(800, now() - interval '2 hours'));
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
insert into x values ('d1', pg_temp.c(700, now() - interval '3 hours'));
insert into x values ('d2', pg_temp.c(650, now() - interval '3 hours'));
insert into x values ('d3', pg_temp.c(600, now() - interval '3 hours'));
do $$ begin
  -- masalas ir pastabos – galima; ilgis, būsena – ne
  update public.catches set bait = 'Vobleris', notes = 'Rytas, ramu' where id = (select id from x where k = 'd1');
  assert (select bait from public.my_catch_notes() where id = (select id from x where k = 'd1')) = 'Vobleris', 'masalas neįsirašė';
  -- masalas ir pastabos – privatūs: tiesiogiai skaityti negali niekas (net savininkas – tik per funkciją)
  begin
    perform bait from public.catches limit 1;
    raise exception 'FAIL: bait stulpelis skaitomas tiesiogiai';
  exception when insufficient_privilege then null; end;
  begin
    update public.catches set length_mm = 990 where id = (select id from x where k = 'd1');
    raise exception 'FAIL: pakeistas ilgis';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256, weather)
    values (gen_random_uuid(), 1, 500, now(), auth.uid()::text || '/w.jpg', repeat('e', 64), '[1,2]'::jsonb);
    raise exception 'FAIL: priimtas blogas oras';
  exception when check_violation then null; end;
end $$;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ declare n int; begin
  update public.catches set bait = 'svetimas' where id = (select id from x where k = 'd1');
  get diagnostics n = row_count;
  assert n = 0, 'C pakeitė D laimikio masalą';
end $$;
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select public.review_catch((select id from x where k = 'c1'), true);
select public.review_catch((select id from x where k = 'd1'), true);
select public.review_catch((select id from x where k = 'd2'), false, 'Nesimato matavimo');
select public.review_catch((select id from x where k = 'd1'), true);  -- pakartotinis – reitingas nesikeičia
reset role;
do $$ begin
  assert (select trust_score from public.profiles where id = '55555555-5555-5555-5555-555555555555') = 46,
    format('D patikimumas %s, tikėtasi 46', (select trust_score from public.profiles where id = '55555555-5555-5555-5555-555555555555'));
end $$;

-- ---------------------------------------------------------------
\echo 'F5. Paslėpta lentelė'
set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$ declare r record; n int := 0; begin
  for r in select * from public.leaderboard('bbbbbbbb-0000-0000-0000-000000000001') loop
    n := n + 1;
    assert r.user_id = '55555555-5555-5555-5555-555555555555' and r.rank is null and r.score_mm = 700,
      format('D mato ne tik save: %s', row_to_json(r));
  end loop;
  assert n = 1, format('D turi matyti tik save, gauta %s', n);
end $$;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert (select count(*) from public.leaderboard('bbbbbbbb-0000-0000-0000-000000000001')) = 2, 'organizatorius turi matyti visus';
end $$;
reset role;
set role anon;
reset request.jwt.claim.sub;
do $$ begin
  assert (select count(*) from public.leaderboard('bbbbbbbb-0000-0000-0000-000000000001')) = 0, 'anon mato paslėptą lentelę';
end $$;
reset role;
update public.tournaments set ends_at = now() - interval '1 minute' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$ begin
  assert (select count(*) from public.leaderboard('bbbbbbbb-0000-0000-0000-000000000001')) = 2, 'po pabaigos lentelė turi atsiverti';
  assert (select rank from public.leaderboard('bbbbbbbb-0000-0000-0000-000000000001')
           where user_id = '44444444-4444-4444-4444-444444444444') = 1, 'C turi būti pirmas';
end $$;
reset role;

-- ---------------------------------------------------------------
\echo 'F6. Kvietimai į privatų turnyrą'
create temp table codes as select invite_code as code from public.tournaments where id = 'bbbbbbbb-0000-0000-0000-000000000002';
grant select on codes to authenticated, anon;
set role anon;
do $$ begin
  assert (select invite_code from public.tournaments where id = 'bbbbbbbb-0000-0000-0000-000000000002') is null,
    'anon mato privataus turnyro kodą';
  assert (select count(*) from public.get_invite((select code from codes))) = 1, 'anon nemato kvietimo peržiūros';
  begin
    perform public.join_with_invite((select code from codes));
    raise exception 'FAIL: anon prisijungė';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$ declare v_code text := (select code from codes); v_id uuid; begin
  assert length(v_code) = 10, 'kodo ilgis';
  assert (select count(*) from public.get_invite(upper(v_code))) = 1, 'kvietimo peržiūra neveikia';
  v_id := public.join_with_invite(' ' || v_code || ' ');
  assert v_id = 'bbbbbbbb-0000-0000-0000-000000000002', 'prisijungta ne prie to turnyro';
  perform public.join_with_invite(v_code); -- pakartotinai – be klaidos
  assert (select count(*) from public.tournaments where id = 'bbbbbbbb-0000-0000-0000-000000000002') = 1,
    'prisijungęs D nemato privataus turnyro';
  begin
    perform public.join_with_invite('neteisingas');
    raise exception 'FAIL: priimtas neteisingas kodas';
  exception when raise_exception then
    if sqlerrm <> 'invite_invalid' then raise; end if;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------
\echo 'F7. Ginčai'
set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$ begin
  insert into public.disputes (catch_id, message, status) values ((select id from x where k = 'd2'), '  Matuoklė matosi antroje nuotraukos pusėje  ', 'accepted');
  assert (select status from public.disputes where catch_id = (select id from x where k = 'd2')) = 'open', 'statusas nustatytas klientu';
  begin
    insert into public.disputes (catch_id, message) values ((select id from x where k = 'd1'), 'Patvirtintas, bet ginčiju');
    raise exception 'FAIL: ginčas dėl patvirtinto laimikio';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.disputes (catch_id, message) values ((select id from x where k = 'd2'), 'Antras ginčas');
    raise exception 'FAIL: du ginčai dėl to paties';
  exception when unique_violation then null; end;
  begin
    update public.disputes set status = 'accepted';
    raise exception 'FAIL: dalyvis pakeitė ginčą';
  exception when insufficient_privilege then null; end;
  begin
    perform public.resolve_dispute((select id from public.disputes limit 1), true, null);
    raise exception 'FAIL: dalyvis išsprendė ginčą';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
do $$ begin
  assert (select count(*) from public.disputes) = 0, 'C mato D ginčą';
  begin
    insert into public.disputes (catch_id, message) values ((select id from x where k = 'd2'), 'Ne mano laimikis');
    raise exception 'FAIL: C ginčija D laimikį';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select public.resolve_dispute((select id from public.disputes where catch_id = (select id from x where k = 'd2')), true, 'Teisingai, matuoklė matosi');
do $$ begin
  assert (select status from public.catches where id = (select id from x where k = 'd2')) = 'approved', 'laimikis nepatvirtintas po ginčo';
  begin
    perform public.resolve_dispute((select id from public.disputes limit 1), false, null);
    raise exception 'FAIL: išspręstas du kartus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  assert (select trust_score from public.profiles where id = '55555555-5555-5555-5555-555555555555') = 51,
    'patikimumas negrąžintas po ginčo';
end $$;

-- ---------------------------------------------------------------
\echo 'F8. Moderatorių skyrimas'
update public.profiles set nickname = 'Dzveja' where id = '55555555-5555-5555-5555-555555555555';
set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$ begin
  begin
    perform public.set_moderator('Dzveja', true);
    raise exception 'FAIL: ne moderatorius paskyrė save';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select public.set_moderator('dzveja', true);
do $$ begin
  assert (select is_admin from public.profiles where id = '55555555-5555-5555-5555-555555555555'), 'nepaskirtas';
end $$;
select public.set_moderator('Dzveja', false);
do $$ declare v text; begin
  v := (select nickname from public.profiles where id = '66666666-6666-6666-6666-666666666666');
  begin
    perform public.set_moderator(v, false);
    raise exception 'FAIL: atimtos savininko teisės';
  exception when raise_exception then
    if sqlerrm <> 'role_owner' then raise; end if;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------
\echo 'F9. Paskyros ištrynimas'
insert into storage.objects (bucket_id, name) values
  ('catch-photos', '55555555-5555-5555-5555-555555555555/a.jpg'),
  ('catch-photos', '44444444-4444-4444-4444-444444444444/b.jpg');
set role authenticated;
set request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
do $$ declare n int; begin
  delete from storage.objects where name = '55555555-5555-5555-5555-555555555555/a.jpg';
  get diagnostics n = row_count;
  assert n = 0, 'nuotrauka ištrinta neprasidėjus ištrynimui';
  begin
    perform public.finish_account_deletion();
    raise exception 'FAIL: baigta nepradėjus';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.begin_account_deletion();
  assert (select count(*) from public.catches where user_id = auth.uid()) = 0, 'laimikiai liko';
  assert (select count(*) from public.entries where user_id = auth.uid()) = 0, 'registracijos liko';
  delete from storage.objects where name like '%.jpg';
  get diagnostics n = row_count;
  assert n = 1, format('ištrinta %s nuotraukų, tikėtasi 1 (tik savos)', n);
  perform public.finish_account_deletion();
end $$;
reset role;
do $$ begin
  assert (select count(*) from auth.users where id = '55555555-5555-5555-5555-555555555555') = 0, 'vartotojas liko';
  assert (select count(*) from public.profiles where id = '55555555-5555-5555-5555-555555555555') = 0, 'profilis liko';
  assert (select count(*) from storage.objects where name = '44444444-4444-4444-4444-444444444444/b.jpg') = 1, 'ištrinta svetima nuotrauka';
  assert (select count(*) from public.catches where id = (select id from x where k = 'c1')) = 1, 'ištrintas svetimas laimikis';
end $$;

-- Moderatorius, peržiūrėjęs kitų laimikius, taip pat gali ištrinti paskyrą.
set role authenticated;
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select public.begin_account_deletion();
select public.finish_account_deletion();
reset role;
do $$ begin
  assert (select reviewed_by from public.catches where id = (select id from x where k = 'c1')) is null, 'liko nuoroda į ištrintą moderatorių';
end $$;

\echo 'VISI FUNKCIJŲ TESTAI PRAĖJO'
