-- RLS „fuzz“ testai: sistemingai bandoma viskas, ko neturi būti galima.
--   1) kiekvienas kito žmogaus eilutės stulpelis × kiekvienas vaidmuo (anon, dalyvis) – UPDATE turi nepaliesti nieko;
--   2) kiekvienas savo eilutės stulpelis, išskyrus leistinus – UPDATE turi būti atmestas;
--   3) DELETE ir INSERT į svetimus duomenis;
--   4) slaptų duomenų (vietos, neperžiūrėti laimikiai, ginčai, privatūs turnyrai) SELECT;
--   5) serverio funkcijos be teisių;
--   6) 300 atsitiktinių bandymų iš viso to rinkinio su atsitiktiniu vaidmeniu.
-- Paleidžiama po kitų testų (tests/db/run.sh). Naudoja tik laikinas funkcijas.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'RLS fuzz: paruošiami duomenys'

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-00000000000a', 'fa@test.lt'),
  ('b0000000-0000-4000-8000-00000000000b', 'fb@test.lt'),
  ('c0000000-0000-4000-8000-00000000000c', 'fm@test.lt');
update public.profiles set is_admin = (id = 'c0000000-0000-4000-8000-00000000000c')
 where id in ('a0000000-0000-4000-8000-00000000000a', 'b0000000-0000-4000-8000-00000000000b', 'c0000000-0000-4000-8000-00000000000c');

create temp table fx (k text primary key, id uuid);
grant select on fx to anon, authenticated;

-- B: viešas būsimas, privatus vykstantis turnyras; laimikiai (laukiantis ir atmestas), vieta, ginčas.
set request.jwt.claim.sub = 'b0000000-0000-4000-8000-00000000000b';
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at)
           values ('b0000000-0000-4000-8000-00000000000b', 'B viešas', 'biggest', now() + interval '1 day', now() + interval '3 days') returning id)
insert into fx select 'b_pub', id from t;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility, leaderboard_hidden)
           values ('b0000000-0000-4000-8000-00000000000b', 'B privatus', 'biggest', now() - interval '1 hour', now() + interval '3 days', 'private', true) returning id)
insert into fx select 'b_priv', id from t;
insert into public.tournament_species values ((select id from fx where k = 'b_pub'), 1);
insert into public.tournament_sponsors (tournament_id, name, url, amount_cents) select id, 'B rėmėjas', 'https://example.com', 10000 from fx where k = 'b_pub';
insert into public.entries (tournament_id, user_id) select id, 'b0000000-0000-4000-8000-00000000000b' from fx where k in ('b_pub', 'b_priv');
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 700, now() - interval '10 minutes', 'b0000000-0000-4000-8000-00000000000b/p1.jpg', repeat('b1', 32)) returning id)
insert into fx select 'b_pending', id from c;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 650, now() - interval '20 minutes', 'b0000000-0000-4000-8000-00000000000b/p2.jpg', repeat('b2', 32)) returning id)
insert into fx select 'b_rejected', id from c;
insert into public.catch_locations (catch_id, lat, lng, accuracy_m) select id, 54.9, 23.9, 10 from fx where k = 'b_pending';
insert into storage.objects (bucket_id, name, owner) values ('catch-photos', 'b0000000-0000-4000-8000-00000000000b/p1.jpg', 'b0000000-0000-4000-8000-00000000000b');
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256, bait, notes)
           values (gen_random_uuid(), 1, 800, now() - interval '30 minutes', 'b0000000-0000-4000-8000-00000000000b/p3.jpg', repeat('b3', 32), 'vobleris', 'slapta vieta prie tilto') returning id)
insert into fx select 'b_approved', id from c;
set request.jwt.claim.sub = 'c0000000-0000-4000-8000-00000000000c';
select public.review_catch((select id from fx where k = 'b_rejected'), false, 'Netikslus ilgis');
select public.review_catch((select id from fx where k = 'b_approved'), true, null);
set request.jwt.claim.sub = 'b0000000-0000-4000-8000-00000000000b';
with d as (insert into public.disputes (catch_id, message) select id, 'Nesutinku' from fx where k = 'b_rejected' returning id)
insert into fx select 'b_dispute', id from d;

