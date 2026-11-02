-- 0039: asmeninės žinutės tarp žvejų.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'D1. Pradėti pokalbį: vienas tarp dviejų žvejų, ne sau, ne neegzistuojančiam'

insert into auth.users (id, email) values
  ('d9100000-0000-4000-8000-0000000000a1', 'dm-a@test.lt'),
  ('d9200000-0000-4000-8000-0000000000a2', 'dm-b@test.lt'),
  ('d9300000-0000-4000-8000-0000000000a3', 'dm-c@test.lt'),
  ('d9400000-0000-4000-8000-0000000000a4', 'dm-owner@test.lt');
update public.profiles set nickname = 'Dm_' || substr(id::text, 1, 3) where id::text like 'd9_00000-%';
update public.profiles set roles = array['owner'] where id = 'd9400000-0000-4000-8000-0000000000a4';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
select id, 'https://push.test/' || id, repeat('x', 87), repeat('x', 22) from auth.users where id::text like 'd9_00000-%';
create temp table dx (k text primary key, id uuid);
grant select, insert on dx to authenticated, anon;

set role authenticated;
-- B (didesnis id) pradeda pokalbį su A
set request.jwt.claim.sub = 'd9200000-0000-4000-8000-0000000000a2';
do $$ declare c uuid; c2 uuid; begin
  c := public.start_direct('d9100000-0000-4000-8000-0000000000a1');
  insert into dx values ('ab', c);
  c2 := public.start_direct('d9100000-0000-4000-8000-0000000000a1');
  assert c = c2, 'antras kartas – naujas pokalbis';
  assert (select organizer_id = 'd9100000-0000-4000-8000-0000000000a1' and participant_id = 'd9200000-0000-4000-8000-0000000000a2'
            and kind = 'direct' and tournament_id is null and started_by = auth.uid() from public.conversations where id = c), 'pora ne tvarkinga';
  -- Tuščias pokalbis sąraše nerodomas
  assert not exists (select 1 from public.my_conversations() where id = c), 'tuščias pokalbis sąraše';
  begin perform public.start_direct(auth.uid()); raise exception 'FAIL: pokalbis su savimi';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.start_direct('d9900000-0000-4000-8000-0000000000ff'); raise exception 'FAIL: neegzistuojantis žvejys';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  perform public.send_message(c, 'Labas, kur šiandien kibo?');
end $$;
reset role;

\echo 'D2. Gavėjas mato, gauna pranešimą, atsako; trečias nemato'
do $$ begin
  assert exists (select 1 from public.notification_outbox where user_id = 'd9100000-0000-4000-8000-0000000000a1'
                   and title like 'Žinutė nuo Dm_d92%'), 'gavėjas negavo pranešimo';
end $$;
set role authenticated;
set request.jwt.claim.sub = 'd9100000-0000-4000-8000-0000000000a1';
do $$ declare r record; c uuid := (select id from dx where k = 'ab'); begin
  -- A pusė „organizatoriaus“ stulpelyje, bet tai ne organizatorius
  select * into r from public.my_conversations() where id = c;
  assert r.kind = 'direct' and r.i_organize = false and r.other_id = 'd9200000-0000-4000-8000-0000000000a2' and r.unread = 1,
    format('A sąrašas: %s', r);
  assert public.my_unread_count() >= 1, 'neperskaitytų skaičius';
  perform public.send_message(c, 'Prie marių, ešeriai!');
  perform public.mark_conversation_read(c);
  assert (select unread from public.my_conversations() where id = c) = 0, 'perskaityta';
end $$;
set request.jwt.claim.sub = 'd9200000-0000-4000-8000-0000000000a2';
do $$ declare r record; c uuid := (select id from dx where k = 'ab'); begin
  select * into r from public.my_conversations() where id = c;
  assert r.i_organize = false and r.unread = 1 and r.other_wrote and r.last_body = 'Prie marių, ešeriai!', format('B sąrašas: %s', r);
end $$;
set request.jwt.claim.sub = 'd9300000-0000-4000-8000-0000000000a3';
do $$ declare c uuid := (select id from dx where k = 'ab'); begin
  assert not exists (select 1 from public.conversations where id = c), 'trečias mato pokalbį';
  assert not exists (select 1 from public.messages where conversation_id = c), 'trečias mato žinutes';
  begin perform public.send_message(c, 'įsiterpiu'); raise exception 'FAIL: trečias rašo';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
reset role;

