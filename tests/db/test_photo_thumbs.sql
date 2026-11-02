-- 0038: WebP nuotraukos, mažos kopijos (miniatiūros) ir vietos skaitiklis.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'P1. WebP laimikio nuotrauka priimama, miniatiūra kaip laimikio nuotrauka – ne'

insert into auth.users (id, email) values
  ('a3810000-0000-4000-8000-0000000000e1', 'pt-angler@test.lt'),
  ('a3820000-0000-4000-8000-0000000000e2', 'pt-other@test.lt'),
  ('a3830000-0000-4000-8000-0000000000e3', 'pt-owner@test.lt');
update public.profiles set nickname = 'Pt_' || right(id::text, 2) where id::text like 'a38_0000-%';
update public.profiles set roles = array['owner'] where id = 'a3830000-0000-4000-8000-0000000000e3';

do $$ begin
  assert (select allowed_mime_types from storage.buckets where id = 'catch-photos') @> array['image/jpeg', 'image/webp'],
    'saugykla nepriima WebP';
end $$;

set role authenticated;
set request.jwt.claim.sub = 'a3810000-0000-4000-8000-0000000000e1';
insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
values ('b3800000-0000-4000-8000-000000000001', 1, 450, now() - interval '1 hour',
        'a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000001.webp', md5('pt1') || md5('1tp'));
insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
values ('b3800000-0000-4000-8000-000000000002', 1, 380, now() - interval '1 hour',
        'a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000002.jpg', md5('pt2') || md5('2tp'));
do $$ begin
  -- Miniatiūros kelias (su tašku) laimikio nuotrauka būti negali
  begin
    insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
    values (gen_random_uuid(), 1, 300, now(), 'a3810000-0000-4000-8000-0000000000e1/x.t.webp', md5('pt3') || md5('3tp'));
    raise exception 'FAIL: priimta miniatiūra kaip laimikio nuotrauka';
  exception when raise_exception then
    if sqlerrm not like 'photo_path must be%' then raise; end if;
  end;
  -- Kiti formatai – ne
  begin
    insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
    values (gen_random_uuid(), 1, 300, now(), 'a3810000-0000-4000-8000-0000000000e1/x.png', md5('pt4') || md5('4tp'));
    raise exception 'FAIL: priimtas PNG';
  exception when raise_exception then
    if sqlerrm not like 'photo_path must be%' then raise; end if;
  end;
  -- Svetimas aplankas – vis dar ne
  begin
    insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
    values (gen_random_uuid(), 1, 300, now(), 'a3820000-0000-4000-8000-0000000000e2/x.webp', md5('pt5') || md5('5tp'));
    raise exception 'FAIL: svetimas aplankas';
  exception when raise_exception then
    if sqlerrm not like 'photo_path must be%' then raise; end if;
  end;
end $$;
-- Įkeliami originalai ir miniatiūros (savo aplanke)
insert into storage.objects (bucket_id, name, metadata) values
  ('catch-photos', 'a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000001.webp', '{"size": 90000}'),
  ('catch-photos', 'a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000001.t.webp', '{"size": 9000}'),
  ('catch-photos', 'a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000002.jpg', '{"size": 210000}'),
  ('catch-photos', 'a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000002.t.jpg', '{"size": 14000}');
do $$ begin
  assert (select count(*) from storage.objects where name like 'a3810000-0000-4000-8000-0000000000e1/%') = 4, 'savininkas nemato savo failų';
end $$;
reset role;

\echo 'P2. Miniatiūra matoma tiems patiems kaip originalas'
set role authenticated;
set request.jwt.claim.sub = 'a3820000-0000-4000-8000-0000000000e2';
do $$ begin
  assert (select count(*) from storage.objects where name like 'a3810000-0000-4000-8000-0000000000e1/%') = 0,
    'kitas žvejys mato nepatvirtintų laimikių failus';
end $$;
reset role;
update public.catches set status = 'approved' where client_id = 'b3800000-0000-4000-8000-000000000001';
set role authenticated;
set request.jwt.claim.sub = 'a3820000-0000-4000-8000-0000000000e2';
do $$ begin
  assert (select array_agg(name order by name) from storage.objects where name like 'a3810000-0000-4000-8000-0000000000e1/%')
       = array['a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000001.t.webp',
               'a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000001.webp'],
    'patvirtinto laimikio originalas ir miniatiūra turi būti matomi, nepatvirtinto – ne';
  -- Įkelti į svetimą aplanką – negalima
  begin
    insert into storage.objects (bucket_id, name) values ('catch-photos', 'a3810000-0000-4000-8000-0000000000e1/b3800000-0000-4000-8000-000000000002.t.webp');
    raise exception 'FAIL: įkėlė į svetimą aplanką';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set role anon;
set request.jwt.claim.sub = '';
do $$ begin
  assert (select count(*) from storage.objects where name like '%.t.%') >= 1, 'neprisijungęs nemato patvirtinto laimikio miniatiūros';
  assert not exists (select 1 from storage.objects where name like '%000000000002.t.jpg'), 'neprisijungęs mato nepatvirtinto laimikio miniatiūrą';
end $$;
reset role;

\echo 'P3. Vietos skaitiklis – tik savininkui'
set role authenticated;
set request.jwt.claim.sub = 'a3820000-0000-4000-8000-0000000000e2';
do $$ begin
  begin perform public.storage_usage(); raise exception 'FAIL: paprastas žvejys mato vietos skaitiklį';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
set request.jwt.claim.sub = 'a3830000-0000-4000-8000-0000000000e3';
do $$ declare r record; begin
  select * into r from public.storage_usage() where bucket = 'catch-photos';
  assert r.files >= 2 and r.thumbs >= 2, format('failų skaičius: %s / %s', r.files, r.thumbs);
  assert r.bytes >= 323000 and r.thumb_bytes >= 23000, format('dydis: %s / %s', r.bytes, r.thumb_bytes);
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.storage_usage(); raise exception 'FAIL: anon';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
\echo '  ✓ 0038 nuotraukų testai praėjo'