-- A: vienas savas laimikis ir dalyvavimas B viešame turnyre.
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-00000000000a';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 2, 300, now() - interval '5 minutes', 'a0000000-0000-4000-8000-00000000000a/p1.jpg', repeat('a1', 32)) returning id)
insert into fx select 'a_catch', id from c;
insert into public.entries (tournament_id, user_id) select id, 'a0000000-0000-4000-8000-00000000000a' from fx where k = 'b_pub';
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at)
           values ('a0000000-0000-4000-8000-00000000000a', 'A turnyras', 'biggest', now() + interval '1 day', now() + interval '2 days') returning id)
insert into fx select 'a_pub', id from t;
reset request.jwt.claim.sub;

-- ---------------------------------------------------------------
-- Pagalbinės funkcijos
-- ---------------------------------------------------------------
create table pg_temp.attempts (n serial, who text, sql text, kind text);
create table pg_temp.failures (who text, sql text, why text);
grant all on pg_temp.failures to anon, authenticated;

-- Vykdo sakinį kaip nurodytas vartotojas. kind: 'nochange' – klaida arba 0 eilučių; 'error' – privalo būti klaida;
-- 'zero' – SELECT count(*) turi grąžinti 0.
create function pg_temp.try(p_who text, p_sql text, p_kind text) returns text
language plpgsql as $$
declare n bigint; uid text;
begin
  uid := case p_who when 'A' then 'a0000000-0000-4000-8000-00000000000a' when 'B' then 'b0000000-0000-4000-8000-00000000000b' else '' end;
  perform set_config('request.jwt.claim.sub', uid, true);
  execute format('set local role %I', case when p_who = 'anon' then 'anon' else 'authenticated' end);
  begin
    if p_kind = 'zero' then
      execute p_sql into n;
      if n <> 0 then return format('grąžino %s eil.', n); end if;
      return null;
    end if;
    execute p_sql;
    get diagnostics n = row_count;
    if p_kind = 'error' then return format('nebuvo klaidos (%s eil.)', n); end if;
    if n <> 0 then return format('pakeista %s eil.', n); end if;
    return null;
  exception when others then
    return null; -- atmesta – gerai
  end;
end $$;

create function pg_temp.check_all(p_label text) returns void
language plpgsql as $$
declare r record; why text; total int := 0; bad int := 0;
begin
  for r in select * from pg_temp.attempts order by n loop
    total := total + 1;
    -- kiekvienas bandymas – atskirame „savepoint“, kad sėkmingas pakeitimas būtų atšauktas
    why := null;
    begin
      why := pg_temp.try(r.who, r.sql, r.kind);
      raise exception 'rollback_attempt';
    exception when raise_exception then
      if sqlerrm <> 'rollback_attempt' then raise; end if;
    end;
    reset role;
    if why is not null then
      bad := bad + 1;
      insert into pg_temp.failures values (r.who, r.sql, why);
    end if;
  end loop;
  reset role;
  raise notice '%: bandymų %, pažeidimų %', p_label, total, bad;
end $$;

-- ---------------------------------------------------------------
-- 1) Svetimų eilučių kiekvieno stulpelio keitimas
-- ---------------------------------------------------------------
\echo 'R1. Svetimų eilučių stulpeliai (anon ir A prieš B duomenis)'
insert into pg_temp.attempts (who, sql, kind)
select who, format('update %I.%I set %I = %I where %s', s, t, c.column_name, c.column_name, w), 'nochange'
  from (values ('public', 'profiles',        $$id = 'b0000000-0000-4000-8000-00000000000b'$$),
               ('public', 'tournaments',     $$organizer_id = 'b0000000-0000-4000-8000-00000000000b'$$),
               ('public', 'tournament_species', $$tournament_id in (select id from fx where k like 'b_%')$$),
               ('public', 'entries',         $$user_id = 'b0000000-0000-4000-8000-00000000000b'$$),
               ('public', 'tournament_sponsors', $$tournament_id in (select id from fx where k like 'b_%')$$),
               ('public', 'catches',         $$user_id = 'b0000000-0000-4000-8000-00000000000b'$$),
               ('public', 'catch_locations', $$catch_id in (select id from fx where k like 'b_%')$$),
               ('public', 'disputes',        $$user_id = 'b0000000-0000-4000-8000-00000000000b'$$),
               ('storage', 'objects',        $$name like 'b0000000-%'$$)) as x(s, t, w)
  join information_schema.columns c on c.table_schema = x.s and c.table_name = x.t
 cross join (values ('anon'), ('A')) as who(who);

