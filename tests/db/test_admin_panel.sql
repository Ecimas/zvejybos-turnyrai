-- 0031: administravimo panelė – jungikliai, žurnalas, skelbimas, sargai naujam turiniui.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'A1. Jungikliai ir žurnalas'

insert into auth.users (id, email) values
  ('95000000-0000-4000-8000-000000000095', 'ap-own@test.lt'),
  ('96000000-0000-4000-8000-000000000096', 'ap-usr@test.lt'),
  ('97000000-0000-4000-8000-000000000097', 'ap-two@test.lt');
update public.profiles set nickname = v.n
  from (values ('95000000-0000-4000-8000-000000000095'::uuid, 'Ap_Own'), ('96000000-0000-4000-8000-000000000096', 'Ap_Usr'),
               ('97000000-0000-4000-8000-000000000097', 'Ap_Two')) v(id, n)
 where profiles.id = v.id;
update public.profiles set roles = array['owner'] where id = '95000000-0000-4000-8000-000000000095';

do $$ begin
  assert (select count(*) from public.app_features where key in ('leagues', 'duels', 'social_follow', 'weather', 'blank_trips')) = 5, 'trūksta naujų jungiklių';
end $$;

-- Paprastas vartotojas negali nei keisti, nei matyti žurnalo
set role authenticated;
set request.jwt.claim.sub = '96000000-0000-4000-8000-000000000096';
do $$ begin
  begin
    perform public.set_feature('leagues', false);
    raise exception 'FAIL: paprastas vartotojas išjungė funkciją';
  exception when raise_exception then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;
  begin
    perform public.set_banner('Sveiki visi', 'info');
    raise exception 'FAIL: paprastas vartotojas pakeitė skelbimą';
  exception when raise_exception then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;
  begin
    update public.app_banner set body = 'Įsilaužėlis' where id = 1;
    raise exception 'FAIL: tiesioginis skelbimo keitimas';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- Savininkas išjungia: įrašas žurnale, pakartotinis išjungimas – be naujo įrašo
set role authenticated;
set request.jwt.claim.sub = '95000000-0000-4000-8000-000000000095';
select public.set_feature('leagues', false);
select public.set_feature('leagues', false);
select public.set_feature('duels', false);
select public.set_feature('social_follow', false);
select public.set_feature('blank_trips', false);
do $$ begin
  assert (select count(*) from public.app_feature_log where key = 'leagues') = 1, 'pakartotinis išjungimas įrašytas';
  assert (select updated_by from public.app_features where key = 'leagues') = '95000000-0000-4000-8000-000000000095', 'neįrašyta, kas pakeitė';
  begin
    perform public.set_feature('nera_tokios', true);
    raise exception 'FAIL: neegzistuojanti funkcija';
  exception when raise_exception then
    if sqlerrm not like '%feature not found%' then raise; end if;
  end;
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = '96000000-0000-4000-8000-000000000096';
do $$ begin
  assert (select count(*) from public.app_feature_log) = 0, 'paprastas vartotojas mato žurnalą';
  assert (select enabled from public.app_features where key = 'leagues') = false, 'jungiklio būsena nematoma';
end $$;
reset role;

\echo 'A2. Sargai: išjungus negalima kurti naujo'
set role authenticated;
set request.jwt.claim.sub = '96000000-0000-4000-8000-000000000096';
do $$ begin
  begin
    insert into public.leagues (name, season) values ('Išjungta lyga', 2026);
    raise exception 'FAIL: sukurta lyga, kai išjungta';
  exception when raise_exception then
    if sqlerrm not like '%feature_off%' then raise; end if;
  end;
  begin
    insert into public.follows (followee_id) values ('97000000-0000-4000-8000-000000000097');
    raise exception 'FAIL: sekimas, kai išjungta';
  exception when raise_exception then
    if sqlerrm not like '%feature_off%' then raise; end if;
  end;
  begin
    insert into public.blank_trips (trip_date) values (current_date);
    raise exception 'FAIL: „nieko nekibo“, kai išjungta';
  exception when raise_exception then
    if sqlerrm not like '%feature_off%' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  begin
    insert into public.tournaments (organizer_id, title, format, top_n, starts_at, ends_at, invite_code)
    values ('96000000-0000-4000-8000-000000000096', 'Dvikovos išjungtos', 'duels', 1, now() + interval '1 day', now() + interval '2 day', 'apdu000001');
    raise exception 'FAIL: sukurtos dvikovos, kai išjungta';
  exception when raise_exception then
    if sqlerrm not like '%feature_off%' then raise; end if;
  end;
end $$;

-- Įjungus – vėl galima
set role authenticated;
set request.jwt.claim.sub = '95000000-0000-4000-8000-000000000095';
select public.set_feature('leagues', true);
select public.set_feature('duels', true);
select public.set_feature('social_follow', true);
select public.set_feature('blank_trips', true);
reset role;
set role authenticated;
set request.jwt.claim.sub = '96000000-0000-4000-8000-000000000096';
insert into public.leagues (name, season) values ('Įjungta lyga', 2026);
insert into public.follows (followee_id) values ('97000000-0000-4000-8000-000000000097');
insert into public.blank_trips (trip_date) values (current_date);
reset role;
do $$ begin
  assert (select count(*) from public.app_feature_log where key = 'leagues') = 2, 'įjungimas neįrašytas';
end $$;

\echo 'A3. Skelbimas visiems'
set role authenticated;
set request.jwt.claim.sub = '95000000-0000-4000-8000-000000000095';
select public.set_banner('  Šeštadienį – atnaujinimas  ', 'warn');
do $$ begin
  assert (select body from public.app_banner) = 'Šeštadienį – atnaujinimas', 'tekstas neapkarpytas';
  assert (select tone from public.app_banner) = 'warn', 'tonas';
  begin
    perform public.set_banner('Blogas', 'raudonas');
    raise exception 'FAIL: blogas tonas';
  exception when raise_exception then
    if sqlerrm not like '%bad tone%' then raise; end if;
  end;
end $$;
reset role;
set role anon;
do $$ begin
  assert (select body from public.app_banner) is not null, 'svečias nemato skelbimo';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '95000000-0000-4000-8000-000000000095';
select public.set_banner('', 'info');
do $$ begin
  assert (select body from public.app_banner) is null, 'skelbimas nenuimtas';
  assert (select count(*) from public.app_feature_log where key = 'banner') = 2, 'skelbimo pakeitimai neįrašyti';
end $$;
reset role;

\echo 'ADMINISTRAVIMO PANELĖS TESTAI PRAĖJO'
