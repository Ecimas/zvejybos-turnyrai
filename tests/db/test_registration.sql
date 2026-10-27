-- 0011: vėlyvos registracijos riba (late_join_minutes).
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'R1. Registracijos riba po starto'

insert into auth.users (id, email) values
  ('b1000000-0000-4000-8000-0000000000b1', 'org-reg@test.lt'),
  ('b2000000-0000-4000-8000-0000000000b2', 'zvejys-reg@test.lt');

create temp table rx (k text primary key, id uuid);
grant select on rx to authenticated, anon;

-- Turnyrai, prasidėję prieš 2 val. (trigeriai apeinami, nes kurti praeityje neleidžiama).
set session_replication_role = replica;
with t as (
  insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, late_join_minutes, visibility, invite_code)
  values
    ('b1000000-0000-4000-8000-0000000000b1', 'Iki pabaigos', 'biggest', now() - interval '2 hours', now() + interval '1 day', null,  'public',  'reg0000001'),
    ('b1000000-0000-4000-8000-0000000000b1', 'Tik iki starto', 'biggest', now() - interval '2 hours', now() + interval '1 day', 0,   'public',  'reg0000002'),
    ('b1000000-0000-4000-8000-0000000000b1', 'Valanda po', 'biggest', now() - interval '2 hours', now() + interval '1 day', 60,     'public',  'reg0000003'),
    ('b1000000-0000-4000-8000-0000000000b1', 'Trys val. po', 'biggest', now() - interval '2 hours', now() + interval '1 day', 180,  'public',  'reg0000004'),
    ('b1000000-0000-4000-8000-0000000000b1', 'Privatus uždarytas', 'biggest', now() - interval '2 hours', now() + interval '1 day', 60, 'private', 'reg0000005'),
    ('b1000000-0000-4000-8000-0000000000b1', 'Privatus atviras', 'biggest', now() - interval '2 hours', now() + interval '1 day', 600, 'private', 'reg0000006')
  returning id, invite_code)
insert into rx select invite_code, id from t;
-- Organizatorius jau dalyvauja „Tik iki starto“ turnyre? Ne – patikrinsim, kad gali prisijungti ir po starto.
set session_replication_role = origin;

do $$ begin
  begin
    update public.tournaments set late_join_minutes = -1 where id = (select id from rx where k = 'reg0000001');
    raise exception 'FAIL: neigiama riba';
  exception when check_violation then null; end;
  begin
    update public.tournaments set late_join_minutes = 172801 where id = (select id from rx where k = 'reg0000001');
    raise exception 'FAIL: per didelė riba';
  exception when check_violation then null; end;
end $$;

set role authenticated;
set request.jwt.claim.sub = 'b2000000-0000-4000-8000-0000000000b2';
do $$ begin
  insert into public.entries (tournament_id) select id from rx where k = 'reg0000001';  -- iki pabaigos: galima
  insert into public.entries (tournament_id) select id from rx where k = 'reg0000004';  -- 3 val. po: dar galima
  begin
    insert into public.entries (tournament_id) select id from rx where k = 'reg0000002';
    raise exception 'FAIL: užsiregistravo po starto, nors leidžiama tik iki starto';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.entries (tournament_id) select id from rx where k = 'reg0000003';
    raise exception 'FAIL: užsiregistravo praėjus registracijos laikui';
  exception when insufficient_privilege then null; end;

  -- Kvietimai
  assert (select count(*) from public.get_invite('reg0000005')) = 0, 'uždaryto kvietimo peržiūra rodoma';
  assert (select count(*) from public.get_invite('reg0000006')) = 1, 'atviro kvietimo peržiūra nerodoma';
  begin
    perform public.join_with_invite('reg0000005');
    raise exception 'FAIL: prisijungė per kvietimą po registracijos pabaigos';
  exception when raise_exception then
    if sqlerrm <> 'registration_closed' then raise; end if;
  end;
  assert public.join_with_invite('REG0000006') = (select id from rx where k = 'reg0000006'), 'atviras kvietimas neveikia';
  -- Pakartotinai per tą patį kvietimą – grąžina turnyrą, ne klaidą.
  assert public.join_with_invite('reg0000006') = (select id from rx where k = 'reg0000006'), 'kartotinis kvietimas';
end $$;
reset role;

-- Jau dalyvaujantis per kvietimą grąžinamas į turnyrą net registracijai pasibaigus.
insert into public.entries (tournament_id, user_id)
  select id, 'b2000000-0000-4000-8000-0000000000b2' from rx where k = 'reg0000005';
set role authenticated;
set request.jwt.claim.sub = 'b2000000-0000-4000-8000-0000000000b2';
do $$ begin
  assert public.join_with_invite('reg0000005') = (select id from rx where k = 'reg0000005'), 'dalyviui kvietimas meta klaidą';
end $$;
reset role;

-- Organizatorius į savo turnyrą gali įsiregistruoti visada iki pabaigos.
set role authenticated;
set request.jwt.claim.sub = 'b1000000-0000-4000-8000-0000000000b1';
do $$ begin
  insert into public.entries (tournament_id) select id from rx where k = 'reg0000002';
end $$;
reset role;

-- Pasibaigusiame turnyre registracija uždaryta net su „iki pabaigos“.
set session_replication_role = replica;
update public.tournaments set starts_at = now() - interval '3 days', ends_at = now() - interval '1 hour'
 where id = (select id from rx where k = 'reg0000001');
set session_replication_role = origin;
delete from public.entries where tournament_id = (select id from rx where k = 'reg0000001');
set role authenticated;
set request.jwt.claim.sub = 'b2000000-0000-4000-8000-0000000000b2';
do $$ begin
  begin
    insert into public.entries (tournament_id) select id from rx where k = 'reg0000001';
    raise exception 'FAIL: užsiregistravo į pasibaigusį turnyrą';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Prieš startą registracija atvira net su riba 0.
do $$ begin
  assert public.registration_open(now() + interval '1 hour', now() + interval '1 day', 0), 'prieš startą uždaryta';
  assert not public.registration_open(now() - interval '1 minute', now() + interval '1 day', 0), 'po starto atvira';
  assert public.registration_open(now() - interval '59 minutes', now() + interval '1 day', 60), 'per 1 val. uždaryta';
  assert not public.registration_open(now() - interval '2 hours', now() - interval '1 minute', null), 'pasibaigęs atviras';
end $$;

\echo '   ok'
