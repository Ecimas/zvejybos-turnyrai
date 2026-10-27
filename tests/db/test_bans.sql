-- 0013: vartotojų blokavimas.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'B1. Blokuoti gali tik moderatorius ir ne bet ką'

insert into auth.users (id, email) values
  ('d1000000-0000-4000-8000-0000000000d1', 'ban-mod@test.lt'),
  ('d2000000-0000-4000-8000-0000000000d2', 'ban-zvejys@test.lt'),
  ('d3000000-0000-4000-8000-0000000000d3', 'ban-kitas@test.lt'),
  ('d4000000-0000-4000-8000-0000000000d4', 'ban-mod2@test.lt');
update public.profiles set is_admin = true
 where id in ('d1000000-0000-4000-8000-0000000000d1', 'd4000000-0000-4000-8000-0000000000d4');
update public.profiles set nickname = 'Keiksmazodis' where id = 'd2000000-0000-4000-8000-0000000000d2';

create temp table bx (k text primary key, id uuid);
grant select on bx to authenticated, anon;

-- Vykstantis turnyras: Z ir K užsiregistravę iki starto, abu turi patvirtintų laimikių.
set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code)
           values ('d1000000-0000-4000-8000-0000000000d1', 'Blokavimo testas', 'biggest', now() - interval '1 day', now() + interval '1 day', 'ban0000001')
           returning id)
insert into bx select 'tour', id from t;
insert into public.entries (tournament_id, user_id, joined_at)
  select id, u, now() - interval '2 days' from bx,
         unnest(array['d2000000-0000-4000-8000-0000000000d2', 'd3000000-0000-4000-8000-0000000000d3']::uuid[]) u
   where k = 'tour';
-- Būsimas turnyras registracijai patikrinti
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code)
           values ('d1000000-0000-4000-8000-0000000000d1', 'Būsimas', 'biggest', now() + interval '1 day', now() + interval '2 days', 'ban0000002')
           returning id)
insert into bx select 'future', id from t;
set session_replication_role = origin;

set request.jwt.claim.sub = 'd2000000-0000-4000-8000-0000000000d2';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 950, now() - interval '3 hours', 'd2000000-0000-4000-8000-0000000000d2/z1.jpg', repeat('e1', 32)) returning id)
insert into bx select 'z_catch', id from c;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 500, now() - interval '3 hours', 'd2000000-0000-4000-8000-0000000000d2/z2.jpg', repeat('e3', 32)) returning id)
insert into bx select 'z_rejected', id from c;
set request.jwt.claim.sub = 'd3000000-0000-4000-8000-0000000000d3';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 600, now() - interval '2 hours', 'd3000000-0000-4000-8000-0000000000d3/k1.jpg', repeat('e2', 32)) returning id)
insert into bx select 'k_catch', id from c;
set request.jwt.claim.sub = 'd1000000-0000-4000-8000-0000000000d1';
select public.review_catch(id, true, null) from bx where k in ('z_catch', 'k_catch');
select public.review_catch(id, false, 'Nesimato matavimo') from bx where k = 'z_rejected';
reset request.jwt.claim.sub;

set role authenticated;
-- Paprastas žvejys blokuoti negali
set request.jwt.claim.sub = 'd3000000-0000-4000-8000-0000000000d3';
do $$ begin
  begin
    perform public.ban_user('d2000000-0000-4000-8000-0000000000d2', 7, 'Bandau blokuoti');
    raise exception 'FAIL: ne moderatorius užblokavo';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin
    perform public.reset_nickname('d2000000-0000-4000-8000-0000000000d2');
    raise exception 'FAIL: ne moderatorius pakeitė slapyvardį';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
end $$;

