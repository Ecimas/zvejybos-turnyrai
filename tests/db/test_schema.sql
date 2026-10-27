-- Schemos ir teisių testai. Paleidžiama: tests/db/run.sh
\set ON_ERROR_STOP 1
\set QUIET 1

-- Vartotojai: A ir B – žvejai, M – moderatorius.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.lt'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.lt'),
  ('33333333-3333-3333-3333-333333333333', 'm@test.lt');
update public.profiles set is_admin = true where id = '33333333-3333-3333-3333-333333333333';

-- Pagalbinė funkcija testams: įkelia laimikį kaip dabartinis vartotojas.
create function pg_temp.add_catch(p_species text, p_len int, p_captured timestamptz)
returns uuid language plpgsql as $$
declare v_id uuid; v_client uuid := gen_random_uuid();
begin
  insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
  values (v_client,
          (select id from public.species where code = p_species),
          p_len, p_captured,
          auth.uid()::text || '/' || v_client::text || '.jpg',
          encode(digest(v_client::text, 'sha256'), 'hex'))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function pg_temp.add_catch(text, int, timestamptz) to authenticated;

-- ---------------------------------------------------------------
\echo '1. Profilis sukuriamas automatiškai'
do $$ begin
  assert (select count(*) from public.profiles) = 3, 'profiliai nesukurti';
  assert (select nickname from public.profiles where id = '11111111-1111-1111-1111-111111111111') like 'zvejys_%', 'blogas slapyvardis';
end $$;

-- ---------------------------------------------------------------
\echo '2. A sukuria turnyrą, A ir B užsiregistruoja'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.tournaments (id, title, format, top_n, min_length_mm, starts_at, ends_at)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Rudens lydekų taurė', 'top_n_sum', 3, 500,
        now() + interval '1 hour', now() + interval '3 days');
