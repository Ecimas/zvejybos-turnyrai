-- 0035: turnyro nustatymai – organizatorius po starto, savininkas, dalyviai, kvietimas, viršelis.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'S1. Organizatorius po starto keičia tik saugius laukus'

insert into auth.users (id, email) values
  ('5e100000-0000-4000-8000-0000000000b1', 'set-org@test.lt'),    -- organizatorius
  ('5e200000-0000-4000-8000-0000000000b2', 'set-owner@test.lt'),  -- savininkas
  ('5e300000-0000-4000-8000-0000000000b3', 'set-admin@test.lt'),  -- administratorius
  ('5e400000-0000-4000-8000-0000000000b4', 'set-part@test.lt'),   -- dalyvis
  ('5e500000-0000-4000-8000-0000000000b5', 'set-user@test.lt');   -- pašalinis
update public.profiles set roles = array['owner'] where id = '5e200000-0000-4000-8000-0000000000b2';
update public.profiles set roles = array['admin'] where id = '5e300000-0000-4000-8000-0000000000b3';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('5e400000-0000-4000-8000-0000000000b4', 'https://push.test/set-b4', repeat('x', 87), repeat('x', 22)),
       ('5e100000-0000-4000-8000-0000000000b1', 'https://push.test/set-b1', repeat('x', 87), repeat('x', 22));
create temp table sx (k text primary key, id uuid);
grant select on sx to authenticated, anon;

set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, top_n, starts_at, ends_at, invite_code, visibility, created_at)
           values ('5e100000-0000-4000-8000-0000000000b1', 'Nustatymų taurė', 'biggest', 3, now() - interval '1 day', now() + interval '2 days', 'set0000001', 'private', now() - interval '3 days')
           returning id)
insert into sx select 'live', id from t;
insert into public.tournament_species (tournament_id, species_id) select id, 1 from sx where k = 'live';
with d as (insert into public.tournament_divisions (tournament_id, name, sort) select id, 'Krantas', 0 from sx where k = 'live' returning id)
insert into sx select 'div', id from d;
insert into public.entries (tournament_id, user_id, joined_at)
  select (select id from sx where k = 'live'), u, now() - interval '2 days'
    from unnest(array['5e100000-0000-4000-8000-0000000000b1', '5e400000-0000-4000-8000-0000000000b4']::uuid[]) u;
set session_replication_role = origin;

set role authenticated;
set request.jwt.claim.sub = '5e100000-0000-4000-8000-0000000000b1';
do $$ declare n int; v uuid := (select id from sx where k = 'live'); begin
  update public.tournaments set title = 'Nustatymų taurė 2026', description = 'Tik spiningu', ends_at = ends_at + interval '1 day' where id = v;
  get diagnostics n = row_count;
  assert n = 1, 'organizatorius nepakeitė pavadinimo po starto';
  begin update public.tournaments set format = 'top_n_sum' where id = v; raise exception 'FAIL: organizatorius pakeitė formatą';
  exception when raise_exception then if sqlerrm <> 'started_rules_locked' then raise; end if; end;
  begin update public.tournaments set prize_fund_cents = 10000, prize_split = '[100]' where id = v; raise exception 'FAIL: organizatorius pakeitė fondą';
  exception when raise_exception then if sqlerrm <> 'started_rules_locked' then raise; end if; end;
  begin update public.tournaments set invite_code = 'nulauztas1' where id = v; raise exception 'FAIL: kodas pakeistas tiesiogiai';
  exception when raise_exception then if sqlerrm <> 'started_rules_locked' then raise; end if; end;
  begin insert into public.tournament_species (tournament_id, species_id) values (v, 2); raise exception 'FAIL: organizatorius pridėjo rūšį';
  exception when insufficient_privilege then null; end;
  -- Viršelis: tik savo turnyro kelias
  update public.tournaments set cover_path = v::text || '/cover-abc123.webp' where id = v;
  begin update public.tournaments set cover_path = 'kitas/cover-abc123.webp' where id = v; raise exception 'FAIL: svetimas viršelio kelias';
  exception when check_violation then null; end;
  assert public.can_manage_tournament_cover(v::text || '/cover-zz9900.webp'), 'organizatorius negali įkelti viršelio';
  assert not public.can_manage_tournament_cover(v::text || '/x.webp'), 'netinkamas viršelio vardas';