set request.jwt.claim.sub = 'd1000000-0000-4000-8000-0000000000d1';
do $$
declare e text;
begin
  foreach e in array array['self', 'admin', 'reason', 'days0', 'days_big', 'nouser'] loop
    begin
      case e
        when 'self'     then perform public.ban_user('d1000000-0000-4000-8000-0000000000d1', 1, 'Pats save');
        when 'admin'    then perform public.ban_user('d4000000-0000-4000-8000-0000000000d4', 1, 'Kitas moderatorius');
        when 'reason'   then perform public.ban_user('d2000000-0000-4000-8000-0000000000d2', 1, '  x ');
        when 'days0'    then perform public.ban_user('d2000000-0000-4000-8000-0000000000d2', 0, 'Nulis dienų');
        when 'days_big' then perform public.ban_user('d2000000-0000-4000-8000-0000000000d2', 5000, 'Per ilgai');
        when 'nouser'   then perform public.ban_user(gen_random_uuid(), 1, 'Nėra tokio');
      end case;
      raise exception 'FAIL: leista – %', e;
    exception when raise_exception then
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
  end loop;
  assert not exists (select 1 from public.user_bans), 'neteisingas blokavimas išsaugotas';
end $$;
reset role;

\echo '   ok'
\echo 'B2. Užblokuotas negali dalyvauti, bet gali žiūrėti'

-- Prieš blokavimą Z lentelėje pirmas
set role anon;
do $$ begin
  assert (select user_id from public.leaderboard((select id from bx where k = 'tour')) where rank = 1)
         = 'd2000000-0000-4000-8000-0000000000d2', 'prieš blokavimą Z turi būti pirmas';
end $$;
reset role;

set role authenticated;
set request.jwt.claim.sub = 'd1000000-0000-4000-8000-0000000000d1';
select public.ban_user('d2000000-0000-4000-8000-0000000000d2', 7, '  Sukčiavimas: sena nuotrauka  ');
do $$ begin
  assert (select reason from public.user_bans where user_id = 'd2000000-0000-4000-8000-0000000000d2') = 'Sukčiavimas: sena nuotrauka', 'priežastis neapkarpyta';
  assert (select until from public.user_bans where user_id = 'd2000000-0000-4000-8000-0000000000d2') between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour', 'trukmė bloga';
  assert (select banned_by from public.user_bans) = 'd1000000-0000-4000-8000-0000000000d1', 'kas užblokavo';
end $$;

set request.jwt.claim.sub = 'd2000000-0000-4000-8000-0000000000d2';
do $$
declare e text;
begin
  assert public.is_banned(), 'Z neužblokuotas';
  assert (select count(*) from public.user_bans) = 1, 'Z nemato savo blokavimo';
  assert (select count(*) from public.tournaments where id = (select id from bx where k = 'tour')) = 1, 'Z nebemato turnyrų';
  assert (select count(*) from public.catches where user_id = auth.uid()) = 2, 'Z nebemato savo laimikių';
  foreach e in array array['catch', 'entry', 'tournament', 'report', 'dispute', 'nickname'] loop
    begin
      case e
        when 'catch' then
          insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
          values (gen_random_uuid(), 1, 700, now(), 'd2000000-0000-4000-8000-0000000000d2/z3.jpg', repeat('e4', 32));
        when 'entry' then
          insert into public.entries (tournament_id) select id from bx where k = 'future';
        when 'tournament' then
          insert into public.tournaments (title, format, starts_at, ends_at) values ('Užblokuoto', 'biggest', now() + interval '1 day', now() + interval '2 days');
        when 'report' then
          insert into public.catch_reports (catch_id, reason) select id, 'other' from bx where k = 'k_catch';
        when 'dispute' then
          insert into public.disputes (catch_id, message) select id, 'Nesutinku su atmetimu' from bx where k = 'z_rejected';
        when 'nickname' then
          update public.profiles set nickname = 'Kitas_Vardas' where id = auth.uid();
          if found then raise exception 'FAIL: pakeistas slapyvardis'; end if;
          raise exception 'blocked';
      end case;
      raise exception 'FAIL: užblokuotas galėjo – %', e;
    exception
      when insufficient_privilege then null;
      when raise_exception then if sqlerrm like 'FAIL%' then raise; end if;
    end;
  end loop;
  -- Išvykos be laimikio – privačios, jų nedraudžiam
  insert into public.blank_trips (trip_date) values (current_date);
end $$;

