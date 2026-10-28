-- 0018: asmeninis laimikių žemėlapis (catch_spots mato tik savininkas).
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'Z1. Vietų saugojimas savo žemėlapiui'

insert into auth.users (id, email) values
  ('a7000000-0000-4000-8000-0000000000a7', 'map-s@test.lt'),
  ('a8000000-0000-4000-8000-0000000000a8', 'map-t@test.lt'),
  ('a9000000-0000-4000-8000-0000000000a9', 'map-mod@test.lt');
update public.profiles set roles = array['admin'] where id = 'a9000000-0000-4000-8000-0000000000a9';
create temp table mx (k text primary key, id uuid);
grant select, insert on mx to authenticated;

set role authenticated;
set request.jwt.claim.sub = 'a7000000-0000-4000-8000-0000000000a7';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 600, now() - interval '1 day', 'a7000000-0000-4000-8000-0000000000a7/s1.jpg', repeat('8a', 32)) returning id)
insert into mx select 's1', id from c;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 2, 300, now() - interval '2 days', 'a7000000-0000-4000-8000-0000000000a7/s2.jpg', repeat('8b', 32)) returning id)
insert into mx select 's2', id from c;
insert into public.catch_locations (catch_id, lat, lng, accuracy_m) select id, 54.9, 23.9, 8 from mx where k = 's1';
insert into public.catch_locations (catch_id, lat, lng, accuracy_m) select id, 55.1, 24.2, 12 from mx where k = 's2';
set request.jwt.claim.sub = 'a8000000-0000-4000-8000-0000000000a8';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 700, now() - interval '1 day', 'a8000000-0000-4000-8000-0000000000a8/t1.jpg', repeat('8c', 32)) returning id)
insert into mx select 't1', id from c;
insert into public.catch_locations (catch_id, lat, lng, accuracy_m) select id, 56.0, 25.0, 5 from mx where k = 't1';

set request.jwt.claim.sub = 'a7000000-0000-4000-8000-0000000000a7';
do $$ begin
  assert (select count(*) from public.catch_spots) = 0, 'kopijos be sutikimo';
  assert public.set_keep_spots(true) = 2, 'turėjo nukopijuoti 2 vietas';
  assert public.set_keep_spots(true) = 0, 'kopijuoja antrą kartą';
  assert (select count(*) from public.catch_spots) = 2, 'savininkas nemato savo vietų';
  assert (select keep from public.spot_settings) = true;
  begin
    insert into public.catch_spots (catch_id, user_id, lat, lng) select id, auth.uid(), 1, 1 from mx where k = 't1';
    raise exception 'FAIL: tiesioginis įrašas';
  exception when insufficient_privilege then null; end;
end $$;
-- Naujas laimikis su vieta – nukopijuojamas automatiškai
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 650, now() - interval '1 hour', 'a7000000-0000-4000-8000-0000000000a7/s3.jpg', repeat('8d', 32)) returning id)
insert into mx select 's3', id from c;
insert into public.catch_locations (catch_id, lat, lng, accuracy_m) select id, 54.5, 23.5, 6 from mx where k = 's3';
do $$ begin
  assert (select count(*) from public.catch_spots) = 3, 'nauja vieta nenukopijuota';
end $$;

-- Kiti (net administratorius) savininko kopijų nemato ir ištrinti negali
set request.jwt.claim.sub = 'a9000000-0000-4000-8000-0000000000a9';
do $$ declare n int; begin
  assert (select count(*) from public.catch_spots) = 0, 'administratorius mato asmenines vietas';
  assert (select count(*) from public.catch_locations l join mx on mx.id = l.catch_id) = 4, 'administratorius turi matyti patikros vietas';
  delete from public.catch_spots;
  get diagnostics n = row_count;
  assert n = 0, 'administratorius ištrynė svetimas kopijas';
end $$;
set request.jwt.claim.sub = 'a8000000-0000-4000-8000-0000000000a8';
do $$ begin
  assert (select count(*) from public.catch_spots) = 0, 'kitas žvejys mato svetimas vietas';
  assert (select count(*) from public.spot_settings) = 0, 'kitas mato svetimus nustatymus';
end $$;
reset role;

\echo '   ok'
\echo 'Z2. Po 90 d. tikslios vietos ištrinamos, kopijos lieka; išjungus – nekopijuojama'
update public.catches set captured_at_device = now() - interval '120 days'
 where id in (select id from mx where k in ('s2', 't1'));
select public.purge_old_locations();
do $$ begin
  assert not exists (select 1 from public.catch_locations where catch_id = (select id from mx where k = 's2')), 'sena vieta neištrinta';
  assert exists (select 1 from public.catch_spots where catch_id = (select id from mx where k = 's2')), 'kopija dingo kartu su vieta';
end $$;
set role authenticated;
set request.jwt.claim.sub = 'a7000000-0000-4000-8000-0000000000a7';
do $$ declare n int; begin
  perform public.set_keep_spots(false);
  delete from public.catch_spots where user_id = auth.uid();
  get diagnostics n = row_count;
  assert n = 3, 'savininkas neištrynė savo kopijų';
end $$;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 500, now() - interval '30 minutes', 'a7000000-0000-4000-8000-0000000000a7/s4.jpg', repeat('8e', 32)) returning id)
insert into mx select 's4', id from c;
insert into public.catch_locations (catch_id, lat, lng, accuracy_m) select id, 54.7, 23.7, 9 from mx where k = 's4';
do $$ begin
  assert (select count(*) from public.catch_spots) = 0, 'išjungus vis tiek kopijuoja';
end $$;
reset role;
reset request.jwt.claim.sub;

\echo '   ok'