insert into public.tournament_species (tournament_id, species_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', (select id from public.species where code = 'lydeka'));
insert into public.entries (tournament_id) values ('aaaaaaaa-0000-0000-0000-000000000001');
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into public.entries (tournament_id) values ('aaaaaaaa-0000-0000-0000-000000000001');
-- Turnyras, prasidedantis „dabar“: rūšis vis tiek galima priskirti iškart po sukūrimo.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into public.tournaments (id, title, format, starts_at, ends_at)
values ('aaaaaaaa-0000-0000-0000-000000000002', 'Dabar', 'biggest', now() - interval '2 minutes', now() + interval '1 day');
insert into public.tournament_species (tournament_id, species_id) values ('aaaaaaaa-0000-0000-0000-000000000002', 1);
reset role;
delete from public.tournaments where id = 'aaaaaaaa-0000-0000-0000-000000000002';
-- Turnyras „prasideda“: perkeliam pradžią į praeitį.
update public.tournaments set starts_at = now() - interval '1 day'
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- Registruotasi iki starto (0012: įskaitoma tik po prisijungimo pagauta).
update public.entries set joined_at = now() - interval '2 days'
 where tournament_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------
\echo '3. Laimikiai'
create temp table ids (label text primary key, id uuid);
grant select, insert on ids to authenticated;
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into ids values
  ('b780', pg_temp.add_catch('lydeka', 780, now() - interval '20 hours')),
  ('b710', pg_temp.add_catch('lydeka', 710, now() - interval '19 hours')),
  ('b730', pg_temp.add_catch('lydeka', 730, now() - interval '18 hours')),
  ('b700', pg_temp.add_catch('lydeka', 700, now() - interval '17 hours')),
  ('b400', pg_temp.add_catch('lydeka', 400, now() - interval '16 hours')),
  ('b_starkis', pg_temp.add_catch('starkis', 950, now() - interval '15 hours')),
  ('b_future', pg_temp.add_catch('lydeka', 990, now() + interval '2 hours')),
  ('b_before', pg_temp.add_catch('lydeka', 980, now() - interval '2 days')),
  ('b_pending', pg_temp.add_catch('lydeka', 970, now() - interval '1 hour'));
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
insert into ids values ('a820', pg_temp.add_catch('lydeka', 820, now() - interval '10 hours'));
insert into public.catch_locations (catch_id, lat, lng, accuracy_m)
  select id, 54.9, 23.9, 6 from ids where label = 'a820';
reset role;

do $$ begin
  assert (select count(*) from public.catches where status = 'pending') = 10, 'visi nauji turi būti pending';
end $$;

-- ---------------------------------------------------------------
\echo '4. Moderatorius patvirtina (išskyrus b_pending)'
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select public.review_catch(id, true) from ids where label <> 'b_pending';
reset role;

-- ---------------------------------------------------------------
\echo '5. Lentelė: B = 780+730+710 = 2220, A = 820'
set role anon;
reset request.jwt.claim.sub;
do $$
declare r record; n int := 0;
begin
  for r in select * from public.leaderboard('aaaaaaaa-0000-0000-0000-000000000001') loop
    n := n + 1;
    if n = 1 then
      assert r.user_id = '22222222-2222-2222-2222-222222222222' and r.score_mm = 2220 and r.counted = 3 and r.rank = 1,
        format('1 vieta bloga: %s', row_to_json(r));
    elsif n = 2 then
      assert r.user_id = '11111111-1111-1111-1111-111111111111' and r.score_mm = 820 and r.counted = 1 and r.rank = 2,
        format('2 vieta bloga: %s', row_to_json(r));
    end if;
  end loop;
  assert n = 2, format('tikėtasi 2 eilučių, gauta %s', n);
end $$;
reset role;

-- ---------------------------------------------------------------
\echo '6. Formatas „didžiausia žuvis“'
update public.tournaments set format = 'biggest' where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  assert (select score_mm from public.leaderboard('aaaaaaaa-0000-0000-0000-000000000001')
           where user_id = '11111111-1111-1111-1111-111111111111') = 820, 'A turi būti 820';
  assert (select rank from public.leaderboard('aaaaaaaa-0000-0000-0000-000000000001')
           where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'A turi būti pirmas';
end $$;
update public.tournaments set format = 'top_n_sum' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------
\echo '7. B nemato A koordinačių, bet mato patvirtintą A laimikį'
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  assert (select count(*) from public.catch_locations) = 0, 'B mato svetimas koordinates!';
  assert (select count(*) from public.catches where user_id = '11111111-1111-1111-1111-111111111111') = 1, 'B turi matyti A patvirtintą laimikį';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$ begin
  assert (select count(*) from public.catches where user_id = '22222222-2222-2222-2222-222222222222' and status = 'pending') = 0,
    'A mato svetimą nepatvirtintą laimikį!';
  assert (select count(*) from public.catch_locations) = 1, 'A turi matyti savo koordinates';
end $$;
reset role;

-- ---------------------------------------------------------------
\echo '8. Draudžiami veiksmai'
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  begin
    update public.catches set status = 'approved' where status = 'pending';
    raise exception 'FAIL: B pakeitė laimikio statusą';
  exception when insufficient_privilege then null; end;

  begin
    perform public.review_catch((select id from public.catches where status = 'pending' limit 1), true);
    raise exception 'FAIL: B patvirtino laimikį';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  begin
    update public.profiles set is_admin = true where id = auth.uid();
    raise exception 'FAIL: B tapo moderatoriumi';
  exception when insufficient_privilege then null; end;

  begin
    insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
    values (gen_random_uuid(), 1, 600, now(),
            '11111111-1111-1111-1111-111111111111/svetima.jpg', repeat('a', 64));
    raise exception 'FAIL: B įkėlė nuotrauką į A aplanką';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  begin
    insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
    values (gen_random_uuid(), 1, 600, now(),
            auth.uid()::text || '/kopija.jpg',
            (select photo_sha256 from public.catches where user_id = '11111111-1111-1111-1111-111111111111' limit 1));
    raise exception 'FAIL: priimta pakartotinė nuotrauka';
  exception when unique_violation then null; end;

  begin
    delete from public.catches where user_id = auth.uid();
    raise exception 'FAIL: B ištrynė laimikį';
  exception when insufficient_privilege then null; end;
end $$;

-- Bandymas iš karto įkelti „patvirtintą“ laimikį – statusas priverstinai pending.
insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256, status)
values ('99999999-0000-0000-0000-000000000001', 1, 650, now(),
        '22222222-2222-2222-2222-222222222222/x.jpg', repeat('b', 64), 'approved');
do $$ begin
  assert (select status from public.catches where client_id = '99999999-0000-0000-0000-000000000001') = 'pending',
    'klientas sugebėjo nustatyti statusą';
end $$;

-- Pakartotinis to paties client_id siuntimas (offline eilė) nesukuria dublio.
do $$ begin
  begin
    insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
    values ('99999999-0000-0000-0000-000000000001', 1, 650, now(),
            '22222222-2222-2222-2222-222222222222/x2.jpg', repeat('c', 64));
    raise exception 'FAIL: dublis priimtas';
  exception when unique_violation then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------
\echo '9. Nuotraukų saugykla'
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
insert into storage.objects (bucket_id, name) values ('catch-photos', '22222222-2222-2222-2222-222222222222/ok.jpg');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('catch-photos', '11111111-1111-1111-1111-111111111111/blogai.jpg');
    raise exception 'FAIL: įkelta į svetimą aplanką';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- ---------------------------------------------------------------
\echo '10. Senų vietų valymas po 90 dienų'
-- a820 vieta: laimikis šviežias -> lieka. Pasendinam laimikį ir turnyrą.
do $$
declare n int;
begin
  n := public.purge_old_locations();
  assert n = 0 and (select count(*) from public.catch_locations) = 1, 'ištrinta per anksti';

  -- Laimikis senas, bet turnyras baigėsi prieš 30 d. -> vis dar saugoma.
  update public.tournaments set starts_at = now() - interval '130 days', ends_at = now() - interval '30 days'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  update public.catches set captured_at_device = now() - interval '100 days'
   where user_id = '11111111-1111-1111-1111-111111111111';
  n := public.purge_old_locations();
  assert n = 0 and (select count(*) from public.catch_locations) = 1, 'ištrinta, nors turnyras baigėsi < 90 d.';

  -- Turnyras baigėsi prieš 95 d. -> ištrinama.
  update public.tournaments set starts_at = now() - interval '150 days', ends_at = now() - interval '95 days'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  n := public.purge_old_locations();
  assert n = 1 and (select count(*) from public.catch_locations) = 0, 'sena vieta neištrinta';
end $$;

set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$ begin
  begin
    perform public.purge_old_locations();
    raise exception 'FAIL: vartotojas gali kviesti valymą';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo 'VISI TESTAI PRAĖJO'