-- Kitas žvejys svetimo blokavimo nemato ir lentelėje Z nebėra
set request.jwt.claim.sub = 'd3000000-0000-4000-8000-0000000000d3';
do $$ begin
  assert (select count(*) from public.user_bans) = 0, 'K mato Z blokavimą';
  assert not public.is_banned(), 'K laikomas užblokuotu';
  assert not exists (select 1 from public.leaderboard((select id from bx where k = 'tour'))
                      where user_id = 'd2000000-0000-4000-8000-0000000000d2'), 'užblokuotas Z vis dar lentelėje';
  assert (select user_id from public.leaderboard((select id from bx where k = 'tour')) where rank = 1)
         = 'd3000000-0000-4000-8000-0000000000d3', 'K turi pakilti į pirmą vietą';
  insert into public.entries (tournament_id) select id from bx where k = 'future';  -- K gali
end $$;
reset role;

\echo '   ok'
\echo 'B3. Slapyvardžio keitimas, atblokavimas, pasibaigęs ir amžinas blokavimas'
set role authenticated;
set request.jwt.claim.sub = 'd1000000-0000-4000-8000-0000000000d1';
do $$ begin
  assert public.reset_nickname('d2000000-0000-4000-8000-0000000000d2') = 'zvejys_d2000000', 'slapyvardis nepakeistas';
  assert (select nickname from public.profiles where id = 'd2000000-0000-4000-8000-0000000000d2') = 'zvejys_d2000000';
  perform public.ban_user('d2000000-0000-4000-8000-0000000000d2', null, 'Visam laikui');
  assert (select until from public.user_bans where user_id = 'd2000000-0000-4000-8000-0000000000d2') is null, 'amžinas turi būti be pabaigos';
  assert (select count(*) from public.user_bans) = 1, 'pakartotinis blokavimas turi atnaujinti, ne dubliuoti';
  perform public.unban_user('d2000000-0000-4000-8000-0000000000d2');
  assert (select until <= now() from public.user_bans where user_id = 'd2000000-0000-4000-8000-0000000000d2'), 'neatblokuota';
end $$;
set request.jwt.claim.sub = 'd2000000-0000-4000-8000-0000000000d2';
do $$ begin
  assert not public.is_banned(), 'po atblokavimo vis dar užblokuotas';
  insert into public.entries (tournament_id) select id from bx where k = 'future';
  assert exists (select 1 from public.leaderboard((select id from bx where k = 'tour'))
                  where user_id = 'd2000000-0000-4000-8000-0000000000d2' and rank = 1), 'po atblokavimo rezultatai negrįžo';
end $$;
reset role;

-- Pasibaigęs blokavimas nebegalioja
update public.user_bans set until = now() - interval '1 minute', reason = 'Pasibaigęs' where user_id = 'd2000000-0000-4000-8000-0000000000d2';
set role authenticated;
set request.jwt.claim.sub = 'd2000000-0000-4000-8000-0000000000d2';
do $$ begin
  assert not public.is_banned(), 'pasibaigęs blokavimas vis dar galioja';
  update public.profiles set region = 'Kauno r.' where id = auth.uid();
  assert found, 'po pasibaigusio blokavimo profilio keisti negalima';
end $$;
reset role;

-- Užblokuotas vis tiek gali ištrinti savo paskyrą (BDAR)
update public.user_bans set until = null where user_id = 'd2000000-0000-4000-8000-0000000000d2';
set role authenticated;
set request.jwt.claim.sub = 'd2000000-0000-4000-8000-0000000000d2';
do $$ begin
  assert public.is_banned(), 'turi būti užblokuotas';
  perform public.begin_account_deletion();
  perform public.finish_account_deletion();
end $$;
reset role;
do $$ begin
  assert not exists (select 1 from auth.users where id = 'd2000000-0000-4000-8000-0000000000d2'), 'užblokuotas negalėjo ištrinti paskyros';
  assert not exists (select 1 from public.user_bans where user_id = 'd2000000-0000-4000-8000-0000000000d2'), 'blokavimo įrašas liko';
end $$;
reset request.jwt.claim.sub;

\echo '   ok'
