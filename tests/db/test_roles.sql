-- 0014: rolės ir teisės.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'O1. Rolių skyrimas: tik savininkas, savininko keisti negalima'

insert into auth.users (id, email) values
  ('e1000000-0000-4000-8000-0000000000e1', 'role-owner@test.lt'),
  ('e2000000-0000-4000-8000-0000000000e2', 'role-admin@test.lt'),
  ('e3000000-0000-4000-8000-0000000000e3', 'role-mod@test.lt'),
  ('e4000000-0000-4000-8000-0000000000e4', 'role-judge@test.lt'),
  ('e5000000-0000-4000-8000-0000000000e5', 'role-guard@test.lt'),
  ('e6000000-0000-4000-8000-0000000000e6', 'role-angler@test.lt'),
  ('e7000000-0000-4000-8000-0000000000e7', 'role-reporter@test.lt'),
  ('e8000000-0000-4000-8000-0000000000e8', 'role-banned@test.lt');
update public.profiles set nickname = v.n
  from (values ('e1000000-0000-4000-8000-0000000000e1'::uuid, 'R_Savininkas'), ('e2000000-0000-4000-8000-0000000000e2', 'R_Admin'),
               ('e3000000-0000-4000-8000-0000000000e3', 'R_Tikrintojas'), ('e4000000-0000-4000-8000-0000000000e4', 'R_Teisejas'),
               ('e5000000-0000-4000-8000-0000000000e5', 'R_Prizietojas'), ('e6000000-0000-4000-8000-0000000000e6', 'R_Zvejys'),
               ('e7000000-0000-4000-8000-0000000000e7', 'R_Pranesejas'), ('e8000000-0000-4000-8000-0000000000e8', 'R_Uzblokuotas')) v(id, n)
 where profiles.id = v.id;
update public.profiles set roles = array['owner'] where id = 'e1000000-0000-4000-8000-0000000000e1';
insert into public.user_bans (user_id, until, reason) values ('e8000000-0000-4000-8000-0000000000e8', null, 'Testas');

do $$ begin
  assert (select is_admin from public.profiles where id = 'e1000000-0000-4000-8000-0000000000e1'), 'is_admin nesinchronizuotas';
  assert (select roles = '{}' and not is_admin from public.profiles where id = 'e2000000-0000-4000-8000-0000000000e2'), 'naujas be rolių';
end $$;

set role authenticated;
set request.jwt.claim.sub = 'e1000000-0000-4000-8000-0000000000e1';
do $$
declare e text;
begin
  assert public.my_permissions() = array['ban', 'disputes', 'review', 'roles'], format('savininko teisės: %s', public.my_permissions());
  perform public.set_role('r_admin', 'admin', true);
  perform public.set_role('R_Tikrintojas', 'moderator', true);
  perform public.set_role('R_Teisejas', 'judge', true);
  perform public.set_role('R_Prizietojas', 'guard', true);
  perform public.set_role('R_Prizietojas', 'guard', true);   -- pakartotinai – nieko nekeičia
  foreach e in array array['owner_role', 'bad_role', 'owner_target', 'banned', 'nouser'] loop
    begin
      case e
        when 'owner_role'   then perform public.set_role('R_Zvejys', 'owner', true);
        when 'bad_role'     then perform public.set_role('R_Zvejys', 'hacker', true);
        when 'owner_target' then perform public.set_role('R_Savininkas', 'admin', false);
        when 'banned'       then perform public.set_role('R_Uzblokuotas', 'moderator', true);
        when 'nouser'       then perform public.set_role('Niekas_Toks', 'moderator', true);
      end case;
      raise exception 'FAIL: leista – %', e;
    exception when raise_exception then
      if sqlerrm like 'FAIL%' then raise; end if;
    end;
  end loop;
  assert (select count(*) from public.role_changes) = 4, format('žurnale %s įrašai', (select count(*) from public.role_changes));
  assert (select roles from public.profiles where nickname = 'R_Prizietojas') = array['guard'], 'rolė dubliuota';
  assert (select roles from public.profiles where nickname = 'R_Savininkas') = array['owner'], 'savininkas pakeistas';
