-- 0037: pranešimų centras („Svarbu“) ir klubų pokalbiai.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'N1. Pranešimų centras: išsaugoma net be telefono pranešimų, pokalbių žinutės – ne'

insert into auth.users (id, email) values
  ('c7100000-0000-4000-8000-0000000000d1', 'cc-owner@test.lt'),   -- klubo savininkas
  ('c7200000-0000-4000-8000-0000000000d2', 'cc-admin@test.lt'),   -- klubo valdytojas
  ('c7300000-0000-4000-8000-0000000000d3', 'cc-member@test.lt'),  -- narys (su pranešimais)
  ('c7400000-0000-4000-8000-0000000000d4', 'cc-member2@test.lt'), -- narys
  ('c7500000-0000-4000-8000-0000000000d5', 'cc-out@test.lt'),     -- ne narys
  ('c7600000-0000-4000-8000-0000000000d6', 'cc-appowner@test.lt');-- programėlės savininkas
update public.profiles set nickname = 'Cc_' || substr(id::text, 1, 3) where id::text like 'c7_00000-%';
update public.profiles set roles = array['owner'] where id = 'c7600000-0000-4000-8000-0000000000d6';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('c7300000-0000-4000-8000-0000000000d3', 'https://push.test/cc-d3', repeat('x', 87), repeat('x', 22)),
       ('c7400000-0000-4000-8000-0000000000d4', 'https://push.test/cc-d4', repeat('x', 87), repeat('x', 22)),
       ('c7600000-0000-4000-8000-0000000000d6', 'https://push.test/cc-d6', repeat('x', 87), repeat('x', 22));
create temp table cx (k text primary key, id uuid);
grant select on cx to authenticated, anon;

do $$ begin
  -- Be telefono pranešimų (d5 neturi prenumeratos) – vis tiek išsaugoma pranešimų centre
  assert not public.notify_user('c7500000-0000-4000-8000-0000000000d5', 'review', 'Laimikis patvirtintas', 'Lydeka 81 cm', '#/dienorastis', 'test-n1');
  assert exists (select 1 from public.user_notices where user_id = 'c7500000-0000-4000-8000-0000000000d5' and dedupe = 'test-n1'), 'pranešimas neišsaugotas';
  perform public.notify_user('c7500000-0000-4000-8000-0000000000d5', 'announcement', 'Žinutė', 'labas', '#/', 'msg:999999');
  assert not exists (select 1 from public.user_notices where dedupe = 'msg:999999'), 'pokalbio žinutė pateko į „Svarbu“';
  -- Telefono pranešimai veikia kaip anksčiau
  assert public.notify_user('c7300000-0000-4000-8000-0000000000d3', 'review', 'Laimikis patvirtintas', 'Ešerys 30 cm', '#/', 'test-n2');
  assert exists (select 1 from public.notification_outbox where dedupe = 'test-n2'), 'push neišsiųstas';
end $$;
set role authenticated;
set request.jwt.claim.sub = 'c7500000-0000-4000-8000-0000000000d5';
do $$ begin
  assert (select count(*) from public.my_notices() where unread) = 1, 'neperskaitytų pranešimų skaičius';
  assert public.my_unread_count() = 1, 'bendras skaičius su pranešimais';
  perform public.mark_notices_seen();
  assert (select count(*) from public.my_notices() where unread) = 0, 'pažymėjus – vis dar neperskaityta';
  assert (select count(*) from public.user_notices) = 1, 'mato svetimus pranešimus';
end $$;
reset role;

\echo 'N2. Klubo pokalbis: tik nariams, reakcijos, laimikio kortelė, pranešimai kas 15 min.'
set session_replication_role = replica;
with c as (insert into public.clubs (name, owner_id, open) values ('Pokalbių klubas', 'c7100000-0000-4000-8000-0000000000d1', true) returning id)
insert into cx select 'club', id from c;
insert into public.club_members (club_id, user_id, role, joined_at)
select (select id from cx where k = 'club'), u, r, now() - interval '10 days'
  from (values ('c7100000-0000-4000-8000-0000000000d1'::uuid, 'owner'), ('c7200000-0000-4000-8000-0000000000d2'::uuid, 'admin'),
               ('c7300000-0000-4000-8000-0000000000d3'::uuid, 'member'), ('c7400000-0000-4000-8000-0000000000d4'::uuid, 'member')) v(u, r);
