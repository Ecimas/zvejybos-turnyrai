-- 0026: administratorius taiso ir šalina turnyrus.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'A1. Teisės ir matomumas'

insert into auth.users (id, email) values
  ('ad100000-0000-4000-8000-0000000000a1', 'adm-org@test.lt'),    -- organizatorius
  ('ad200000-0000-4000-8000-0000000000a2', 'adm-admin@test.lt'),  -- administratorius
  ('ad300000-0000-4000-8000-0000000000a3', 'adm-user@test.lt'),   -- paprastas žvejys
  ('ad400000-0000-4000-8000-0000000000a4', 'adm-part@test.lt'),   -- dalyvis su pranešimais
  ('ad500000-0000-4000-8000-0000000000a5', 'adm-mod@test.lt');    -- laimikių tikrintojas
update public.profiles set roles = array['admin'] where id = 'ad200000-0000-4000-8000-0000000000a2';
update public.profiles set roles = array['moderator'] where id = 'ad500000-0000-4000-8000-0000000000a5';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('ad400000-0000-4000-8000-0000000000a4', 'https://push.test/adm-a4', repeat('x', 87), repeat('x', 22)),
       ('ad100000-0000-4000-8000-0000000000a1', 'https://push.test/adm-a1', repeat('x', 87), repeat('x', 22));
create temp table ax (k text primary key, id uuid);
grant select on ax to authenticated, anon;

-- Vykstantis (live) ir būsimas privatus turnyras
set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, top_n, starts_at, ends_at, invite_code)
           values ('ad100000-0000-4000-8000-0000000000a1', 'Vykstanti taurė', 'top_n_sum', 2, now() - interval '1 day', now() + interval '1 day', 'adm0000001')
           returning id)
insert into ax select 'live', id from t;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility, invite_code)
           values ('ad100000-0000-4000-8000-0000000000a1', 'Būsima privati', 'biggest', now() + interval '2 days', now() + interval '3 days', 'private', 'adm0000002')
           returning id)
insert into ax select 'soon', id from t;
insert into public.tournament_species (tournament_id, species_id) select id, 1 from ax where k = 'live';
insert into public.entries (tournament_id, user_id, joined_at)
  select (select id from ax where k = 'live'), u, now() - interval '2 days'
    from unnest(array['ad100000-0000-4000-8000-0000000000a1', 'ad400000-0000-4000-8000-0000000000a4']::uuid[]) u;