end $$;

-- Administratorius rolių skirti negali; savo rolių pasikeisti niekas negali
set request.jwt.claim.sub = 'e2000000-0000-4000-8000-0000000000e2';
do $$ begin
  assert public.my_permissions() = array['ban', 'disputes', 'review'], format('admin teisės: %s', public.my_permissions());
  begin
    perform public.set_role('R_Zvejys', 'moderator', true);
    raise exception 'FAIL: administratorius skyrė rolę';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  assert (select count(*) from public.role_changes) = 0, 'administratorius mato rolių žurnalą';
end $$;
set request.jwt.claim.sub = 'e6000000-0000-4000-8000-0000000000e6';
do $$ declare n int; begin
  assert public.my_permissions() = '{}', 'žvejys turi teisių';
  begin
    update public.profiles set roles = array['owner'] where id = auth.uid();
    raise exception 'FAIL: pats pasiskyrė rolę';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set is_admin = true where id = auth.uid();
    raise exception 'FAIL: pats pasidarė administratoriumi';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo '   ok'
\echo 'O2. Kiekviena rolė gali tik savo darbus'

-- Duomenys: R_Zvejys turi laukiantį laimikį su vieta, atmestą su ginču ir patvirtintą su pranešimu.
set request.jwt.claim.sub = 'e6000000-0000-4000-8000-0000000000e6';
create temp table ox (k text primary key, id uuid);
grant select on ox to authenticated;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 700, now() - interval '1 hour', 'e6000000-0000-4000-8000-0000000000e6/p.jpg', repeat('9a', 32)) returning id)
insert into ox select 'pending', id from c;
insert into public.catch_locations (catch_id, lat, lng, accuracy_m) select id, 54.9, 23.9, 5 from ox where k = 'pending';
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 650, now() - interval '2 hours', 'e6000000-0000-4000-8000-0000000000e6/r.jpg', repeat('9b', 32)) returning id)
insert into ox select 'rejected', id from c;
with c as (insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
           values (gen_random_uuid(), 1, 800, now() - interval '3 hours', 'e6000000-0000-4000-8000-0000000000e6/a.jpg', repeat('9c', 32)) returning id)
insert into ox select 'approved', id from c;
set request.jwt.claim.sub = 'e1000000-0000-4000-8000-0000000000e1';
select public.review_catch(id, false, 'Nesimato matavimo') from ox where k = 'rejected';
select public.review_catch(id, true, null) from ox where k = 'approved';
set request.jwt.claim.sub = 'e6000000-0000-4000-8000-0000000000e6';
insert into public.disputes (catch_id, message) select id, 'Liniuotė matosi' from ox where k = 'rejected';
set request.jwt.claim.sub = 'e7000000-0000-4000-8000-0000000000e7';
insert into public.catch_reports (catch_id, reason) select id, 'old_photo' from ox where k = 'approved';
reset request.jwt.claim.sub;

-- Pagalbinė: ar veiksmas leidžiamas (įvykdom ir atšaukiam)
create function pg_temp.can(p_sql text) returns boolean language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'ok_rollback';
  exception
    when raise_exception then
      if sqlerrm = 'ok_rollback' then return true; end if;
      return false;
    when insufficient_privilege then return false;
  end;
end $$;
grant execute on function pg_temp.can(text) to authenticated;

set role authenticated;
do $$
declare
  who record;
  q_review  text := format('select public.review_catch(%L, true, null)', (select id from ox where k = 'pending'));
  q_dispute text := format('select public.resolve_dispute((select id from public.disputes where catch_id = %L), true, null)', (select id from ox where k = 'rejected'));
  q_report  text := format('select public.resolve_report((select id from public.catch_reports where catch_id = %L), false, null)', (select id from ox where k = 'approved'));
  q_ban     text := $q$select public.ban_user('e7000000-0000-4000-8000-0000000000e7', 1, 'Testas')$q$;
  q_nick    text := $q$select public.reset_nickname('e7000000-0000-4000-8000-0000000000e7')$q$;
  q_roles   text := $q$select public.set_role('R_Pranesejas', 'judge', true)$q$;
  got text;