\echo 'D3. Blokavimas, pranešimas apie žinutę, dienos riba, jungiklis, blokuotas žvejys'
set role authenticated;
set request.jwt.claim.sub = 'd9100000-0000-4000-8000-0000000000a1';
do $$ declare c uuid := (select id from dx where k = 'ab'); begin
  perform public.report_message((select id from public.messages where body = 'Labas, kur šiandien kibo?'), 'Šlamštas');
  perform public.block_conversation(c, true);
end $$;
set request.jwt.claim.sub = 'd9200000-0000-4000-8000-0000000000a2';
do $$ declare c uuid := (select id from dx where k = 'ab'); begin
  begin perform public.send_message(c, 'ei'); raise exception 'FAIL: rašo užblokuotame';
  exception when raise_exception then if sqlerrm <> 'blocked' then raise; end if; end;
  -- Užblokavęs gali tik pats atblokuoti
  perform public.block_conversation(c, false);
  assert (select blocked from public.my_conversations() where id = c), 'atblokavo ne tas, kas blokavo';
end $$;
set request.jwt.claim.sub = 'd9400000-0000-4000-8000-0000000000a4';
do $$ begin
  assert exists (select 1 from public.reported_messages() where body = 'Labas, kur šiandien kibo?' and reason = 'Šlamštas'), 'savininkas nemato pranešimo';
end $$;
reset role;
-- Dienos riba: 15 naujų pokalbių per parą
insert into auth.users (id, email)
select ('d95' || i || '000-0000-4000-8000-0000000000aa')::uuid, 'dm-x' || i || '@test.lt' from generate_series(10, 26) i;
update public.profiles set nickname = 'DmX_' || substr(id::text, 4, 2) where id::text like 'd95__000-%';
set role authenticated;
set request.jwt.claim.sub = 'd9300000-0000-4000-8000-0000000000a3';
do $$ declare i int; begin
  for i in 10..24 loop perform public.start_direct(('d95' || i || '000-0000-4000-8000-0000000000aa')::uuid); end loop;
  begin perform public.start_direct('d9525000-0000-4000-8000-0000000000aa'); raise exception 'FAIL: dienos riba';
  exception when raise_exception then if sqlerrm <> 'dm_limit' then raise; end if; end;
  -- Esamą atidaryti galima ir pasiekus ribą
  perform public.start_direct('d9510000-0000-4000-8000-0000000000aa');
end $$;
reset role;
-- Jungiklis išjungtas: nei naujų pokalbių, nei žinučių
update public.app_features set enabled = false where key = 'direct_messages';
set role authenticated;
set request.jwt.claim.sub = 'd9100000-0000-4000-8000-0000000000a1';
do $$ declare c uuid := (select id from dx where k = 'ab'); begin
  begin perform public.start_direct('d9300000-0000-4000-8000-0000000000a3'); raise exception 'FAIL: pradėjo išjungus';
  exception when raise_exception then if sqlerrm <> 'feature_off' then raise; end if; end;
  perform public.block_conversation(c, false);
  begin perform public.send_message(c, 'ar veikia?'); raise exception 'FAIL: rašo išjungus';
  exception when raise_exception then if sqlerrm <> 'feature_off' then raise; end if; end;
end $$;
reset role;
update public.app_features set enabled = true where key = 'direct_messages';
-- Užblokuotas žvejys rašyti negali
insert into public.user_bans (user_id, reason, banned_by) values ('d9300000-0000-4000-8000-0000000000a3', 'Testas', 'd9400000-0000-4000-8000-0000000000a4');
set role authenticated;
set request.jwt.claim.sub = 'd9300000-0000-4000-8000-0000000000a3';
do $$ begin
  begin perform public.start_direct('d9400000-0000-4000-8000-0000000000a4'); raise exception 'FAIL: užblokuotas pradėjo';
  exception when raise_exception then if sqlerrm <> 'banned' then raise; end if; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin perform public.start_direct('d9100000-0000-4000-8000-0000000000a1'); raise exception 'FAIL: anon';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- Senieji pokalbiai nepaliesti: org/system/support taisyklės galioja
do $$ begin
  begin insert into public.conversations (kind, participant_id) values ('direct', 'd9100000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL: direct be antro žvejo';
  exception when check_violation then null; end;
  begin insert into public.conversations (kind, organizer_id, participant_id) values ('direct', 'd9200000-0000-4000-8000-0000000000a2', 'd9100000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL: netvarkinga pora';
  exception when check_violation then null; end;
  begin insert into public.conversations (kind, participant_id) values ('org', 'd9100000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL: org be organizatoriaus';
  exception when check_violation then null; end;
end $$;
\echo '   ok – asmeninės žinutės'
