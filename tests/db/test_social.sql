-- 0019: sekimas, klubai, komandinė įskaita.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'S1. Sekimas'

insert into auth.users (id, email) values
  ('d6000000-0000-4000-8000-0000000000d6', 'soc-a@test.lt'),
  ('d7000000-0000-4000-8000-0000000000d7', 'soc-b@test.lt'),
  ('d8000000-0000-4000-8000-0000000000d8', 'soc-c@test.lt'),
  ('d9000000-0000-4000-8000-0000000000d9', 'soc-d@test.lt');
update public.profiles set nickname = v.n
  from (values ('d6000000-0000-4000-8000-0000000000d6'::uuid, 'Soc_A'), ('d7000000-0000-4000-8000-0000000000d7', 'Soc_B'),
               ('d8000000-0000-4000-8000-0000000000d8', 'Soc_C'), ('d9000000-0000-4000-8000-0000000000d9', 'Soc_D')) v(id, n)
 where profiles.id = v.id;
create temp table sx (k text primary key, id uuid);
grant select, insert on sx to authenticated, anon;

set role authenticated;
set request.jwt.claim.sub = 'd6000000-0000-4000-8000-0000000000d6';
do $$ declare n int; begin
  insert into public.follows (followee_id) values ('d7000000-0000-4000-8000-0000000000d7'), ('d8000000-0000-4000-8000-0000000000d8');
  begin
    insert into public.follows (followee_id) values ('d6000000-0000-4000-8000-0000000000d6');
    raise exception 'FAIL: seka save';
  exception when check_violation then null; end;
  begin
    insert into public.follows (follower_id, followee_id) values ('d9000000-0000-4000-8000-0000000000d9', 'd7000000-0000-4000-8000-0000000000d7');
    raise exception 'FAIL: seka kito vardu';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.follows (followee_id) values ('d7000000-0000-4000-8000-0000000000d7');
    raise exception 'FAIL: dvigubas sekimas';
  exception when unique_violation then null; end;
  assert (select followers from public.follow_stats('d7000000-0000-4000-8000-0000000000d7')) = 1;
  assert (select following from public.follow_stats('d6000000-0000-4000-8000-0000000000d6')) = 2;
  assert (select i_follow from public.follow_stats('d7000000-0000-4000-8000-0000000000d7'));
end $$;
set request.jwt.claim.sub = 'd9000000-0000-4000-8000-0000000000d9';
do $$ declare n int; begin
  assert (select count(*) from public.follows) = 0, 'D mato svetimus sekimus';
  assert not (select i_follow from public.follow_stats('d7000000-0000-4000-8000-0000000000d7'));
  delete from public.follows where follower_id = 'd6000000-0000-4000-8000-0000000000d6';
  get diagnostics n = row_count;
  assert n = 0, 'D ištrynė svetimą sekimą';
end $$;
set request.jwt.claim.sub = 'd7000000-0000-4000-8000-0000000000d7';
do $$ begin
  assert (select count(*) from public.follows) = 1, 'B turi matyti, kas jį seka';
end $$;
set request.jwt.claim.sub = 'd6000000-0000-4000-8000-0000000000d6';
do $$ declare n int; begin
  delete from public.follows where followee_id = 'd8000000-0000-4000-8000-0000000000d8';
  get diagnostics n = row_count;
  assert n = 1, 'nepavyko nebesekti';
end $$;
reset role;
set role anon;
do $$ begin
  assert (select followers from public.follow_stats('d7000000-0000-4000-8000-0000000000d7')) = 1, 'skaičiai vieši';
end $$;
reset role;