end $$;
reset role;
do $$ begin
  assert (select count(*) from public.tournament_admin_log where tournament_id = (select id from sx where k = 'live')) = 2,
    format('organizatoriaus pakeitimai po starto turi patekti į žurnalą (%s)', (select count(*) from public.tournament_admin_log where tournament_id = (select id from sx where k = 'live')));
  assert not exists (select 1 from public.notification_outbox where user_id = '5e100000-0000-4000-8000-0000000000b1' and dedupe like 'tadmin:%'),
    'organizatorius gavo pranešimą apie savo paties pakeitimą';
end $$;

\echo 'S2. Administratorius – kaip anksčiau, savininkas – viską'
set role authenticated;
set request.jwt.claim.sub = '5e300000-0000-4000-8000-0000000000b3';
do $$ declare v uuid := (select id from sx where k = 'live'); begin
  begin update public.tournaments set min_length_mm = 400 where id = v; raise exception 'FAIL: administratorius pakeitė min. ilgį';
  exception when raise_exception then if sqlerrm <> 'started_rules_locked' then raise; end if; end;
  begin insert into public.tournament_divisions (tournament_id, name) values (v, 'Valtis'); raise exception 'FAIL: administratorius pridėjo divizioną';
  exception when insufficient_privilege then null; end;
  begin perform public.notify_rule_change(v, 'Klaida taisyklėse', 'Min. ilgis 40 cm'); raise exception 'FAIL: administratorius pranešė apie taisykles';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
set request.jwt.claim.sub = '5e200000-0000-4000-8000-0000000000b2';
do $$ declare n int; v uuid := (select id from sx where k = 'live'); begin
  update public.tournaments set format = 'top_n_sum', top_n = 2, min_length_mm = 400, prize_fund_cents = 30000, prize_split = '[50,30,20]',
         starts_at = starts_at - interval '1 hour' where id = v;
  get diagnostics n = row_count;
  assert n = 1, 'savininkas nepakeitė taisyklių';
  insert into public.tournament_species (tournament_id, species_id) values (v, 2);
  insert into public.tournament_divisions (tournament_id, name, sort) values (v, 'Valtis', 1);
  begin update public.tournaments set ends_at = now() - interval '2 hours' where id = v; raise exception 'FAIL: pabaiga praeityje';
  exception when raise_exception then if sqlerrm <> 'ends_in_past' then raise; end if; end;
  begin perform public.notify_rule_change(v, ' ', 'x'); raise exception 'FAIL: be priežasties';
  exception when raise_exception then if sqlerrm <> 'reason_required' then raise; end if; end;
  n := public.notify_rule_change(v, 'Pagal nuostatus sumuojamos 2 žuvys', 'Formatas: Kelių ilgių suma (2)');
  assert n = 2, format('pranešimus turėjo gauti dalyvis ir organizatorius (%s)', n);
end $$;
reset role;
do $$ declare v uuid := (select id from sx where k = 'live'); begin
  assert (select format from public.tournaments where id = v) = 'top_n_sum', 'formatas nepasikeitė';
  assert (select count(*) from public.tournament_species where tournament_id = v) = 2, 'rūšis nepridėta';
  assert exists (select 1 from public.tournament_admin_log where tournament_id = v and changes ? 'format' and actor_id = '5e200000-0000-4000-8000-0000000000b2'),
    'savininko pakeitimas ne žurnale';
  assert exists (select 1 from public.tournament_admin_log where tournament_id = v and changes ? 'rules_notice' and reason like 'Pagal nuostatus%'), 'priežastis ne žurnale';
  assert exists (select 1 from public.notification_outbox where user_id = '5e400000-0000-4000-8000-0000000000b4' and dedupe like 'trules:%'
                  and body like '%Pagal nuostatus%'), 'dalyvis negavo pranešimo apie taisykles';
  assert exists (select 1 from public.notification_outbox where user_id = '5e100000-0000-4000-8000-0000000000b1' and dedupe like 'tadmin:%'),
    'organizatorius negavo pranešimo apie savininko pakeitimą';
