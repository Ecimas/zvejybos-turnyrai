-- 0029: klubai+ (administratoriai, prašymai, pranešimai, išvykos, reakcijos, komentarai, iššūkis, rekordai, lyga, žemėlapis, nuolaidos, jungikliai).
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'K1. Klubas, administratorius, prašymai prisijungti'

insert into auth.users (id, email) values
  ('91000000-0000-4000-8000-000000000091', 'kp-own@test.lt'),
  ('92000000-0000-4000-8000-000000000092', 'kp-adm@test.lt'),
  ('93000000-0000-4000-8000-000000000093', 'kp-mem@test.lt'),
  ('94000000-0000-4000-8000-000000000094', 'kp-out@test.lt');
update public.profiles set nickname = v.n
  from (values ('91000000-0000-4000-8000-000000000091'::uuid, 'Kp_Own'), ('92000000-0000-4000-8000-000000000092', 'Kp_Adm'),
               ('93000000-0000-4000-8000-000000000093', 'Kp_Mem'), ('94000000-0000-4000-8000-000000000094', 'Kp_Out')) v(id, n)
 where profiles.id = v.id;
create temp table kx (k text primary key, id uuid);
grant select, insert on kx to authenticated, anon;

set role authenticated;
set request.jwt.claim.sub = '91000000-0000-4000-8000-000000000091';
with c as (insert into public.clubs (name, open) values ('Klubas Plius', false) returning id)
insert into kx select 'club', id from c;
reset role;
-- Narys ir būsimas administratorius – per prašymus (uždaras klubas)
set role authenticated;
do $$ begin
  begin
    perform public.decide_join_club((select id from kx where k = 'club'), '92000000-0000-4000-8000-000000000092', true);
    raise exception 'FAIL: patvirtino neegzistuojantį prašymą';
  exception when raise_exception then
    if sqlerrm not like '%request_not_found%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '92000000-0000-4000-8000-000000000092';
select public.request_join_club((select id from kx where k = 'club'), 'Noriu prisijungti');
set request.jwt.claim.sub = '93000000-0000-4000-8000-000000000093';
select public.request_join_club((select id from kx where k = 'club'), null);
do $$ begin
  assert (select count(*) from public.club_join_requests) = 1, 'narys mato svetimus prašymus';
  begin
    perform public.decide_join_club((select id from kx where k = 'club'), '93000000-0000-4000-8000-000000000093', true);
    raise exception 'FAIL: pats save priėmė';
  exception when raise_exception then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '91000000-0000-4000-8000-000000000091';
do $$ begin
  assert (select count(*) from public.club_join_requests) = 2, 'savininkas turi matyti prašymus';
  perform public.decide_join_club((select id from kx where k = 'club'), '92000000-0000-4000-8000-000000000092', true);
  perform public.decide_join_club((select id from kx where k = 'club'), '93000000-0000-4000-8000-000000000093', true);
  perform public.set_club_admin((select id from kx where k = 'club'), '92000000-0000-4000-8000-000000000092', true);
  assert (select role from public.club_members where user_id = '92000000-0000-4000-8000-000000000092') = 'admin';
  assert (select count(*) from public.club_join_requests) = 0;
end $$;
-- Administratorius: gali keisti aprašymą, bet ne patvirtinimą ir ne skirti administratorių
set request.jwt.claim.sub = '92000000-0000-4000-8000-000000000092';
do $$ declare n int; begin
  update public.clubs set description = 'Administratoriaus aprašymas' where id = (select id from kx where k = 'club');
  get diagnostics n = row_count;
  assert n = 1, 'administratorius turi galėti keisti klubą';
  begin
    update public.clubs set verified = true where id = (select id from kx where k = 'club');
    raise exception 'FAIL: pats pasitvirtino klubą';
  exception when insufficient_privilege or raise_exception then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.set_club_admin((select id from kx where k = 'club'), '93000000-0000-4000-8000-000000000093', true);
    raise exception 'FAIL: administratorius skyrė administratorių';
  exception when raise_exception then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;
end $$;
-- Pašalinis negali keisti klubo
set request.jwt.claim.sub = '94000000-0000-4000-8000-000000000094';
do $$ declare n int; begin
  update public.clubs set description = 'Įsilaužėlis' where id = (select id from kx where k = 'club');
  get diagnostics n = row_count;
  assert n = 0, 'pašalinis pakeitė klubą';
end $$;
reset role;
\echo '   ok – administratoriai ir prašymai prisijungti'

\echo 'K2. Pranešimai, patarimai, išvykos'
set role authenticated;
set request.jwt.claim.sub = '93000000-0000-4000-8000-000000000093';
do $$ begin
  begin
    insert into public.club_posts (club_id, body) values ((select id from kx where k = 'club'), 'Narys rašo pranešimą');
    raise exception 'FAIL: narys parašė pranešimą';
  exception when insufficient_privilege then null; end;
  insert into public.club_posts (club_id, kind, body) values ((select id from kx where k = 'club'), 'tip', 'Ešeriai kimba 4 m gylyje');
