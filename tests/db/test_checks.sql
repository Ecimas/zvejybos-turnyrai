-- 0017: atsitiktiniai patikrinimai.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'K1. Kas gali paprašyti patikros'

insert into auth.users (id, email) values
  ('c1000000-0000-4000-8000-0000000000c1', 'chk-mod@test.lt'),
  ('c2000000-0000-4000-8000-0000000000c2', 'chk-zvejys@test.lt'),
  ('c3000000-0000-4000-8000-0000000000c3', 'chk-kitas@test.lt'),
  ('c4000000-0000-4000-8000-0000000000c4', 'chk-teisejas@test.lt');
update public.profiles set roles = array['moderator'] where id = 'c1000000-0000-4000-8000-0000000000c1';
update public.profiles set roles = array['judge'] where id = 'c4000000-0000-4000-8000-0000000000c4';

create temp table kx (k text primary key, id uuid);
grant select, insert on kx to authenticated;

set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code)
           values ('c3000000-0000-4000-8000-0000000000c3', 'Patikrų taurė', 'biggest', now() - interval '1 day', now() + interval '1 day', 'chk0000001') returning id)
insert into kx select 'tour', id from t;
insert into public.entries (tournament_id, user_id, joined_at)
  select id, u, now() - interval '2 days' from kx, unnest(array['c2000000-0000-4000-8000-0000000000c2', 'c1000000-0000-4000-8000-0000000000c1']::uuid[]) u where k = 'tour';
set session_replication_role = origin;

set request.jwt.claim.sub = 'c2000000-0000-4000-8000-0000000000c2';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 880, now() - interval '3 hours', 'c2000000-0000-4000-8000-0000000000c2/a.jpg', repeat('5a', 32)) returning id)
insert into kx select 'z1', id from c;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 700, now() - interval '2 hours', 'c2000000-0000-4000-8000-0000000000c2/b.jpg', repeat('5b', 32)) returning id)
insert into kx select 'z2', id from c;
set request.jwt.claim.sub = 'c1000000-0000-4000-8000-0000000000c1';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 500, now() - interval '2 hours', 'c1000000-0000-4000-8000-0000000000c1/m.jpg', repeat('5c', 32)) returning id)
insert into kx select 'm1', id from c;
select public.review_catch(id, true, null) from kx where k in ('z1', 'z2');
reset request.jwt.claim.sub;
-- Žvejys turi push prenumeratą – gaus pranešimą
set role authenticated;
set request.jwt.claim.sub = 'c2000000-0000-4000-8000-0000000000c2';
select public.save_push_subscription('https://push.example.com/chk', repeat('Z', 87), repeat('z', 22));
reset role;

set role authenticated;
do $$
declare e text; who uuid;
begin
  foreach who in array array['c3000000-0000-4000-8000-0000000000c3', 'c4000000-0000-4000-8000-0000000000c4', 'c2000000-0000-4000-8000-0000000000c2']::uuid[] loop
    perform set_config('request.jwt.claim.sub', who::text, true);
    begin
      perform public.request_catch_check((select id from kx where k = 'z1'), 'Su atviru delnu', 2);
      raise exception 'FAIL: % paprašė patikros', who;
    exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
    begin
      perform public.random_check_candidate();
      raise exception 'FAIL: % gavo kandidatą', who;
    exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  end loop;
  perform set_config('request.jwt.claim.sub', 'c1000000-0000-4000-8000-0000000000c1', true);
  foreach e in array array['own', 'hours0', 'hours49', 'short'] loop
    begin
      case e
        when 'own'     then perform public.request_catch_check((select id from kx where k = 'm1'), 'Su atviru delnu', 2);
        when 'hours0'  then perform public.request_catch_check((select id from kx where k = 'z1'), 'Su atviru delnu', 0);
        when 'hours49' then perform public.request_catch_check((select id from kx where k = 'z1'), 'Su atviru delnu', 49);
        when 'short'   then perform public.request_catch_check((select id from kx where k = 'z1'), ' x ', 2);
      end case;
      raise exception 'FAIL: leista – %', e;
    exception when raise_exception then if sqlerrm like 'FAIL%' then raise; end if; end;
  end loop;
  -- Kandidatai renkami iš visų vykstančių turnyrų: z1 (lyderio didžiausias) pasitaiko, z2 (ne didžiausias) – niekada.
  assert (select bool_or(x = (select id from kx where k = 'z1')) and not bool_or(x = (select id from kx where k = 'z2'))
            from (select public.random_check_candidate() x from generate_series(1, 400)) q), 'kandidatas – lyderio didžiausias laimikis';
  insert into kx select 'chk1', public.request_catch_check((select id from kx where k = 'z1'), '  Su atviru delnu šalia žuvies  ', 2);
  begin
    perform public.request_catch_check((select id from kx where k = 'z1'), 'Dar kartą', 2);
    raise exception 'FAIL: dvi patikros vienu metu';
  exception when raise_exception then if sqlerrm <> 'check_exists' then raise; end if; end;
  assert not exists (select 1 from generate_series(1, 60) g where public.random_check_candidate() = (select id from kx where k = 'z1')),
    'tikrintas laimikis vėl kandidatas';
