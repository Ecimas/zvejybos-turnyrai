-- 0022: telefono laikrodžio skirtumas prie laimikio, serverio laikas.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'C1. Laikrodžio skirtumas ir serverio laikas'
set role anon;
do $$ begin
  assert abs(extract(epoch from (public.server_now() - now()))) < 1, 'server_now';
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '71000000-0000-4000-8000-000000000071';
do $$ declare v int; begin
  insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256, clock_offset_s)
  values (gen_random_uuid(), 1, 500, now() - interval '3 hours', '71000000-0000-4000-8000-000000000071/clock1.jpg', md5('clock1') || md5('clock1b'), 10800);
  select clock_offset_s into v from public.catches where photo_path like '%/clock1.jpg';
  assert v = 10800, 'skirtumas neišsaugotas';
  begin
    insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256, clock_offset_s)
    values (gen_random_uuid(), 1, 500, now(), '71000000-0000-4000-8000-000000000071/clock2.jpg', md5('clock2') || md5('clock2b'), 99999999);
    raise exception 'FAIL: neleistinas skirtumas';
  exception when check_violation then null; end;
  -- Vėliau pakeisti skirtumo negalima
  begin
    update public.catches set clock_offset_s = 0 where photo_path like '%/clock1.jpg';
    if (select clock_offset_s from public.catches where photo_path like '%/clock1.jpg') <> 10800 then raise exception 'FAIL: skirtumas pakeistas'; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  assert (select count(clock_offset_s) from public.catches where photo_path like '%/clock1.jpg') = 0, 'nepatvirtintas laimikis matomas anonimui';
end $$;
reset role;
\echo '   ok'