begin
  for who in select * from (values
      -- vardas, id, review, disputes, ban, roles, mato vietas, mato ginčus/pranešimus, mato blokavimus
      ('savininkas',  'e1000000-0000-4000-8000-0000000000e1', true,  true,  true,  true,  true,  true,  true),
      ('admin',       'e2000000-0000-4000-8000-0000000000e2', true,  true,  true,  false, true,  true,  true),
      ('tikrintojas', 'e3000000-0000-4000-8000-0000000000e3', true,  false, false, false, true,  false, false),
      ('teisėjas',    'e4000000-0000-4000-8000-0000000000e4', false, true,  false, false, false, true,  false),
      ('prižiūrėtojas','e5000000-0000-4000-8000-0000000000e5', false, false, true,  false, false, false, true),
      ('žvejys',      'e7000000-0000-4000-8000-0000000000e7', false, false, false, false, false, false, false)
    ) v(name, id, review, disputes, ban, roles, sees_loc, sees_disp, sees_bans)
  loop
    perform set_config('request.jwt.claim.sub', who.id, true);
    got := concat_ws(',',
      pg_temp.can(q_review) = who.review,
      pg_temp.can(q_dispute) = who.disputes,
      pg_temp.can(q_report) = who.disputes,
      pg_temp.can(q_ban) = (who.ban and who.name <> 'žvejys'),
      pg_temp.can(q_nick) = who.ban,
      pg_temp.can(q_roles) = who.roles,
      ((select count(*) from public.catch_locations) > 0) = who.sees_loc,
      ((select count(*) from public.disputes) > 0) = who.sees_disp,
      ((select count(*) from public.catch_reports where reporter_id <> auth.uid()) > 0) = who.sees_disp,
      ((select count(*) from public.user_bans where user_id <> auth.uid()) > 0) = who.sees_bans);
    if got like '%f%' then   -- loginės reikšmės tekste: t / f
      raise exception 'FAIL: % – [review,dispute,report,ban,nick,roles,vietos,ginčai,pranešimai,blokavimai] = %', who.name, got;
    end if;
  end loop;
end $$;
reset role;

-- Komandos nario blokuoti negalima
set role authenticated;
set request.jwt.claim.sub = 'e5000000-0000-4000-8000-0000000000e5';
do $$ begin
  begin
    perform public.ban_user('e3000000-0000-4000-8000-0000000000e3', 1, 'Kolega');
    raise exception 'FAIL: prižiūrėtojas užblokavo tikrintoją';
  exception when raise_exception then if sqlerrm <> 'ban_admin' then raise; end if; end;
end $$;
reset role;

\echo '   ok'
\echo 'O3. Rolės atėmimas ir senas set_moderator'
set role authenticated;
set request.jwt.claim.sub = 'e1000000-0000-4000-8000-0000000000e1';
select public.set_role('R_Tikrintojas', 'moderator', false);
select public.set_moderator('R_Zvejys', true);
do $$ begin
  assert (select roles = '{}' and not is_admin from public.profiles where nickname = 'R_Tikrintojas'), 'rolė neatimta';
  assert (select roles = array['admin'] and is_admin from public.profiles where nickname = 'R_Zvejys'), 'set_moderator nesuteikė admin';
  assert (select count(*) from public.role_changes where user_id = 'e3000000-0000-4000-8000-0000000000e3') = 2, 'žurnale nėra atėmimo';
  assert (select granted from public.role_changes where user_id = 'e3000000-0000-4000-8000-0000000000e3' order by id desc limit 1) = false;
end $$;
set request.jwt.claim.sub = 'e3000000-0000-4000-8000-0000000000e3';
do $$ begin
  assert public.my_permissions() = '{}', 'po atėmimo liko teisių';
  assert (select count(*) from public.catch_locations) = 0, 'po atėmimo mato vietas';
end $$;
reset role;
reset request.jwt.claim.sub;

\echo '   ok'