insert into public.catches (user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status)
values ('c7300000-0000-4000-8000-0000000000d3', gen_random_uuid(), 1, 740, now() - interval '1 day', now() - interval '1 day',
        'c7300000-0000-4000-8000-0000000000d3/cc1.jpg', md5('cc1') || md5('1cc'), 'approved');
set session_replication_role = origin;

set role authenticated;
set request.jwt.claim.sub = 'c7500000-0000-4000-8000-0000000000d5';
do $$ begin
  begin perform public.club_chat_send((select id from cx where k = 'club'), 'Labas'); raise exception 'FAIL: ne narys parašė';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  assert (select count(*) from public.club_chat_messages((select id from cx where k = 'club'))) = 0, 'ne narys mato pokalbį';
end $$;
set request.jwt.claim.sub = 'c7300000-0000-4000-8000-0000000000d3';
do $$ declare v uuid := (select id from cx where k = 'club'); m1 bigint; m2 bigint; begin
  m1 := public.club_chat_send(v, '  Rytoj 6:00 prie marių?  ');
  m2 := public.club_chat_send(v, null, (select id from public.catches where photo_path like '%cc1.jpg'));
  assert (select catch->>'length_mm' from public.club_messages where id = m2) = '740', 'laimikio kortelė';
  begin perform public.club_chat_send(v, null, gen_random_uuid()); raise exception 'FAIL: svetimas laimikis';
  exception when raise_exception then if sqlerrm <> 'catch_invalid' then raise; end if; end;
  begin perform public.club_chat_send(v, '   '); raise exception 'FAIL: tuščia';
  exception when raise_exception then if sqlerrm <> 'body_invalid' then raise; end if; end;
  assert (select body from public.club_messages where id = m1) = 'Rytoj 6:00 prie marių?', 'neapkarpyta';
  assert (select unread from public.my_club_chats() where club_id = v) = 0, 'savo žinutės – neperskaitytos';
end $$;
reset role;
do $$ begin
  -- Antras narys gavo vieną pranešimą (antroji žinutė – per 15 min. – be pranešimo)
  assert (select count(*) from public.notification_outbox where user_id = 'c7400000-0000-4000-8000-0000000000d4' and dedupe like 'cmsg:%') = 1,
    format('pranešimų skaičius %s', (select count(*) from public.notification_outbox where user_id = 'c7400000-0000-4000-8000-0000000000d4' and dedupe like 'cmsg:%'));
  assert not exists (select 1 from public.user_notices where dedupe like 'cmsg:%'), 'klubo žinutė pateko į „Svarbu“';
end $$;
set role authenticated;
set request.jwt.claim.sub = 'c7400000-0000-4000-8000-0000000000d4';
do $$ declare v uuid := (select id from cx where k = 'club'); m bigint; begin
  assert (select unread from public.my_club_chats() where club_id = v) = 2, 'neperskaitytos klubo žinutės';
  assert public.my_unread_count() = 2, 'bendras skaičius su klubu';
  m := (select id from public.club_messages where body like 'Rytoj%');
  assert public.club_chat_react(m, '👍'), 'reakcija';
  assert not public.club_chat_react(m, '👍'), 'reakcijos atšaukimas';
  perform public.club_chat_react(m, '🔥');
  begin perform public.club_chat_react(m, '💩'); raise exception 'FAIL: neleistina reakcija';
  exception when raise_exception then if sqlerrm <> 'emoji_invalid' then raise; end if; end;
  assert (select reactions->>'🔥' from public.club_chat_messages(v) where id = m) = '1', 'reakcijų skaičius';
  perform public.club_chat_read(v);
  assert (select unread from public.my_club_chats() where club_id = v) = 0, 'perskaityta';
  -- Paprastas narys negali trinti svetimos, prisegti, nutildyti
  begin perform public.club_chat_delete(m); raise exception 'FAIL: ištrynė svetimą';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.club_chat_pin(v, m); raise exception 'FAIL: prisegė';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform public.club_chat_mute(v, 'c7300000-0000-4000-8000-0000000000d3', 24); raise exception 'FAIL: nutildė';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  perform public.club_chat_report(m, 'Netinka');
  perform public.club_chat_set_push(v, false);
