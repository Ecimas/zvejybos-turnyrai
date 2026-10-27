-- 0010: pranešimai apie laimikius, „Nieko nekibo“ išvykos, organizatoriaus pranešimai.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'C1. Pranešimas apie įtartiną laimikį'

insert into auth.users (id, email) values
  ('a1000000-0000-4000-8000-0000000000a1', 'savininkas@test.lt'),
  ('a2000000-0000-4000-8000-0000000000a2', 'pranesejas@test.lt'),
  ('a3000000-0000-4000-8000-0000000000a3', 'moder@test.lt');
update public.profiles set is_admin = true where id = 'a3000000-0000-4000-8000-0000000000a3';
create temp table cx (k text primary key, id uuid);
grant select, insert on cx to authenticated, anon;

-- Savininko laimikiai: patvirtintas ir laukiantis
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-0000000000a1';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 900, now() - interval '1 hour', 'a1000000-0000-4000-8000-0000000000a1/x1.jpg', repeat('c1', 32)) returning id)
insert into cx select 'approved', id from c;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 800, now() - interval '1 hour', 'a1000000-0000-4000-8000-0000000000a1/x2.jpg', repeat('c2', 32)) returning id)
insert into cx select 'pending', id from c;
set request.jwt.claim.sub = 'a3000000-0000-4000-8000-0000000000a3';
select public.review_catch((select id from cx where k = 'approved'), true, null);
reset request.jwt.claim.sub;

set role authenticated;
set request.jwt.claim.sub = 'a2000000-0000-4000-8000-0000000000a2';
do $$ declare n int; begin
  insert into public.catch_reports (catch_id, reason, message, reporter_id, status)
  select id, 'old_photo', '  Ta pati nuotrauka buvo Facebook  ', 'a1000000-0000-4000-8000-0000000000a1', 'upheld' from cx where k = 'approved';
  assert (select reporter_id from public.catch_reports limit 1) = 'a2000000-0000-4000-8000-0000000000a2', 'pranešėjas suklastotas';
  assert (select status from public.catch_reports limit 1) = 'open', 'būsena suklastota';
  assert (select message from public.catch_reports limit 1) = 'Ta pati nuotrauka buvo Facebook', 'žinutė neapkarpyta';
  begin
    insert into public.catch_reports (catch_id, reason) select id, 'other' from cx where k = 'approved';
    raise exception 'FAIL: antras pranešimas apie tą patį laimikį';
  exception when unique_violation then null; end;
  begin
    insert into public.catch_reports (catch_id, reason) select id, 'other' from cx where k = 'pending';
    raise exception 'FAIL: pranešimas apie nepatvirtintą (nematomą) laimikį';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.catch_reports (catch_id, reason) select id, 'hack' from cx where k = 'approved';
    raise exception 'FAIL: neleistina priežastis';
  exception when check_violation or unique_violation then null; end;
  begin
    update public.catch_reports set status = 'dismissed';
    raise exception 'FAIL: pranešėjas pakeitė būseną';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Savininkas apie save pranešti negali ir svetimų pranešimų nemato
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-0000000000a1';
do $$ begin
  begin
    insert into public.catch_reports (catch_id, reason) select id, 'other' from cx where k = 'approved';
    raise exception 'FAIL: pranešė apie savo laimikį';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.catch_reports) = 0, 'savininkas mato, kas apie jį pranešė';
  begin
    perform public.resolve_report((select id from public.catch_reports limit 1), false, null);
    raise exception 'FAIL: ne moderatorius sprendė';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;

-- Moderatorius pripažįsta pagrįstu: laimikis atmetamas, patikimumas −5, pranešimai uždaromi
set role authenticated;
set request.jwt.claim.sub = 'a3000000-0000-4000-8000-0000000000a3';
do $$ declare trust0 int; begin
  select trust_score into trust0 from public.profiles where id = 'a1000000-0000-4000-8000-0000000000a1';
  begin
    perform public.resolve_report((select id from public.catch_reports limit 1), true, '  ');
    raise exception 'FAIL: atmesta be priežasties';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  perform public.resolve_report((select id from public.catch_reports limit 1), true, 'Sena nuotrauka');
  assert (select status from public.catches where id = (select id from cx where k = 'approved')) = 'rejected', 'laimikis neatmestas';
  assert (select reject_reason from public.catches where id = (select id from cx where k = 'approved')) = 'Sena nuotrauka';
  assert (select trust_score from public.profiles where id = 'a1000000-0000-4000-8000-0000000000a1') = trust0 - 5, 'patikimumas nesumažėjo';
  assert (select status from public.catch_reports limit 1) = 'upheld';
  begin
    perform public.resolve_report((select id from public.catch_reports limit 1), false, null);
    raise exception 'FAIL: išspręstas pranešimas sprendžiamas dar kartą';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
end $$;
reset role;
\echo '   ok'

\echo 'C2. „Nieko nekibo“ išvykos – privačios'
set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-0000000000a1';
insert into public.blank_trips (trip_date, hours, notes, user_id) values (current_date, 3.5, 'Vėjas, banga', 'a2000000-0000-4000-8000-0000000000a2');
do $$ begin
  assert (select user_id from public.blank_trips limit 1) = 'a1000000-0000-4000-8000-0000000000a1', 'savininkas suklastotas';
  begin
    insert into public.blank_trips (trip_date) values (current_date + 5);
    raise exception 'FAIL: išvyka ateityje';
  exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  begin
    insert into public.blank_trips (trip_date, hours) values (current_date, 30);
    raise exception 'FAIL: 30 valandų per parą';
  exception when check_violation then null; end;
  begin
    update public.blank_trips set hours = 1;
    raise exception 'FAIL: pakeista išvyka';
  exception when insufficient_privilege then null; end;
  for i in 2..10 loop insert into public.blank_trips (trip_date) values (current_date); end loop;
  begin
    insert into public.blank_trips (trip_date) values (current_date);
    raise exception 'FAIL: 11-a išvyka per parą';
  exception when raise_exception then if sqlerrm <> 'trip_limit' then raise; end if; end;
  delete from public.blank_trips where notes is null;
  assert (select count(*) from public.blank_trips) = 1, 'savininkas negali ištrinti savo įrašų';
