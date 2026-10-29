-- 0028: vieši turnyrai – tik organizatoriams; prašymai tapti organizatoriumi.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'O1. Privatūs – visiems, vieši – tik organizatoriams'

insert into auth.users (id, email) values
  ('0a100000-0000-4000-8000-0000000000a1', 'org-owner@test.lt'),
  ('0a200000-0000-4000-8000-0000000000a2', 'org-user@test.lt'),
  ('0a300000-0000-4000-8000-0000000000a3', 'org-user2@test.lt'),
  ('0a400000-0000-4000-8000-0000000000a4', 'org-mod@test.lt');
update public.profiles set roles = array['owner'] where id = '0a100000-0000-4000-8000-0000000000a1';
update public.profiles set roles = array['moderator'] where id = '0a400000-0000-4000-8000-0000000000a4';
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
values ('0a100000-0000-4000-8000-0000000000a1', 'https://push.test/org-a1', repeat('x', 87), repeat('x', 22));
-- Senas viešas paprasto žvejo turnyras lieka viešas
set session_replication_role = replica;
insert into public.tournaments (id, organizer_id, title, format, starts_at, ends_at, visibility, invite_code)
values ('0a0a0000-0000-4000-8000-00000000000a', '0a200000-0000-4000-8000-0000000000a2', 'Senas viešas', 'biggest', now() + interval '1 day', now() + interval '2 days', 'public', 'org0000001');
set session_replication_role = origin;

set role authenticated;
set request.jwt.claim.sub = '0a200000-0000-4000-8000-0000000000a2';
do $$ declare v uuid; begin
  assert not public.has_perm('publish'), 'žvejys turi publish';
  insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility)
  values (auth.uid(), 'Draugų turnyras', 'biggest', now() + interval '1 day', now() + interval '2 days', 'private') returning id into v;
  begin
    insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility)
    values (auth.uid(), 'Viešas be teisės', 'biggest', now() + interval '1 day', now() + interval '2 days', 'public');
    raise exception 'FAIL: viešas be teisės';
  exception when raise_exception then if sqlerrm <> 'public_not_allowed' then raise; end if; end;
  begin update public.tournaments set visibility = 'public' where id = v; raise exception 'FAIL: privatus -> viešas';
  exception when raise_exception then if sqlerrm <> 'public_not_allowed' then raise; end if; end;
  update public.tournaments set title = 'Senas viešas (pataisytas)' where id = '0a0a0000-0000-4000-8000-00000000000a';
  assert (select title from public.tournaments where id = '0a0a0000-0000-4000-8000-00000000000a') = 'Senas viešas (pataisytas)', 'senas viešas neredaguojamas';
end $$;

\echo 'O2. Prašymas ir patvirtinimas'
select public.request_organizer('Rengiu Kauno marių turnyrus jau 5 metus');
do $$ begin
  begin perform public.request_organizer('dar kartą'); raise exception 'FAIL: du prašymai';
  exception when raise_exception then if sqlerrm <> 'request_pending' then raise; end if; end;
  assert (select count(*) from public.organizer_requests) = 1, 'savo prašymas nematomas';
  begin perform public.decide_organizer(auth.uid(), true); raise exception 'FAIL: pats sau';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin insert into public.organizer_requests (user_id) values (auth.uid()); raise exception 'FAIL: tiesioginis įrašas';
  exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '0a300000-0000-4000-8000-0000000000a3';
select public.request_organizer(null);
do $$ begin
  assert (select count(*) from public.organizer_requests) = 1, 'mato svetimą prašymą';
end $$;
set request.jwt.claim.sub = '0a400000-0000-4000-8000-0000000000a4';
do $$ begin
  begin perform public.decide_organizer('0a200000-0000-4000-8000-0000000000a2', true); raise exception 'FAIL: tikrintojas patvirtino';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;
set request.jwt.claim.sub = '0a100000-0000-4000-8000-0000000000a1';
do $$ begin
  assert (select count(*) from public.organizer_requests where status = 'pending') = 2, 'savininkas nemato prašymų';
  perform public.decide_organizer('0a200000-0000-4000-8000-0000000000a2', true);
  perform public.decide_organizer('0a300000-0000-4000-8000-0000000000a3', false);
  begin perform public.decide_organizer('0a300000-0000-4000-8000-0000000000a3', true); raise exception 'FAIL: antras sprendimas';
  exception when raise_exception then if sqlerrm <> 'request_not_found' then raise; end if; end;
end $$;
reset role;
do $$ begin
  assert (select roles = array['organizer'] and not is_admin from public.profiles where id = '0a200000-0000-4000-8000-0000000000a2'), 'organizatorius tapo komandos nariu';
  assert (select status from public.organizer_requests where user_id = '0a200000-0000-4000-8000-0000000000a2') = 'approved', 'statusas';
  assert exists (select 1 from public.role_changes where user_id = '0a200000-0000-4000-8000-0000000000a2' and role = 'organizer' and granted), 'rolių istorija';
  assert exists (select 1 from public.notification_outbox where user_id = '0a100000-0000-4000-8000-0000000000a1' and dedupe like 'orgreq:%'), 'savininkas negavo pranešimo';
end $$;
set role authenticated;
set request.jwt.claim.sub = '0a200000-0000-4000-8000-0000000000a2';
do $$ begin
  assert public.has_perm('publish') and 'publish' = any (public.my_permissions()), 'organizatorius be publish';
  assert not public.is_admin() and not public.has_perm('review') and not public.has_perm('tournaments'), 'organizatorius gavo komandos teisių';
  insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility)
  values (auth.uid(), 'Viešas organizatoriaus', 'biggest', now() + interval '1 day', now() + interval '2 days', 'public');
  begin perform public.request_organizer('vėl'); raise exception 'FAIL: jau organizatorius';
  exception when raise_exception then if sqlerrm <> 'already_organizer' then raise; end if; end;
end $$;
set request.jwt.claim.sub = '0a300000-0000-4000-8000-0000000000a3';
do $$ begin
  begin perform public.request_organizer('prašau dar'); raise exception 'FAIL: iškart po atmetimo';
  exception when raise_exception then if sqlerrm <> 'request_cooldown' then raise; end if; end;
end $$;
-- Savininkas atima rolę – vėl tik privatūs
set request.jwt.claim.sub = '0a100000-0000-4000-8000-0000000000a1';
select public.set_role('zvejys_0a200000', 'organizer', false);
set request.jwt.claim.sub = '0a200000-0000-4000-8000-0000000000a2';
do $$ begin
  assert not public.has_perm('publish'), 'rolė neatimta';
end $$;
reset role;
set role anon;
reset request.jwt.claim.sub;
do $$ begin
  begin perform public.request_organizer('x'); raise exception 'FAIL: anonimas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
\echo '   ok – organizatoriai ir vieši turnyrai'