end $$;
set request.jwt.claim.sub = '92000000-0000-4000-8000-000000000092';
insert into public.club_posts (club_id, body) values ((select id from kx where k = 'club'), '  Šeštadienį susitikimas 8:00  ');
with t as (insert into public.club_trips (club_id, starts_at, place, seats) values ((select id from kx where k = 'club'), now() + interval '3 days', 'Kauno marios', 2) returning id)
insert into kx select 'trip', id from t;
do $$ begin
  assert (select body from public.club_posts where kind = 'post') = 'Šeštadienį susitikimas 8:00', 'tarpai nenukirpti';
  assert (select status from public.club_trip_rsvps where user_id = '92000000-0000-4000-8000-000000000092') = 'going', 'autorius turi važiuoti';
  begin
    insert into public.club_trips (club_id, starts_at, place) values ((select id from kx where k = 'club'), now() - interval '2 days', 'Praeityje');
    raise exception 'FAIL: išvyka praeityje';
  exception when raise_exception then
    if sqlerrm not like '%trip_time%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '93000000-0000-4000-8000-000000000093';
select public.rsvp_trip((select id from kx where k = 'trip'), 'maybe');
select public.rsvp_trip((select id from kx where k = 'trip'), 'going');
do $$ begin
  assert (select count(*) from public.club_trip_rsvps where status = 'going') = 2;
  insert into public.club_post_likes (post_id) select id from public.club_posts where kind = 'tip';
end $$;
set request.jwt.claim.sub = '94000000-0000-4000-8000-000000000094';
do $$ begin
  assert (select count(*) from public.club_posts) = 0, 'pašalinis mato klubo pranešimus';
  assert (select count(*) from public.club_trips) = 0, 'pašalinis mato išvykas';
  begin
    perform public.rsvp_trip((select id from kx where k = 'trip'), 'going');
    raise exception 'FAIL: pašalinis užsiregistravo į išvyką';
  exception when raise_exception then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;
  begin
    insert into public.club_post_likes (post_id) select id from public.club_posts;
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  -- Pranešimas (ne patarimas) siunčiamas kitiems nariams – jei jie turi prenumeratą; čia tik tikrinam, kad nesulūžo
  assert (select count(*) from public.club_posts) = 2;
end $$;
\echo '   ok – pranešimai, patarimai, išvykos'