insert into public.catches (user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
values ('ad400000-0000-4000-8000-0000000000a4', gen_random_uuid(), 1, 700, now() - interval '3 hours', now() - interval '3 hours',
        'ad400000-0000-4000-8000-0000000000a4/adm1.jpg', md5('adm1') || md5('1mda'), 'approved');
set session_replication_role = origin;

set role authenticated;
set request.jwt.claim.sub = 'ad200000-0000-4000-8000-0000000000a2';
do $$ begin
  assert public.has_perm('tournaments'), 'administratorius be teisės';
  assert 'tournaments' = any (public.my_permissions()), 'my_permissions';
  assert exists (select 1 from public.tournaments where id = (select id from ax where k = 'soon')), 'administratorius nemato privataus';
end $$;
set request.jwt.claim.sub = 'ad500000-0000-4000-8000-0000000000a5';
do $$ begin
  assert not public.has_perm('tournaments'), 'tikrintojas turi turnyrų teisę';
  assert not exists (select 1 from public.tournaments where id = (select id from ax where k = 'soon')), 'tikrintojas mato privatų';
end $$;
set request.jwt.claim.sub = 'ad300000-0000-4000-8000-0000000000a3';
do $$ declare n int; begin
  assert not exists (select 1 from public.tournaments where id = (select id from ax where k = 'soon')), 'žvejys mato privatų';
  update public.tournaments set title = 'Nulaužta' where id = (select id from ax where k = 'live');
  get diagnostics n = row_count;
  assert n = 0, 'svetimas žvejys pakeitė turnyrą';
  begin perform public.admin_delete_tournament((select id from ax where k = 'live'), 'Bandau ištrinti'); raise exception 'FAIL: žvejys ištrynė';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  assert (select count(*) from public.tournament_admin_log) = 0, 'žvejys mato žurnalą';
  begin insert into public.tournament_admin_log (tournament_id, title, action) values (gen_random_uuid(), 'x', 'update'); raise exception 'FAIL: įrašas į žurnalą';
  exception when insufficient_privilege then null; end;
end $$;
-- Organizatorius vykstančio turnyro keisti negali (kaip ir anksčiau)
set request.jwt.claim.sub = 'ad100000-0000-4000-8000-0000000000a1';
do $$ declare n int; begin
  update public.tournaments set title = 'Kitas' where id = (select id from ax where k = 'live');
  get diagnostics n = row_count;
  assert n = 0, 'organizatorius pakeitė vykstantį';
  -- Iki starto – keičia kaip anksčiau, į žurnalą nerašoma
  update public.tournaments set title = 'Būsima privati taurė' where id = (select id from ax where k = 'soon');
  get diagnostics n = row_count;
  assert n = 1, 'organizatorius nepakeitė būsimo';
end $$;
reset role;
do $$ begin assert (select count(*) from public.tournament_admin_log) = 0, 'organizatoriaus keitimas pateko į žurnalą'; end $$;

\echo 'A2. Administratorius taiso vykstantį turnyrą'
set role authenticated;
set request.jwt.claim.sub = 'ad200000-0000-4000-8000-0000000000a2';
do $$ declare n int; v_live uuid := (select id from ax where k = 'live'); begin
  update public.tournaments set title = 'Vykstanti taurė (pataisyta)', description = 'Taisyklės patikslintos', ends_at = ends_at + interval '1 day'
   where id = v_live;
  get diagnostics n = row_count;
  assert n = 1, 'administratorius nepakeitė';
  begin update public.tournaments set format = 'biggest' where id = v_live; raise exception 'FAIL: formatas pakeistas';
  exception when raise_exception then if sqlerrm <> 'started_rules_locked' then raise; end if; end;
  begin update public.tournaments set starts_at = now() where id = v_live; raise exception 'FAIL: pradžia pakeista';
  exception when raise_exception then if sqlerrm <> 'started_rules_locked' then raise; end if; end;
  begin update public.tournaments set prize_fund_cents = 50000, prize_split = '[100]' where id = v_live; raise exception 'FAIL: fondas pakeistas';
  exception when raise_exception then if sqlerrm <> 'started_rules_locked' then raise; end if; end;
  begin update public.tournaments set ends_at = now() - interval '1 hour' where id = v_live; raise exception 'FAIL: pabaiga praeityje';
  exception when raise_exception then if sqlerrm <> 'ends_in_past' then raise; end if; end;
  -- Rūšys – taisyklė: vykstančiame neleidžiama
  begin insert into public.tournament_species (tournament_id, species_id) values (v_live, 2); raise exception 'FAIL: rūšis pridėta';
  exception when insufficient_privilege then null; end;
  begin insert into public.tournament_divisions (tournament_id, name) values (v_live, 'Valtis'); raise exception 'FAIL: divizionas pridėtas';
  exception when insufficient_privilege then null; end;
  -- Rėmėjai – galima
  insert into public.tournament_sponsors (tournament_id, name, sort) values (v_live, 'Žvejų parduotuvė', 0);
  assert (select title from public.tournaments where id = v_live) = 'Vykstanti taurė (pataisyta)', 'pavadinimas';
  assert (select organizer_id from public.tournaments where id = v_live) = 'ad100000-0000-4000-8000-0000000000a1', 'organizatorius pasikeitė';
end $$;
-- Būsimą – gali keisti viską, kaip organizatorius
do $$ declare v_soon uuid := (select id from ax where k = 'soon'); begin
  update public.tournaments set format = 'top_n_sum', top_n = 3 where id = v_soon;
  insert into public.tournament_species (tournament_id, species_id) values (v_soon, 2);
  insert into public.tournament_divisions (tournament_id, name) values (v_soon, 'Krantas');
  -- Organizatoriaus pakeisti negalima (grąžinama sena reikšmė)
  update public.tournaments set organizer_id = auth.uid() where id = v_soon;
  assert (select organizer_id from public.tournaments where id = v_soon) = 'ad100000-0000-4000-8000-0000000000a1', 'organizatorius perimtas';
  assert (select count(*) from public.tournament_admin_log where action = 'update') = 2, format('žurnalo įrašai %s', (select count(*) from public.tournament_admin_log));
  assert (select changes ? 'title' and changes ? 'ends_at' and not changes ? 'organizer_id' from public.tournament_admin_log
           where tournament_id = (select id from ax where k = 'live')), 'pakeitimų sąrašas';
  assert (select actor_id from public.tournament_admin_log limit 1) = auth.uid(), 'kas pakeitė';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.notification_outbox where user_id = 'ad100000-0000-4000-8000-0000000000a1' and dedupe like 'tadmin:%') = 2,
    'organizatorius negavo pranešimo apie pakeitimą';