\echo '   ok'
\echo 'S2. Klubai: kūrimas, kodas, prisijungimas, išėjimas'
set role authenticated;
set request.jwt.claim.sub = 'd6000000-0000-4000-8000-0000000000d6';
with c as (insert into public.clubs (name, region, open) values ('  Kauno lydekininkai  ', 'Kaunas', false) returning id)
insert into sx select 'kaunas', id from c;
with c as (insert into public.clubs (name) values ('Atviras klubas') returning id)
insert into sx select 'open', id from c;
do $$ begin
  assert (select name from public.clubs where id = (select id from sx where k = 'kaunas')) = 'Kauno lydekininkai', 'pavadinimas neapkarpytas';
  assert (select role from public.club_members where club_id = (select id from sx where k = 'kaunas') and user_id = auth.uid()) = 'owner', 'savininkas ne narys';
  assert public.club_invite_code((select id from sx where k = 'kaunas')) ~ '^[0-9a-f]{10}$', 'nariui nėra kodo';
  begin
    insert into public.clubs (name) values ('kauno LYDEKININKAI');
    raise exception 'FAIL: pasikartojantis pavadinimas';
  exception when unique_violation then null; end;
  begin
    insert into public.clubs (name) values ('<script>');
    raise exception 'FAIL: netinkami simboliai';
  exception when check_violation then null; end;
  insert into public.clubs (name) values ('Trečias klubas');
  begin
    insert into public.clubs (name) values ('Ketvirtas klubas');
    raise exception 'FAIL: daugiau nei 3 klubai';
  exception when raise_exception then if sqlerrm <> 'club_limit' then raise; end if; end;
  begin
    update public.clubs set owner_id = 'd7000000-0000-4000-8000-0000000000d7' where id = (select id from sx where k = 'kaunas');
    raise exception 'FAIL: pakeistas savininkas';
  exception when insufficient_privilege then null; end;
end $$;

set request.jwt.claim.sub = 'd7000000-0000-4000-8000-0000000000d7';
do $$ declare n int; begin
  begin
    perform invite_code from public.clubs;
    raise exception 'FAIL: kodas matomas visiems';
  exception when insufficient_privilege then null; end;
  assert public.club_invite_code((select id from sx where k = 'kaunas')) is null, 'ne narys gavo kodą';
  begin
    perform public.join_club((select id from sx where k = 'kaunas'), 'blogaskodas');
    raise exception 'FAIL: įstojo su blogu kodu';
  exception when raise_exception then if sqlerrm <> 'club_code' then raise; end if; end;
  perform public.join_club((select id from sx where k = 'open'), null);
  update public.clubs set name = 'Pagrobtas' where id = (select id from sx where k = 'open');
  get diagnostics n = row_count;
  assert n = 0, 'ne savininkas pakeitė klubą';
  begin
    insert into public.club_members (club_id, user_id) values ((select id from sx where k = 'kaunas'), auth.uid());
    raise exception 'FAIL: tiesioginis įstojimas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- B įstoja į uždarą su teisingu kodu (kodą „perduoda“ savininkas)
create temp table code_tmp as select invite_code from public.clubs where id = (select id from sx where k = 'kaunas');
grant select on code_tmp to authenticated;
set role authenticated;
set request.jwt.claim.sub = 'd7000000-0000-4000-8000-0000000000d7';
select public.join_club((select id from sx where k = 'kaunas'), upper((select invite_code from code_tmp)));
set request.jwt.claim.sub = 'd8000000-0000-4000-8000-0000000000d8';
select public.join_club((select id from sx where k = 'kaunas'), (select invite_code from code_tmp));
do $$ declare n int; begin
  assert (select count(*) from public.club_members where club_id = (select id from sx where k = 'kaunas')) = 3, 'nariai';
  -- C negali pašalinti B
  delete from public.club_members where club_id = (select id from sx where k = 'kaunas') and user_id = 'd7000000-0000-4000-8000-0000000000d7';
  get diagnostics n = row_count;
  assert n = 0, 'narys pašalino kitą narį';
end $$;
set request.jwt.claim.sub = 'd6000000-0000-4000-8000-0000000000d6';
do $$ declare n int; begin
  delete from public.club_members where club_id = (select id from sx where k = 'kaunas') and user_id = auth.uid();
  get diagnostics n = row_count;
  assert n = 0, 'savininkas išėjo iš savo klubo';
end $$;
reset role;

\echo '   ok'
\echo 'S3. Komandinė įskaita'
set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code, team_mode)
           values ('d9000000-0000-4000-8000-0000000000d9', 'Klubų taurė', 'biggest', now() - interval '1 day', now() + interval '1 day', 'soc0000001', true),
                  ('d9000000-0000-4000-8000-0000000000d9', 'Be komandų', 'biggest', now() - interval '1 day', now() + interval '1 day', 'soc0000002', false)
           returning id, invite_code)
insert into sx select invite_code, id from t;
insert into public.entries (tournament_id, user_id, joined_at)
  select t.id, u, now() - interval '2 days' from sx t, unnest(array['d6000000-0000-4000-8000-0000000000d6', 'd7000000-0000-4000-8000-0000000000d7',
    'd8000000-0000-4000-8000-0000000000d8', 'd9000000-0000-4000-8000-0000000000d9']::uuid[]) u where t.k in ('soc0000001', 'soc0000002');