end $$;

\echo 'S3. Dalyviai ir kvietimas'
set role authenticated;
set request.jwt.claim.sub = '5e500000-0000-4000-8000-0000000000b5';
do $$ declare v uuid := (select id from sx where k = 'live'); begin
  begin perform public.remove_participant(v, '5e400000-0000-4000-8000-0000000000b4', 'x'); raise exception 'FAIL: pašalinis pašalino dalyvį';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.regenerate_invite(v); raise exception 'FAIL: pašalinis pakeitė kvietimą';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.set_participant_division(v, '5e400000-0000-4000-8000-0000000000b4', null); raise exception 'FAIL: pašalinis pakeitė divizioną';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  assert not public.can_manage_tournament_cover(v::text || '/cover-abc123.webp'), 'pašalinis gali įkelti viršelį';
end $$;
set request.jwt.claim.sub = '5e100000-0000-4000-8000-0000000000b1';
do $$ declare v uuid := (select id from sx where k = 'live'); c text; begin
  perform public.set_participant_division(v, '5e400000-0000-4000-8000-0000000000b4', (select id from sx where k = 'div'));
  assert (select division_id from public.entries where tournament_id = v and user_id = '5e400000-0000-4000-8000-0000000000b4') = (select id from sx where k = 'div'),
    'divizionas nepakeistas';
  begin perform public.set_participant_division(v, '5e400000-0000-4000-8000-0000000000b4', gen_random_uuid()); raise exception 'FAIL: svetimas divizionas';
  exception when raise_exception then if sqlerrm <> 'division_invalid' then raise; end if; end;
  c := public.regenerate_invite(v);
  assert c ~ '^[0-9a-f]{10}$' and c <> 'set0000001', format('naujas kodas %s', c);
  assert (select invite_code from public.tournaments where id = v) = c, 'kodas neišsaugotas';
  perform public.remove_participant(v, '5e400000-0000-4000-8000-0000000000b4', 'Nesilaikė taisyklių');
  assert not exists (select 1 from public.entries where tournament_id = v and user_id = '5e400000-0000-4000-8000-0000000000b4'), 'dalyvis nepašalintas';
  begin perform public.remove_participant(v, '5e400000-0000-4000-8000-0000000000b4', null); raise exception 'FAIL: pašalintas dukart';
  exception when raise_exception then if sqlerrm <> 'not_found' then raise; end if; end;
end $$;
reset role;
do $$ declare v uuid := (select id from sx where k = 'live'); begin
  assert exists (select 1 from public.notification_outbox where user_id = '5e400000-0000-4000-8000-0000000000b4' and dedupe like 'tkick:%'
                  and body like '%Nesilaikė taisyklių%'), 'pašalintas dalyvis negavo pranešimo';
  assert exists (select 1 from public.tournament_admin_log where tournament_id = v and changes ? 'participant_removed'), 'pašalinimas ne žurnale';
  assert not exists (select 1 from public.tournament_admin_log where tournament_id = v and changes::text like '%' || (select invite_code from public.tournaments where id = v) || '%'),
    'kvietimo kodas pateko į žurnalą';
end $$;
set role anon;
do $$ begin
  begin perform public.regenerate_invite((select id from sx where k = 'live')); raise exception 'FAIL: anonimas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.sub;
\echo '   ok – turnyro nustatymai'
