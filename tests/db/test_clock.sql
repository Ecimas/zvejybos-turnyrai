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

\echo 'C2. Tikras laikas lentelėje: laikrodis atsuktas atgal prieš pabaigą'
create temp table fx (k text primary key, id uuid);
set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code)
           values ('76000000-0000-4000-8000-000000000076', 'Laikrodžio taurė', 'biggest', now() - interval '6 hours', now() - interval '1 hour', 'clk0000001') returning id)
insert into fx select 'clk', id from t;
insert into public.entries (tournament_id, user_id, joined_at)
  select (select id from fx where k = 'clk'), u, now() - interval '7 hours'
    from unnest(array['72000000-0000-4000-8000-000000000072', '73000000-0000-4000-8000-000000000073', '74000000-0000-4000-8000-000000000074']::uuid[]) u;
-- B: tikra žuvis turnyro metu; C: „pagauta“ prieš pabaigą pagal telefoną, bet tikras laikas (fotografuojant) – po pabaigos;
-- D: tas pats, bet skirtumas išmatuotas tik siunčiant
insert into public.catches (user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status, clock_offset_s, send_offset_s)
values ('72000000-0000-4000-8000-000000000072', gen_random_uuid(), 1, 500, now() - interval '3 hours', now() - interval '3 hours', '72000000-0000-4000-8000-000000000072/clk.jpg', md5('clkB') || md5('clkB2'), 'approved', 5, 2),
       ('73000000-0000-4000-8000-000000000073', gen_random_uuid(), 1, 900, now() - interval '2 hours', now() - interval '30 minutes', '73000000-0000-4000-8000-000000000073/clk.jpg', md5('clkC') || md5('clkC2'), 'approved', 5400, 5400),
       ('74000000-0000-4000-8000-000000000074', gen_random_uuid(), 1, 800, now() - interval '2 hours', now() - interval '30 minutes', '74000000-0000-4000-8000-000000000074/clk.jpg', md5('clkD') || md5('clkD2'), 'approved', null, 5400);
set session_replication_role = origin;
do $$ begin
  assert (select array_agg(user_id order by rank) from public.leaderboard_all((select id from fx where k = 'clk')))
         = array['72000000-0000-4000-8000-000000000072']::uuid[], 'po pabaigos pagautos žuvys įskaitytos';
  assert public.catch_time('2026-01-01 10:00+00', 30, 9000) = '2026-01-01 10:00:30+00'::timestamptz - interval '30 seconds', 'iki 60 s ignoruojama';
  assert public.catch_time('2026-01-01 10:00+00', null, 7200) = '2026-01-01 12:00+00'::timestamptz;
  assert public.catch_time('2026-01-01 10:00+00', -3600, 7200) = '2026-01-01 09:00+00'::timestamptz, 'pirmiausia fotografavimo skirtumas';
end $$;

-- Siuntimo skirtumą apskaičiuoja serveris, kliento reikšmė ignoruojama
set role authenticated;
set request.jwt.claim.sub = '75000000-0000-4000-8000-000000000075';
insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256, sent_at_device, send_offset_s)
values (gen_random_uuid(), 1, 400, now() - interval '2 hours', '75000000-0000-4000-8000-000000000075/send1.jpg', md5('send1') || md5('send1b'), now() - interval '2 hours', 0);
do $$ begin
  assert (select send_offset_s from public.catches where photo_path like '%/send1.jpg') between 7199 and 7201, 'siuntimo skirtumas';
end $$;
reset role;
\echo '   ok'