-- ---------------------------------------------------------------
-- 2) Savos eilutės neleistini stulpeliai
-- ---------------------------------------------------------------
\echo 'R2. Savų eilučių neleistini stulpeliai (B)'
insert into pg_temp.attempts (who, sql, kind)
select 'B', format('update public.%I set %I = %I where %s', t, c.column_name, c.column_name, w), 'nochange'
  from (values ('profiles', $$id = 'b0000000-0000-4000-8000-00000000000b'$$, array['nickname', 'region']),
               ('catches', $$user_id = 'b0000000-0000-4000-8000-00000000000b'$$, array['bait', 'notes']),
               ('entries', $$user_id = 'b0000000-0000-4000-8000-00000000000b'$$, array[]::text[]),
               ('catch_locations', $$catch_id in (select id from fx where k like 'b_%')$$, array[]::text[]),
               ('disputes', $$user_id = 'b0000000-0000-4000-8000-00000000000b'$$, array[]::text[])) as x(t, w, allowed)
  join information_schema.columns c on c.table_schema = 'public' and c.table_name = x.t
 where not c.column_name = any (x.allowed);
-- Konkrečios vertės, kurios suteiktų pranašumą
insert into pg_temp.attempts (who, sql, kind) values
  ('B', $$update public.profiles set is_admin = true where id = 'b0000000-0000-4000-8000-00000000000b'$$, 'nochange'),
  ('B', $$update public.profiles set trust_score = 100 where id = 'b0000000-0000-4000-8000-00000000000b'$$, 'nochange'),
  ('B', $$update public.catches set status = 'approved' where user_id = 'b0000000-0000-4000-8000-00000000000b'$$, 'nochange'),
  ('B', $$update public.catches set length_mm = 2000 where user_id = 'b0000000-0000-4000-8000-00000000000b'$$, 'nochange'),
  ('B', $$update public.catches set captured_at_device = now() where user_id = 'b0000000-0000-4000-8000-00000000000b'$$, 'nochange'),
  ('B', $$update public.disputes set status = 'accepted' where user_id = 'b0000000-0000-4000-8000-00000000000b'$$, 'nochange'),
  ('B', $$update public.tournaments set fee_cents = 500 where organizer_id = 'b0000000-0000-4000-8000-00000000000b'$$, 'error'),
  ('B', $$update public.tournaments set title = 'pakeista po starto' where id = (select id from fx where k = 'b_priv')$$, 'nochange'),
  ('B', $$delete from public.tournament_species where tournament_id = (select id from fx where k = 'b_priv')$$, 'nochange');

-- ---------------------------------------------------------------
-- 3) Trynimas ir įterpimas į svetimus duomenis
-- ---------------------------------------------------------------
\echo 'R3. DELETE ir INSERT'
insert into pg_temp.attempts (who, sql, kind)
select who, format('delete from %I.%I where %s', s, t, w), 'nochange'
  from (values ('public', 'profiles', $$id = 'b0000000-0000-4000-8000-00000000000b'$$),
               ('public', 'tournaments', $$organizer_id = 'b0000000-0000-4000-8000-00000000000b'$$),
               ('public', 'tournament_species', $$true$$),
               ('public', 'tournament_sponsors', $$true$$),
               ('public', 'entries', $$user_id = 'b0000000-0000-4000-8000-00000000000b'$$),
               ('public', 'catches', $$true$$),
               ('public', 'catch_locations', $$true$$),
               ('public', 'disputes', $$true$$),
               ('public', 'species', $$true$$),
               ('storage', 'objects', $$true$$)) as x(s, t, w)
 cross join (values ('anon'), ('A'), ('B')) as who(who)
 where not (who = 'B' and t in ('tournaments', 'tournament_species', 'tournament_sponsors', 'entries')); -- B savo būsimą turnyrą trinti gali