\echo 'K3. Reakcijos ir komentarai'
set session_replication_role = replica;
do $$
declare u uuid; i int := 0;
begin
  foreach u in array array['91000000-0000-4000-8000-000000000091', '92000000-0000-4000-8000-000000000092',
                           '93000000-0000-4000-8000-000000000093', '94000000-0000-4000-8000-000000000094']::uuid[] loop
    i := i + 1;
    insert into public.catches (id, user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
    values (('9' || i || '0000c0-0000-4000-8000-0000000000c' || i)::uuid, u, gen_random_uuid(), 2, 300 + i * 20, now() - interval '1 hour', now() - interval '1 hour',
            u || '/kp' || i || '.jpg', repeat(to_hex(200 + i), 32), 'approved');
    insert into public.catch_locations (catch_id, lat, lng, accuracy_m) values (('9' || i || '0000c0-0000-4000-8000-0000000000c' || i)::uuid, 54.89123, 23.9234 + i / 1000.0, 8);
  end loop;
end $$;
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = '93000000-0000-4000-8000-000000000093';
do $$ declare n int; begin
  insert into public.catch_reactions (catch_id, emoji) values ('910000c0-0000-4000-8000-0000000000c1', 'fire');
  with c as (insert into public.catch_comments (catch_id, body) values ('910000c0-0000-4000-8000-0000000000c1', '  Gražuolis!  ') returning id)
  insert into kx select 'comment', id from c;
  assert (select body from public.catch_comments) = 'Gražuolis!';
  begin
    insert into public.catch_reactions (catch_id, emoji) values ('940000c0-0000-4000-8000-0000000000c4', 'like');
    raise exception 'FAIL: reakcija pašaliniam (nesidalija klubu)';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.catch_comments (catch_id, body, reported) values ('910000c0-0000-4000-8000-0000000000c1', 'x', true);
    raise exception 'FAIL: komentaras su reported';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.catch_reactions (catch_id, emoji) values ('910000c0-0000-4000-8000-0000000000c1', 'heart');
    raise exception 'FAIL: neleistina reakcija';
  exception when check_violation then null; end;
end $$;
set request.jwt.claim.sub = '94000000-0000-4000-8000-000000000094';
do $$ declare n int; begin
  assert (select count(*) from public.catch_comments) = 0, 'pašalinis mato klubo komentarus';
  assert (select count(*) from public.catch_reactions) = 0, 'pašalinis mato reakcijas';
  delete from public.catch_comments;
  get diagnostics n = row_count;
  assert n = 0;
end $$;
-- Laimikio savininkas gali pranešti ir ištrinti komentarą
set request.jwt.claim.sub = '91000000-0000-4000-8000-000000000091';
select public.report_comment((select id from kx where k = 'comment'));
do $$ declare n int; begin
  assert (select reported from public.catch_comments);
  delete from public.catch_comments where id = (select id from kx where k = 'comment');
  get diagnostics n = row_count;
  assert n = 1, 'savininkas turi galėti ištrinti komentarą ant savo laimikio';
end $$;
reset role;
\echo '   ok – reakcijos ir komentarai tik klubo draugams'

\echo 'K4. Iššūkis, rekordai, reitingas, lyga, žemėlapis'
set role authenticated;
set request.jwt.claim.sub = '93000000-0000-4000-8000-000000000093';
do $$ declare j jsonb; begin
  j := public.club_challenge((select id from kx where k = 'club'), '2026-02-10');
  assert (j->>'species_id')::int = 2, 'vasarį – ešerys';
  j := public.club_challenge((select id from kx where k = 'club'), '2026-06-10');
  assert j->>'species_id' is null, 'birželį – bet kuri rūšis';
  j := public.club_challenge((select id from kx where k = 'club'));
  j := public.club_records((select id from kx where k = 'club'));
  assert jsonb_array_length(j->'records') = 1, 'viena rūšis – vienas rekordas';
  assert (j->'records'->0->>'len')::int = 360, 'rekordas – didžiausias klubo narių (ne pašalinio 380)';
  assert jsonb_array_length(j->'season') = 3, 'sezone – 3 nariai su laimikiais';
  j := public.club_league();
  assert jsonb_array_length(j) >= 1;
  assert (select (x->>'points')::int from jsonb_array_elements(j) x where x->>'id' = (select id from kx where k = 'club')::text) = 102, 'klubo taškai = 32+34+36 cm';
  -- Žemėlapis: niekas nesidalija – tuščia
  assert (select count(*) from public.club_map((select id from kx where k = 'club'))) = 0;
  perform public.set_club_share_map((select id from kx where k = 'club'), true);
  assert (select count(*) from public.club_map((select id from kx where k = 'club'))) = 1, 'tik pasidalinusio nario laimikis';
  assert (select lat from public.club_map((select id from kx where k = 'club'))) = 54.89, 'vieta apvalinama ~1 km';
end $$;
set request.jwt.claim.sub = '94000000-0000-4000-8000-000000000094';
do $$ begin
  begin
    perform public.club_map((select id from kx where k = 'club'));
    raise exception 'FAIL: pašalinis mato klubo žemėlapį';
  exception when raise_exception then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;
  begin
    perform public.club_challenge((select id from kx where k = 'club'));
    raise exception 'FAIL: pašalinis mato iššūkį';
  exception when raise_exception then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;
end $$;
reset role;
\echo '   ok – iššūkis, rekordai, lyga, žemėlapis'

\echo 'K5. Nuolaidos nariams ir funkcijų jungikliai'
set role authenticated;
set request.jwt.claim.sub = '92000000-0000-4000-8000-000000000092';
insert into public.club_perks (club_id, sponsor_name, offer, code) values ((select id from kx where k = 'club'), 'Ežero banga', '−15 % nariams', 'LYD15');
set request.jwt.claim.sub = '93000000-0000-4000-8000-000000000093';
do $$ declare n int; begin
  assert (select code from public.club_perks) = 'LYD15', 'narys turi matyti kodą';
  update public.club_perks set code = 'HACK';
  get diagnostics n = row_count;
  assert n = 0, 'narys pakeitė nuolaidą';
end $$;
set request.jwt.claim.sub = '94000000-0000-4000-8000-000000000094';
do $$ begin
  assert (select count(*) from public.club_perks) = 0, 'pašalinis mato nuolaidos kodą';
  begin
    perform public.set_feature('club_trips', false);
    raise exception 'FAIL: paprastas žvejys išjungė funkciją';
  exception when raise_exception then
    if sqlerrm not like '%not allowed%' then raise; end if;
  end;
end $$;
reset role;
update public.profiles set roles = array['owner'] where id = '91000000-0000-4000-8000-000000000091';
set role authenticated;
set request.jwt.claim.sub = '91000000-0000-4000-8000-000000000091';
select public.set_feature('club_trips', false);
set request.jwt.claim.sub = '92000000-0000-4000-8000-000000000092';
do $$ begin
  begin
    insert into public.club_trips (club_id, starts_at, place) values ((select id from kx where k = 'club'), now() + interval '1 day', 'Išjungta');
    raise exception 'FAIL: išjungta funkcija veikia';
  exception when raise_exception then
    if sqlerrm not like '%feature_off%' then raise; end if;
  end;
end $$;
set request.jwt.claim.sub = '91000000-0000-4000-8000-000000000091';
select public.set_feature('club_trips', true);
select public.set_club_verified((select id from kx where k = 'club'), true);
reset role;
do $$ begin
  assert (select verified from public.clubs where id = (select id from kx where k = 'club'));
end $$;
set role anon;
do $$ begin
  assert (select count(*) from public.app_features) >= 12, 'jungikliai vieši (skaitymui)';
end $$;
reset role;
update public.profiles set roles = '{}' where id = '91000000-0000-4000-8000-000000000091';
\echo '   ok – nuolaidos tik nariams, jungikliai tik savininkui'