end $$;

\echo 'A3. Pašalinimas su priežastimi'
set role authenticated;
set request.jwt.claim.sub = 'ad500000-0000-4000-8000-0000000000a5';
do $$ begin
  begin perform public.admin_delete_tournament((select id from ax where k = 'live'), 'Tikrintojas bando'); raise exception 'FAIL: tikrintojas ištrynė';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
set request.jwt.claim.sub = 'ad200000-0000-4000-8000-0000000000a2';
do $$ declare v_live uuid := (select id from ax where k = 'live'); begin
  begin perform public.admin_delete_tournament(v_live, '  '); raise exception 'FAIL: be priežasties';
  exception when raise_exception then if sqlerrm <> 'reason_required' then raise; end if; end;
  begin perform public.admin_delete_tournament(gen_random_uuid(), 'Nėra tokio'); raise exception 'FAIL: nėra turnyro';
  exception when raise_exception then if sqlerrm <> 'not_found' then raise; end if; end;
  perform public.admin_delete_tournament(v_live, 'Netikras turnyras, skundai dalyvių');
  assert not exists (select 1 from public.tournaments where id = v_live), 'neištrinta';
  assert (select count(*) from public.tournament_admin_log where action = 'delete' and tournament_id = v_live
           and reason = 'Netikras turnyras, skundai dalyvių' and (changes->>'entries')::int = 2
           and changes->'tournament'->>'title' = 'Vykstanti taurė (pataisyta)' and not (changes->'tournament') ? 'invite_code') = 1, 'žurnalas po pašalinimo';
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from public.entries where tournament_id = (select id from ax where k = 'live')), 'liko registracijos';
  assert exists (select 1 from public.catches where photo_path = 'ad400000-0000-4000-8000-0000000000a4/adm1.jpg'), 'laimikis dingo kartu su turnyru';
  assert exists (select 1 from public.notification_outbox where user_id = 'ad400000-0000-4000-8000-0000000000a4' and dedupe like 'tdel:%'
                  and body like '%Netikras turnyras%'), 'dalyvis negavo pranešimo';
  assert exists (select 1 from public.notification_outbox where user_id = 'ad100000-0000-4000-8000-0000000000a1' and dedupe like 'tdel:%'), 'organizatorius negavo pranešimo';
end $$;
set role anon;
do $$ begin
  begin perform public.admin_delete_tournament((select id from ax where k = 'soon'), 'Anonimas bando'); raise exception 'FAIL: anonimas';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.tournament_admin_log; raise exception 'FAIL: anonimas mato žurnalą';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.sub;
\echo '   ok – administratoriaus veiksmai su turnyrais'
