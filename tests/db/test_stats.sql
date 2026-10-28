-- 0024: buvimas programėlėje, įrenginiai, savininko statistika.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'S1. Buvimas ir įrenginiai'
set role authenticated;
set request.jwt.claim.sub = '71000000-0000-4000-8000-000000000071';
select public.touch_presence('SM-S918B', 'Android', '14', 'Chrome', true);
select public.touch_presence('SM-S918B', 'Android', '14', 'Chrome', false);
select public.touch_presence('<script>alert(1)</script>', 'Hack', '1;drop', 'Chrome', false);
do $$ begin
  assert (select count(*) from public.user_devices where model = 'SM-S918B') = 1, 'dublis';
  assert (select installed from public.user_devices where model = 'SM-S918B'), 'įdiegta žymė dingo';
  assert exists (select 1 from public.user_devices where model = 'scriptalert(1)/script' and platform = 'Kita' and os_version = '1'), 'neišvalyta';
  assert (select count(*) from public.user_presence) = 1, 'buvimas';
end $$;
-- Iki 10 įrenginių vienam žvejui
select public.touch_presence('Modelis ' || g, 'Android', '13', 'Chrome', false) from generate_series(1, 15) g;
do $$ begin
  assert (select count(*) from public.user_devices) = 10, 'įrenginių limitas';
end $$;
set request.jwt.claim.sub = '72000000-0000-4000-8000-000000000072';
select public.touch_presence('iPhone', 'iOS', '17.5', 'Safari', true);
do $$ begin
  assert (select count(*) from public.user_devices) = 1, 'mato svetimus įrenginius';
  assert (select count(*) from public.user_presence) = 1, 'mato svetimą buvimą';
  begin perform public.admin_stats(); raise exception 'FAIL: statistika ne savininkui'; exception when raise_exception then if sqlerrm <> 'not allowed' then raise; end if; end;
  begin insert into public.user_devices (user_id, model, platform, browser) values (auth.uid(), 'Netikras', 'Android', 'X'); raise exception 'FAIL: tiesioginis įrašas';
  exception when insufficient_privilege then null; end;
  begin update public.user_presence set last_seen_at = now() - interval '1 day'; raise exception 'FAIL: buvimo keitimas';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
reset request.jwt.claim.sub;
set role anon;
do $$ begin
  begin perform public.touch_presence('x', 'Android', '1', 'x', false); raise exception 'FAIL: anonimas'; exception when insufficient_privilege then null; end;
  begin perform public.admin_stats(); raise exception 'FAIL: anonimo statistika'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.user_presence; raise exception 'FAIL: anonimas mato buvimą'; exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo 'S2. Savininko statistika'
-- Demonstracinis žvejys į skaičius neįtraukiamas
insert into auth.users (id, email) values ('7d000000-0000-4000-8000-00000000007d', 'demo-stat@demo.invalid');
update public.profiles set is_demo = true where id = '7d000000-0000-4000-8000-00000000007d';
update public.profiles set roles = array['owner'] where id = '76000000-0000-4000-8000-000000000076';
update public.user_presence set last_seen_at = now() - interval '2 days' where user_id = '72000000-0000-4000-8000-000000000072';
set role authenticated;
set request.jwt.claim.sub = '76000000-0000-4000-8000-000000000076';
do $$ declare s jsonb; begin
  s := public.admin_stats();
  assert (s->>'users')::int = (select count(*) from public.profiles) - 1 and (s->>'demo_users')::int = 1, 'vartotojai be demo';
  assert (s->>'new_today')::int >= 6, format('nauji šiandien %s', s->>'new_today');
  assert (s->>'online_now')::int = 1 and (s->>'active_today')::int = 1 and (s->>'active_7d')::int = 2, format('aktyvūs %s', s);
  assert jsonb_array_length(s->'signups') = 30, 'registracijų dienos';
  assert (s->'signups'->29->>'count')::int >= 6, 'šiandienos registracijos';
  assert (s->'models'->0->>'users')::int = 1, 'modeliai';
  assert exists (select 1 from jsonb_array_elements(s->'models') m where m->>'model' = 'iPhone' and m->>'platform' = 'iOS'), 'iPhone';
  assert exists (select 1 from jsonb_array_elements(s->'platforms') p where p->>'platform' = 'Android' and (p->>'users')::int = 1), 'platformos';
  assert (s->>'installed')::int = 2 and (s->>'with_device')::int = 2, format('įdiegta %s', s->>'installed');
  -- Suvestinėje nėra jokių vartotojų ID
  assert s::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-', 'suvestinėje ID';
end $$;
reset role;
update public.profiles set roles = '{}' where id = '76000000-0000-4000-8000-000000000076';
\echo '   ok'