end $$;
reset role;

do $$ declare v record; begin
  select * into v from public.catch_checks where id = (select id from kx where k = 'chk1');
  assert v.status = 'open' and v.instruction = 'Su atviru delnu šalia žuvies', 'patikra neįrašyta';
  assert v.due_at between now() + interval '119 minutes' and now() + interval '121 minutes', 'terminas blogas';
  select * into v from public.notification_outbox where dedupe = 'check:' || (select id from kx where k = 'chk1');
  assert v.user_id = 'c2000000-0000-4000-8000-0000000000c2' and v.title = 'Papildoma patikra', 'nėra pranešimo';
  assert v.url = '#/patikra/' || (select id from kx where k = 'chk1'), 'bloga nuoroda';
  assert v.body like 'Su atviru delnu šalia žuvies. Atsiųsk nuotrauką per 2 val.', v.body;
end $$;

\echo '   ok'
\echo 'K2. Atsakymas: tik savininkas, tik nauja nuotrauka, tik laiku'

set role authenticated;
set request.jwt.claim.sub = 'c3000000-0000-4000-8000-0000000000c3';
do $$ begin
  assert (select count(*) from public.catch_checks) = 0, 'kitas mato svetimą patikrą';
  begin
    perform public.answer_catch_check((select id from kx where k = 'chk1'), 'c3000000-0000-4000-8000-0000000000c3/check-x.jpg', repeat('ab', 32));
    raise exception 'FAIL: kitas atsakė';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
set request.jwt.claim.sub = 'c2000000-0000-4000-8000-0000000000c2';
do $$
declare p text := 'c2000000-0000-4000-8000-0000000000c2/check-' || (select id from kx where k = 'chk1') || '.jpg';
begin
  assert (select count(*) from public.catch_checks) = 1, 'savininkas nemato patikros';
  begin
    perform public.answer_catch_check((select id from kx where k = 'chk1'), 'c2000000-0000-4000-8000-0000000000c2/a.jpg', repeat('ab', 32));
    raise exception 'FAIL: kitas kelias';
  exception when raise_exception then if sqlerrm <> 'check_path' then raise; end if; end;
  begin
    perform public.answer_catch_check((select id from kx where k = 'chk1'), p, repeat('ab', 32));
    raise exception 'FAIL: be įkeltos nuotraukos';
  exception when raise_exception then if sqlerrm <> 'check_no_photo' then raise; end if; end;
end $$;
reset role;
insert into storage.objects (bucket_id, name)
  select 'catch-photos', 'c2000000-0000-4000-8000-0000000000c2/check-' || id || '.jpg' from kx where k = 'chk1';
set role authenticated;
set request.jwt.claim.sub = 'c2000000-0000-4000-8000-0000000000c2';
do $$
declare p text := 'c2000000-0000-4000-8000-0000000000c2/check-' || (select id from kx where k = 'chk1') || '.jpg';
begin
  begin
    perform public.answer_catch_check((select id from kx where k = 'chk1'), p, repeat('5a', 32));
    raise exception 'FAIL: ta pati sena nuotrauka';
  exception when raise_exception then if sqlerrm <> 'check_duplicate' then raise; end if; end;
  perform public.answer_catch_check((select id from kx where k = 'chk1'), p, repeat('6a', 32));
  assert (select status from public.catch_checks where id = (select id from kx where k = 'chk1')) = 'answered';
  begin
    perform public.answer_catch_check((select id from kx where k = 'chk1'), p, repeat('6b', 32));
    raise exception 'FAIL: atsakė antrą kartą';
  exception when raise_exception then if sqlerrm <> 'check_closed' then raise; end if; end;
end $$;
reset role;