end $$;
reset role;
do $$ begin
  assert exists (select 1 from public.user_notices where user_id = 'c7100000-0000-4000-8000-0000000000d1' and dedupe like 'crep:%'), 'savininkas negavo pranešimo apie žinutę';
  assert exists (select 1 from public.user_notices where user_id = 'c7200000-0000-4000-8000-0000000000d2' and dedupe like 'crep:%'), 'valdytojas negavo pranešimo apie žinutę';
end $$;

\echo 'N3. Valdytojas: prisegti, ištrinti, nutildyti; pranešimai išjungti; išėjęs narys nemato'
set role authenticated;
set request.jwt.claim.sub = 'c7200000-0000-4000-8000-0000000000d2';
do $$ declare v uuid := (select id from cx where k = 'club'); m bigint; begin
  m := (select id from public.club_messages where body like 'Rytoj%');
  perform public.club_chat_pin(v, m);
  assert (select pin_body from public.my_club_chats() where club_id = v) = 'Rytoj 6:00 prie marių?', 'prisegta';
  begin perform public.club_chat_mute(v, 'c7100000-0000-4000-8000-0000000000d1', 24); raise exception 'FAIL: nutildė savininką';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  perform public.club_chat_mute(v, 'c7300000-0000-4000-8000-0000000000d3', 24);
  perform public.club_chat_send(v, 'Žvejojam!');
  perform public.club_chat_delete(m);
  assert (select deleted and body is null from public.club_chat_messages(v) where id = m), 'ištrinta';
  assert (select pin_body from public.my_club_chats() where club_id = v) is null, 'ištrinta prisegta žinutė liko';
end $$;
set request.jwt.claim.sub = 'c7300000-0000-4000-8000-0000000000d3';
do $$ begin
  begin perform public.club_chat_send((select id from cx where k = 'club'), 'Aš nutildytas?'); raise exception 'FAIL: nutildytas parašė';
  exception when raise_exception then if sqlerrm <> 'muted' then raise; end if; end;
end $$;
reset role;
do $$ begin
  -- d4 išjungė pranešimus – apie „Žvejojam!“ negavo (d3 – gavo, praėjo mažiau nei 15 min.? d3 dar negavo nė vieno)
  assert (select count(*) from public.notification_outbox where user_id = 'c7400000-0000-4000-8000-0000000000d4' and dedupe like 'cmsg:%') = 1, 'išjungus – vis tiek pranešė';
  assert exists (select 1 from public.notification_outbox where user_id = 'c7300000-0000-4000-8000-0000000000d3' and dedupe like 'cmsg:%'), 'narys negavo pranešimo';
  assert exists (select 1 from public.user_notices where user_id = 'c7300000-0000-4000-8000-0000000000d3' and dedupe like 'cmute:%'), 'nutildytas negavo pranešimo';
end $$;
delete from public.club_members where club_id = (select id from cx where k = 'club') and user_id = 'c7400000-0000-4000-8000-0000000000d4';
set role authenticated;
set request.jwt.claim.sub = 'c7400000-0000-4000-8000-0000000000d4';
do $$ begin
  assert not exists (select 1 from public.club_messages), 'išėjęs narys mato žinutes';
  assert not exists (select 1 from public.my_club_chats()), 'išėjęs narys mato pokalbį';
end $$;
-- Jungiklis: išjungus klubų pokalbius rašyti negalima
reset role;
update public.app_features set enabled = false where key = 'club_chat';
set role authenticated;
set request.jwt.claim.sub = 'c7100000-0000-4000-8000-0000000000d1';
do $$ begin
  begin perform public.club_chat_send((select id from cx where k = 'club'), 'Labas'); raise exception 'FAIL: išjungus parašė';
  exception when raise_exception then if sqlerrm <> 'feature_off' then raise; end if; end;
end $$;
reset role;
update public.app_features set enabled = true where key = 'club_chat';
set role anon;
do $$ begin
  begin perform public.club_chat_send((select id from cx where k = 'club'), 'x'); raise exception 'FAIL: anonimas';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.club_messages; raise exception 'FAIL: anonimas skaito';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.sub;
\echo '   ok – pranešimai ir klubų pokalbiai'
