-- 0009: prizinis fondas, padalijimas vietoms, keli rėmėjai.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'P1. Prizinis fondas ir padalijimas'

insert into auth.users (id, email) values
  ('77777777-7777-4777-8777-777777777777', 'org@test.lt'),
  ('88888888-8888-4888-8888-888888888888', 'kitas@test.lt');
create temp table px (k text primary key, id uuid);
grant select, insert on px to authenticated, anon;

set role authenticated;
set request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';
with t as (
  insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, prize_fund_cents, prize_split)
  values ('77777777-7777-4777-8777-777777777777', 'Fondo taurė', 'biggest', now() + interval '1 day', now() + interval '2 days', 50000, '[50,30,20]')
  returning id)
insert into px select 'pub', id from t;
with t as (
  insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility, prize_fund_cents, prize_split)
  values ('77777777-7777-4777-8777-777777777777', 'Slaptas fondas', 'biggest', now() + interval '1 day', now() + interval '2 days', 'private', 10000, '[100]')
  returning id)
insert into px select 'priv', id from t;

do $$
declare bad jsonb[] := array['[50,30]', '[0,100]', '[50.5,49.5]', '[]', '{"a":100}', '["50","50"]', '[101,-1]',
                             '[10,10,10,10,10,10,10,10,10,5,5]']::jsonb[];
        s jsonb;
begin
  foreach s in array bad loop
    begin
      update public.tournaments set prize_split = s where id = (select id from px where k = 'pub');
      raise exception 'FAIL: priimtas blogas padalijimas %', s;
    exception when check_violation then null; end;
  end loop;
  begin
    update public.tournaments set prize_split = null where id = (select id from px where k = 'pub');
    raise exception 'FAIL: fondas be padalijimo';
  exception when check_violation then null; end;
  begin
    update public.tournaments set prize_fund_cents = 20000000 where id = (select id from px where k = 'pub');
    raise exception 'FAIL: per didelis fondas';
  exception when check_violation then null; end;
  -- leistina: kitas teisingas padalijimas, fondo panaikinimas be padalijimo
  update public.tournaments set prize_split = '[40,25,15,12,8]' where id = (select id from px where k = 'pub');
  assert (select prize_split from public.tournaments where id = (select id from px where k = 'pub')) = '[40,25,15,12,8]'::jsonb;
  update public.tournaments set prize_fund_cents = 0, prize_split = null where id = (select id from px where k = 'priv');
  update public.tournaments set prize_fund_cents = 10000, prize_split = '[100]' where id = (select id from px where k = 'priv');
end $$;
reset role;
\echo '   ok'

\echo 'P2. Rėmėjai: tik organizatorius, iki starto, ne daugiau 10, tik https'
set role authenticated;
set request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';
insert into public.tournament_sponsors (tournament_id, name, url, amount_cents, sort)
select id, '  Ežero parduotuvė  ', 'https://example.com', 30000, 0 from px where k = 'pub';
insert into public.tournament_sponsors (tournament_id, name, sort) select id, 'Žvejų klubas', 1 from px where k = 'pub';
insert into public.tournament_sponsors (tournament_id, name) select id, 'Slaptas rėmėjas' from px where k = 'priv';
do $$ begin
  assert (select name from public.tournament_sponsors where sort = 0 and tournament_id = (select id from px where k = 'pub')) = 'Ežero parduotuvė', 'pavadinimas neapkarpytas';
  begin
    insert into public.tournament_sponsors (tournament_id, name, url) select id, 'Blogas', 'javascript:alert(1)' from px where k = 'pub';
    raise exception 'FAIL: priimta javascript: nuoroda';
  exception when check_violation then null; end;
  begin
    insert into public.tournament_sponsors (tournament_id, name) select id, '   ' from px where k = 'pub';
    raise exception 'FAIL: priimtas tuščias pavadinimas';
  exception when check_violation then null; end;
  for i in 3..10 loop
    insert into public.tournament_sponsors (tournament_id, name, sort) select id, 'R' || i, i from px where k = 'pub';
  end loop;
  begin
    insert into public.tournament_sponsors (tournament_id, name) select id, 'Vienuoliktas' from px where k = 'pub';
    raise exception 'FAIL: priimtas 11-as rėmėjas';
  exception when raise_exception then
    if sqlerrm <> 'sponsor_limit' then raise; end if;
  end;
  delete from public.tournament_sponsors where name like 'R%' and tournament_id = (select id from px where k = 'pub');
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';
do $$ declare n int; begin
  begin
    insert into public.tournament_sponsors (tournament_id, name) select id, 'Įsibrovėlis' from px where k = 'pub';
    raise exception 'FAIL: svetimas įrašė rėmėją';
  exception when insufficient_privilege then null; end;
  update public.tournament_sponsors set name = 'Pakeista', amount_cents = 1 where true;
  get diagnostics n = row_count;
  assert n = 0, 'svetimas pakeitė rėmėją';
  delete from public.tournament_sponsors where true;
  get diagnostics n = row_count;
  assert n = 0, 'svetimas ištrynė rėmėją';
  assert (select count(*) from public.tournament_sponsors) = 2, 'viešo turnyro rėmėjai turi matytis';
  assert not exists (select 1 from public.tournament_sponsors where name = 'Slaptas rėmėjas'), 'matomas privataus turnyro rėmėjas';
  begin
    update public.tournaments set prize_fund_cents = 999999 where id = (select id from px where k = 'pub');
    get diagnostics n = row_count;
    assert n = 0, 'svetimas pakeitė fondą';
  end;
end $$;
reset role;

set role anon;
reset request.jwt.claim.sub;
do $$ begin
  assert (select count(*) from public.tournament_sponsors) = 2, 'neprisijungęs turi matyti viešo turnyro rėmėjus';
end $$;
reset role;

-- Prasidėjus turnyrui rėmėjų keisti nebegalima (sukurtas seniau nei prieš 10 min.).
set session_replication_role = replica;  -- sukūrimo laiką saugo trigeris; testui jį apeinam
update public.tournaments set starts_at = now() - interval '1 hour', created_at = now() - interval '1 day'
 where id = (select id from px where k = 'pub');
set session_replication_role = origin;
set role authenticated;
set request.jwt.claim.sub = '77777777-7777-4777-8777-777777777777';
do $$ declare n int; begin
  update public.tournament_sponsors set amount_cents = 1 where tournament_id = (select id from px where k = 'pub');
  get diagnostics n = row_count;
  assert n = 0, 'po starto pakeisti rėmėjai';
  begin
    insert into public.tournament_sponsors (tournament_id, name) select id, 'Vėlyvas' from px where k = 'pub';
    raise exception 'FAIL: po starto pridėtas rėmėjas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Ištrynus turnyrą, rėmėjai ištrinami kartu.
delete from public.tournaments where id = (select id from px where k = 'priv');
do $$ begin
  assert not exists (select 1 from public.tournament_sponsors where name = 'Slaptas rėmėjas'), 'liko ištrinto turnyro rėmėjas';
end $$;
\echo 'VISI PRIZINIO FONDO TESTAI PRAĖJO'