\echo '   ok'
\echo 'K3. Sprendimas, pasibaigęs terminas, nepraėjusi patikra'
create temp table trust0 as select trust_score from public.profiles where id = 'c2000000-0000-4000-8000-0000000000c2';
set role authenticated;
set request.jwt.claim.sub = 'c4000000-0000-4000-8000-0000000000c4';
do $$ begin
  begin
    perform public.resolve_catch_check((select id from kx where k = 'chk1'), true, null);
    raise exception 'FAIL: teisėjas išsprendė patikrą';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
-- Savo patikros spręsti negalima (net turint teisę): žvejys tampa tikrintoju
reset role;
update public.profiles set roles = array['moderator'] where id = 'c2000000-0000-4000-8000-0000000000c2';
set role authenticated;
set request.jwt.claim.sub = 'c2000000-0000-4000-8000-0000000000c2';
do $$ begin
  begin
    perform public.resolve_catch_check((select id from kx where k = 'chk1'), true, null);
    raise exception 'FAIL: išsprendė savo patikrą';
  exception when raise_exception then if sqlerrm <> 'check_own' then raise; end if; end;
end $$;
reset role;
update public.profiles set roles = '{}' where id = 'c2000000-0000-4000-8000-0000000000c2';
set role authenticated;
set request.jwt.claim.sub = 'c1000000-0000-4000-8000-0000000000c1';
select public.resolve_catch_check(id, true, null) from kx where k = 'chk1';
-- Antra patikra – neatsakyta laiku
insert into kx select 'chk2', public.request_catch_check((select id from kx where k = 'z1'), 'Su šiandienos data ant lapelio', 1);
-- Trečia – atsakyta, bet nepraėjo
insert into kx select 'chk3', public.request_catch_check((select id from kx where k = 'z2'), 'Iš kito kampo', 1);
reset role;
grant select on trust0 to authenticated;
do $$ begin
  assert (select status from public.catch_checks where id = (select id from kx where k = 'chk1')) = 'passed';
  assert (select status from public.catches where id = (select id from kx where k = 'z1')) = 'approved', 'praėjęs laimikis turi likti';
  assert (select trust_score from public.profiles where id = 'c2000000-0000-4000-8000-0000000000c2') = least(100, (select trust_score from trust0) + 2), 'patikimumas';
end $$;
update public.catch_checks set due_at = now() - interval '1 minute' where id = (select id from kx where k = 'chk2');
do $$ begin
  assert public.expire_catch_checks() = 1, 'turėjo pasibaigti viena';
  assert public.expire_catch_checks() = 0, 'pasibaigė antrą kartą';
  assert (select status from public.catch_checks where id = (select id from kx where k = 'chk2')) = 'expired';
  assert (select status = 'rejected' and reject_reason = 'Laiku neatsiųsta papildoma nuotrauka' from public.catches where id = (select id from kx where k = 'z1')),
    'neatsakius laimikis turi būti atmestas';
  assert exists (select 1 from public.notification_outbox where dedupe = 'review:' || (select id from kx where k = 'z1') || ':rejected'), 'nėra atmetimo pranešimo';
end $$;
insert into storage.objects (bucket_id, name)
  select 'catch-photos', 'c2000000-0000-4000-8000-0000000000c2/check-' || id || '.jpg' from kx where k = 'chk3';
set role authenticated;
set request.jwt.claim.sub = 'c2000000-0000-4000-8000-0000000000c2';
select public.answer_catch_check(id, 'c2000000-0000-4000-8000-0000000000c2/check-' || id || '.jpg', repeat('6c', 32)) from kx where k = 'chk3';
set request.jwt.claim.sub = 'c1000000-0000-4000-8000-0000000000c1';
do $$ begin
  begin
    perform public.resolve_catch_check((select id from kx where k = 'chk2'), true, null);
    raise exception 'FAIL: pasibaigusi patikra „praėjo“';
  exception when raise_exception then if sqlerrm <> 'check_state' then raise; end if; end;
  perform public.resolve_catch_check((select id from kx where k = 'chk3'), false, 'Kita žuvis');
end $$;
reset role;
do $$ begin
  assert (select status = 'rejected' and reject_reason = 'Nepraėjo papildomos patikros: Kita žuvis' from public.catches where id = (select id from kx where k = 'z2')),
    'nepraėjus laimikis turi būti atmestas';
  assert (select status from public.catch_checks where id = (select id from kx where k = 'chk3')) = 'failed';
  assert (select count(*) from public.leaderboard((select id from kx where k = 'tour')) where user_id = 'c2000000-0000-4000-8000-0000000000c2') = 0,
    'atmesti laimikiai vis dar lentelėje';
end $$;
reset request.jwt.claim.sub;

\echo '   ok'