set session_replication_role = origin;
-- Laimikiai: A 800, B 700, C 600 (Kauno klubas), D 900 (be klubo); įrašomi tiesiai patvirtinti
set session_replication_role = replica;
do $$
declare u uuid; len int; i int := 0;
begin
  foreach u in array array['d6000000-0000-4000-8000-0000000000d6', 'd7000000-0000-4000-8000-0000000000d7',
                           'd8000000-0000-4000-8000-0000000000d8', 'd9000000-0000-4000-8000-0000000000d9']::uuid[] loop
    i := i + 1;
    len := case i when 1 then 800 when 2 then 700 when 3 then 600 else 900 end;
    insert into public.catches (user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
    values (u, gen_random_uuid(), 1, len, now() - interval '2 hours', now() - interval '2 hours', u || '/soc' || i || '.jpg', repeat(to_hex(240 + i), 32), 'approved');
  end loop;
end $$;
set session_replication_role = origin;

set role authenticated;
set request.jwt.claim.sub = 'd6000000-0000-4000-8000-0000000000d6';
select public.set_entry_club((select id from sx where k = 'soc0000001'), (select id from sx where k = 'kaunas'));
set request.jwt.claim.sub = 'd7000000-0000-4000-8000-0000000000d7';
select public.set_entry_club((select id from sx where k = 'soc0000001'), (select id from sx where k = 'kaunas'));
set request.jwt.claim.sub = 'd8000000-0000-4000-8000-0000000000d8';
select public.set_entry_club((select id from sx where k = 'soc0000001'), (select id from sx where k = 'kaunas'));
set request.jwt.claim.sub = 'd9000000-0000-4000-8000-0000000000d9';
do $$ begin
  begin
    perform public.set_entry_club((select id from sx where k = 'soc0000001'), (select id from sx where k = 'kaunas'));
    raise exception 'FAIL: atstovauja klubui, kurio narys nėra';
  exception when raise_exception then if sqlerrm <> 'team_not_member' then raise; end if; end;
end $$;
set request.jwt.claim.sub = 'd6000000-0000-4000-8000-0000000000d6';
do $$ begin
  begin
    perform public.set_entry_club((select id from sx where k = 'soc0000002'), (select id from sx where k = 'kaunas'));
    raise exception 'FAIL: komandos turnyre be komandinės įskaitos';
  exception when raise_exception then if sqlerrm <> 'team_off' then raise; end if; end;
end $$;
reset role;
set role anon;
do $$ declare r record; begin
  select * into r from public.team_leaderboard((select id from sx where k = 'soc0000001'));
  assert r.name = 'Kauno lydekininkai' and r.score_mm = 2100 and r.members = 3 and r.counted = 3 and r.rank = 1, format('komanda: %s', row_to_json(r));
  assert (select count(*) from public.team_leaderboard((select id from sx where k = 'soc0000002'))) = 0, 'be komandinės įskaitos – tuščia';
end $$;
reset role;
-- Paslėpta lentelė slepia ir komandas
update public.tournaments set leaderboard_hidden = true where id = (select id from sx where k = 'soc0000001');
set role anon;
do $$ begin
  assert (select count(*) from public.team_leaderboard((select id from sx where k = 'soc0000001'))) = 0, 'paslėptos lentelės komandos matomos';
end $$;
reset role;
-- Registruojantis klubo „įsipiršti“ negalima
set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code, team_mode)
           values ('d9000000-0000-4000-8000-0000000000d9', 'Būsimas', 'biggest', now() + interval '1 day', now() + interval '2 days', 'soc0000003', true) returning id)
insert into sx select 'future', id from t;
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = 'd9000000-0000-4000-8000-0000000000d9';
insert into public.entries (tournament_id, club_id) select (select id from sx where k = 'future'), (select id from sx where k = 'kaunas');
reset role;
do $$ begin
  assert (select club_id from public.entries where tournament_id = (select id from sx where k = 'future') and user_id = 'd9000000-0000-4000-8000-0000000000d9') is null,
    'ne narys įsirašė į klubą registruodamasis';
end $$;
reset request.jwt.claim.sub;

\echo '   ok'