insert into pg_temp.attempts (who, sql, kind) values
  ('A', $$insert into public.entries (tournament_id, user_id) values ((select id from fx where k = 'b_priv'), 'a0000000-0000-4000-8000-00000000000a')$$, 'error'),
  ('A', $$insert into public.entries (tournament_id, user_id) values ((select id from fx where k = 'a_pub'), 'b0000000-0000-4000-8000-00000000000b')$$, 'error'),
  ('A', $$insert into public.tournament_species values ((select id from fx where k = 'b_pub'), 2)$$, 'error'),
  ('A', $$insert into public.tournament_sponsors (tournament_id, name) values ((select id from fx where k = 'b_pub'), 'Įsibrovėlis')$$, 'error'),
  ('anon', $$insert into public.tournament_sponsors (tournament_id, name) values ((select id from fx where k = 'b_pub'), 'Anon')$$, 'error'),
  ('A', $$insert into public.tournaments (organizer_id, title, format, starts_at, ends_at) values ('b0000000-0000-4000-8000-00000000000b', 'Apsimetėlis', 'biggest', now() + interval '1 day', now() + interval '2 days')$$, 'error'),
  ('A', $$insert into public.catch_locations (catch_id, lat, lng, accuracy_m) values ((select id from fx where k = 'b_rejected'), 1, 1, 1)$$, 'error'),
  ('A', $$insert into public.disputes (catch_id, message) values ((select id from fx where k = 'b_rejected'), 'svetimas')$$, 'error'),
  ('A', $$insert into public.disputes (catch_id, message) values ((select id from fx where k = 'a_catch'), 'nepatvirtintas dar')$$, 'error'),
  ('A', $$insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256) values (gen_random_uuid(), 1, 500, now(), 'b0000000-0000-4000-8000-00000000000b/x.jpg', repeat('ff', 32))$$, 'error'),
  ('A', $$insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256) values (gen_random_uuid(), 1, 500, now(), 'a0000000-0000-4000-8000-00000000000a/../b0000000-0000-4000-8000-00000000000b/x.jpg', repeat('fe', 32))$$, 'error'),
  ('A', $$insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256) values (gen_random_uuid(), 1, 500, now(), 'a0000000-0000-4000-8000-00000000000a/dup.jpg', repeat('b1', 32))$$, 'error'),
  ('A', $$insert into public.species (id, code, name_lt) values (99, 'x', 'X')$$, 'error'),
  ('A', $$insert into public.profiles (id, nickname) values (gen_random_uuid(), 'netikras')$$, 'error'),
  ('A', $$insert into storage.objects (bucket_id, name) values ('catch-photos', 'b0000000-0000-4000-8000-00000000000b/hack.jpg')$$, 'error'),
  ('anon', $$insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256) values (gen_random_uuid(), 1, 500, now(), 'x/x.jpg', repeat('fd', 32))$$, 'error'),
  ('anon', $$insert into public.tournaments (title, format, starts_at, ends_at) values ('anon', 'biggest', now() + interval '1 day', now() + interval '2 days')$$, 'error'),
  ('anon', $$insert into public.entries (tournament_id) values ((select id from fx where k = 'b_pub'))$$, 'error'),
  ('anon', $$insert into storage.objects (bucket_id, name) values ('catch-photos', 'anon/x.jpg')$$, 'error');

-- ---------------------------------------------------------------
-- 4) Slapti duomenys
-- ---------------------------------------------------------------
\echo 'R4. Slaptų duomenų skaitymas'
insert into pg_temp.attempts (who, sql, kind)
select who, q, 'zero' from (values
  ($$select count(*) from public.catch_locations$$),
  ($$select count(*) from public.catches where status <> 'approved' and user_id is distinct from auth.uid()$$),
  ($$select count(*) from public.disputes$$),
  ($$select count(*) from public.tournaments where visibility = 'private'$$),
  ($$select count(*) from public.leaderboard((select id from fx where k = 'b_priv'))$$),
  ($$select count(*) from storage.objects where name like 'b0000000-%'$$),
  ($$select count(*) from public.get_invite('')$$),
  ($$select count(*) from public.get_invite('%')$$)
) as q(q) cross join (values ('anon'), ('A')) as who(who);
-- privatūs stulpeliai: kito žmogaus masalas ir pastabos (net patvirtinto laimikio)
insert into pg_temp.attempts (who, sql, kind)
select who, q, 'error' from (values
  ($$select count(bait) from public.catches$$),
  ($$select count(notes) from public.catches$$),
  ($$select count(*) from public.catches c where c::text like '%vobleris%'$$)
) as q(q) cross join (values ('anon'), ('A')) as who(who);
insert into pg_temp.attempts (who, sql, kind) values
  ('A', $$select count(*) from public.my_catch_notes() where id in (select id from fx where k like 'b_%')$$, 'zero');