end $$;
set request.jwt.claim.sub = 'a2000000-0000-4000-8000-0000000000a2';
do $$ declare n int; begin
  assert (select count(*) from public.blank_trips) = 0, 'kitas mato svetimas išvykas';
  delete from public.blank_trips;
  get diagnostics n = row_count;
  assert n = 0, 'kitas ištrynė svetimą išvyką';
end $$;
reset role;
set role anon;
reset request.jwt.claim.sub;
do $$ begin
  assert (select count(*) from public.blank_trips) = 0, 'neprisijungęs mato išvykas';
end $$;
reset role;
\echo '   ok'

\echo 'C3. Organizatoriaus pranešimai'
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-0000000000a1';
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at)
           values ('a1000000-0000-4000-8000-0000000000a1', 'Pranešimų taurė', 'biggest', now() + interval '1 day', now() + interval '2 days') returning id)
insert into cx select 'pub', id from t;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility)
           values ('a1000000-0000-4000-8000-0000000000a1', 'Slapti pranešimai', 'biggest', now() + interval '1 day', now() + interval '2 days', 'private') returning id)
insert into cx select 'priv', id from t;
reset request.jwt.claim.sub;

set role authenticated;
set request.jwt.claim.sub = 'a1000000-0000-4000-8000-0000000000a1';
insert into public.tournament_announcements (tournament_id, message, author_id)
select id, '  Startas 6 val., nepamirškite liniuotės  ', 'a2000000-0000-4000-8000-0000000000a2' from cx where k = 'pub';
insert into public.tournament_announcements (tournament_id, message) select id, 'Slapta žinia' from cx where k = 'priv';
do $$ begin
  assert (select author_id from public.tournament_announcements where message like 'Startas%') = 'a1000000-0000-4000-8000-0000000000a1', 'autorius suklastotas';
  assert (select message from public.tournament_announcements where message like 'Startas%') = 'Startas 6 val., nepamirškite liniuotės', 'neapkarpyta';
  begin
    update public.tournament_announcements set message = 'pakeista';
    raise exception 'FAIL: pakeistas pranešimas';
  exception when insufficient_privilege then null; end;
  for i in 2..10 loop
    insert into public.tournament_announcements (tournament_id, message) select id, 'Žinia ' || i from cx where k = 'pub';
  end loop;
  begin
    insert into public.tournament_announcements (tournament_id, message) select id, 'Per daug' from cx where k = 'pub';
    raise exception 'FAIL: 11-as pranešimas per parą';
  exception when raise_exception then if sqlerrm <> 'announcement_limit' then raise; end if; end;
  delete from public.tournament_announcements where message like 'Žinia%';
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'a2000000-0000-4000-8000-0000000000a2';
do $$ declare n int; begin
  begin
    insert into public.tournament_announcements (tournament_id, message) select id, 'Ne organizatorius' from cx where k = 'pub';
    raise exception 'FAIL: ne organizatorius parašė pranešimą';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.tournament_announcements) = 1, 'viešo turnyro pranešimas turi matytis, privataus – ne';
  delete from public.tournament_announcements;
  get diagnostics n = row_count;
  assert n = 0, 'svetimas ištrynė pranešimą';
end $$;
reset role;
set role anon;
reset request.jwt.claim.sub;
do $$ begin
  assert (select count(*) from public.tournament_announcements) = 1, 'neprisijungęs turi matyti viešo turnyro pranešimą';
end $$;
reset role;
\echo 'C4. Paskyrų ištrynimas su visais duomenų tipais (0006c + 0009 + 0010)'
-- a1: laimikiai, pranešimai apie juos, organizuoja turnyrus su pranešimais; a2: pranešėjas, išvykos; a3: moderatorius.
do $$ declare u uuid; begin
  foreach u in array array['a1000000-0000-4000-8000-0000000000a1', 'a2000000-0000-4000-8000-0000000000a2',
                           'a3000000-0000-4000-8000-0000000000a3']::uuid[] loop
    perform set_config('request.jwt.claim.sub', u::text, true);
    perform public.begin_account_deletion();
    perform public.finish_account_deletion();
    assert not exists (select 1 from auth.users where id = u), format('paskyra %s neištrinta', u);
  end loop;
  assert not exists (select 1 from public.catch_reports), 'liko pranešimų';
  assert not exists (select 1 from public.blank_trips where user_id = 'a2000000-0000-4000-8000-0000000000a2'), 'liko išvykų';
  assert not exists (select 1 from public.tournament_announcements where author_id = 'a1000000-0000-4000-8000-0000000000a1'), 'liko organizatoriaus pranešimų';
  assert not exists (select 1 from public.tournaments where organizer_id = 'a1000000-0000-4000-8000-0000000000a1'), 'liko turnyrų';
end $$;
reset request.jwt.claim.sub;
\echo 'VISI BENDRUOMENĖS TESTAI PRAĖJO'
