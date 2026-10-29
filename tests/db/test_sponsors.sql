-- 0027: rėmėjų logotipai, generalinis rėmėjas, statistika.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'R1. Rėmėjų tvarkymas ir logotipai'

insert into auth.users (id, email) values
  ('5b100000-0000-4000-8000-0000000005b1', 'sp-org@test.lt'),
  ('5b200000-0000-4000-8000-0000000005b2', 'sp-user@test.lt'),
  ('5b300000-0000-4000-8000-0000000005b3', 'sp-admin@test.lt');
update public.profiles set roles = array['admin'] where id = '5b300000-0000-4000-8000-0000000005b3';
create temp table sx (k text primary key, id uuid);
grant select on sx to authenticated, anon;

set session_replication_role = replica;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, invite_code)
           values ('5b100000-0000-4000-8000-0000000005b1', 'Remiama taurė', 'biggest', now() - interval '1 day', now() + interval '1 day', 'spn0000001')
           returning id)
insert into sx select 'live', id from t;
with t as (insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility, invite_code)
           values ('5b100000-0000-4000-8000-0000000005b1', 'Privati remiama', 'biggest', now() - interval '1 day', now() + interval '1 day', 'private', 'spn0000002')
           returning id)
insert into sx select 'priv', id from t;
insert into public.entries (tournament_id, user_id, joined_at) values ((select id from sx where k = 'live'), '5b100000-0000-4000-8000-0000000005b1', now() - interval '2 days');
set session_replication_role = origin;

set role authenticated;
set request.jwt.claim.sub = '5b100000-0000-4000-8000-0000000005b1';
-- Organizatorius prideda rėmėjus vykstančiame turnyre (anksčiau – tik iki starto)
do $$ declare v uuid := (select id from sx where k = 'live'); begin
  insert into public.tournament_sponsors (tournament_id, name, url, tier, blurb, logo_path, sort)
  values (v, 'Žvejų parduotuvė', 'https://example.com', 'main', '-10 % dalyviams su kodu TAURE', v || '/main-1.webp', 0),
         (v, 'Kavinė prie ežero', null, 'partner', null, null, 1);
  begin insert into public.tournament_sponsors (tournament_id, name, tier, sort) values (v, 'Antras generalinis', 'main', 2); raise exception 'FAIL: du generaliniai';
  exception when unique_violation then null; end;
  begin insert into public.tournament_sponsors (tournament_id, name, logo_path, sort) values (v, 'Svetimas kelias', 'ad100000-0000-4000-8000-0000000000a1/x.webp', 3); raise exception 'FAIL: svetimas logotipo kelias';
  exception when check_violation then null; end;
  begin insert into public.tournament_sponsors (tournament_id, name, logo_path, sort) values (v, 'SVG', v || '/x.svg', 3); raise exception 'FAIL: svg';
  exception when check_violation then null; end;
  begin insert into public.tournament_sponsors (tournament_id, name, blurb, sort) values (v, 'Ilgas', repeat('x', 141), 3); raise exception 'FAIL: ilgas tekstas';
  exception when check_violation then null; end;
  -- Logotipo failas – tik į savo turnyro aplanką
  insert into storage.objects (bucket_id, name) values ('sponsor-logos', v || '/main-1.webp');
  begin insert into storage.objects (bucket_id, name) values ('sponsor-logos', 'ad100000-0000-4000-8000-0000000000a1/x.webp'); raise exception 'FAIL: svetimas aplankas';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('sponsor-logos', v || '/x.svg'); raise exception 'FAIL: svg failas';
  exception when insufficient_privilege then null; end;
end $$;
-- Paprastas žvejys: rėmėjų keisti negali, logotipų kelti – taip pat
set request.jwt.claim.sub = '5b200000-0000-4000-8000-0000000005b2';
do $$ declare n int; v uuid := (select id from sx where k = 'live'); begin
  update public.tournament_sponsors set name = 'Pavogta' where tournament_id = v;
  get diagnostics n = row_count;
  assert n = 0, 'žvejys pakeitė rėmėją';
  begin insert into public.tournament_sponsors (tournament_id, name, sort) values (v, 'Įsibrovėlis', 5); raise exception 'FAIL: žvejys pridėjo rėmėją';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name) values ('sponsor-logos', v || '/hack.webp'); raise exception 'FAIL: žvejys įkėlė logotipą';
  exception when insufficient_privilege then null; end;
  assert (select count(*) from public.tournament_sponsors where tournament_id = v) = 2, 'žvejys nemato viešo turnyro rėmėjų';
  assert (select count(*) from storage.objects where bucket_id = 'sponsor-logos') = 1, 'logotipai matomi visiems';
  begin perform public.sponsor_report(v); raise exception 'FAIL: žvejys mato ataskaitą';
  exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin perform 1 from public.sponsor_stats; raise exception 'FAIL: tiesioginė statistika';
  exception when insufficient_privilege then null; end;
end $$;
-- Administratorius – gali tvarkyti ir svetimo turnyro rėmėjus
set request.jwt.claim.sub = '5b300000-0000-4000-8000-0000000005b3';
do $$ declare v uuid := (select id from sx where k = 'priv'); begin
  insert into public.tournament_sponsors (tournament_id, name, logo_path, sort) values (v, 'Admino rėmėjas', v || '/a.png', 0);
  insert into storage.objects (bucket_id, name) values ('sponsor-logos', v || '/a.png');
end $$;
reset role;

\echo 'R2. Statistika'
set role anon;
reset request.jwt.claim.sub;
do $$ declare s uuid[] := (select array_agg(id order by sort) from public.tournament_sponsors where tournament_id = (select id from sx where k = 'live')); begin
  perform public.sponsor_track(s, 'view');
  perform public.sponsor_track(s, 'view');
  perform public.sponsor_track(s[1:1], 'click');
  perform public.sponsor_track(s, 'click');           -- paspaudimas – tik pirmam
  perform public.sponsor_track(s, 'hack');            -- nežinoma rūšis – ignoruojama
  perform public.sponsor_track(array[gen_random_uuid()], 'view'); -- nėra tokio rėmėjo
  begin perform public.sponsor_report((select id from sx where k = 'live')); raise exception 'FAIL: anonimas mato ataskaitą';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = '5b100000-0000-4000-8000-0000000005b1';
do $$ declare r jsonb := public.sponsor_report((select id from sx where k = 'live')); m jsonb; begin
  assert (r->>'participants')::int = 1, format('dalyviai %s', r);
  assert jsonb_array_length(r->'sponsors') = 2, 'rėmėjų skaičius';
  m := r->'sponsors'->0;
  assert m->>'tier' = 'main' and (m->>'views')::int = 2 and (m->>'clicks')::int = 2 and (m->>'views_7d')::int = 2, format('generalinis %s', m);
  assert (r->'sponsors'->1->>'views')::int = 2 and (r->'sponsors'->1->>'clicks')::int = 0, format('partneris %s', r->'sponsors'->1);
end $$;
reset role;
reset request.jwt.claim.sub;
do $$ begin
  assert (select count(*) from public.sponsor_stats) = 2, 'neegzistuojantis rėmėjas pateko į statistiką';
end $$;
\echo '   ok – rėmėjų logotipai ir statistika'