-- ---------------------------------------------------------------
-- 5) Funkcijos be teisių
-- ---------------------------------------------------------------
\echo 'R5. Serverio funkcijos be teisių'
insert into pg_temp.attempts (who, sql, kind)
select who, q, 'error' from (values
  ($$select public.review_catch((select id from fx where k = 'b_pending'), true, null)$$),
  ($$select public.resolve_dispute((select id from fx where k = 'b_dispute'), true, null)$$),
  ($$select public.set_moderator('fa', true)$$),
  ($$select public.purge_old_locations()$$),
  ($$select public.handle_new_user()$$),
  ($$select public.finish_account_deletion()$$)
) as q(q) cross join (values ('anon'), ('A')) as who(who);
insert into pg_temp.attempts (who, sql, kind) values
  ('anon', $$select public.join_with_invite((select invite_code from public.tournaments limit 1))$$, 'error'),
  ('anon', $$select public.begin_account_deletion()$$, 'error');

select pg_temp.check_all('Sisteminiai bandymai');

-- ---------------------------------------------------------------
-- 6) Atsitiktinis rinkinys: 300 bandymų su atsitiktiniu vaidmeniu (kai bandymas tinka visiems)
-- ---------------------------------------------------------------
\echo 'R6. 300 atsitiktinių bandymų'
-- tik tie bandymai, kurie draudžiami ir anon, ir A (kitaip atsitiktinis vaidmuo galėtų būti teisėtas)
create table pg_temp.pool as select sql, kind from pg_temp.attempts
 group by sql, kind having bool_or(who = 'anon') and bool_or(who = 'A');
truncate pg_temp.attempts;
select setseed(0.4242);
insert into pg_temp.attempts (who, sql, kind)
select (array['anon', 'A'])[1 + floor(random() * 2)::int], p.sql, p.kind
  from generate_series(1, 300) g
  cross join lateral (select * from pg_temp.pool order by random() + g * 0 limit 1) p;
select pg_temp.check_all('Atsitiktiniai bandymai');

-- „Kanarėlė“: teisėtas veiksmas, pažymėtas kaip draudžiamas, PRIVALO būti pagautas – kitaip testas aklas.
do $$ begin
  if pg_temp.try('A', $q$update public.profiles set region = 'kanarėlė' where id = 'a0000000-0000-4000-8000-00000000000a'$q$, 'nochange') is null then
    raise exception 'FAIL: fuzz testas nepastebėjo leistino pakeitimo – tikrinimas neveikia';
  end if;
  reset role;
end $$;
do $$
declare n int; r record;
begin
  select count(*) into n from pg_temp.failures;
  for r in select * from pg_temp.failures limit 20 loop
    raise notice 'PAŽEIDIMAS [%] %: %', r.who, r.why, r.sql;
  end loop;
  if n > 0 then raise exception 'FAIL: RLS fuzz rado % pažeidimų', n; end if;
  -- Sveikumo patikra: teisėti veiksmai tebeveikia (kad testai netikrintų „viskas užrakinta“).
  perform set_config('request.jwt.claim.sub', 'b0000000-0000-4000-8000-00000000000b', true);
  set local role authenticated;
  update public.profiles set region = 'Kauno r.' where id = 'b0000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: savo regiono pakeisti nepavyko'; end if;
  update public.catches set bait = 'vobleris' where id = (select id from fx where k = 'b_pending');
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: savo masalo pakeisti nepavyko'; end if;
  select count(*) into n from public.catch_locations;
  if n <> 1 then raise exception 'FAIL: savininkas nemato savo vietos'; end if;
  reset role;
end $$;
\echo '   ok – pažeidimų nėra, teisėti veiksmai veikia'
