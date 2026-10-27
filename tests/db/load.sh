#!/usr/bin/env bash
# Apkrovos testas vietinėje Postgres: ~5 000 žvejų, 200 turnyrų, 120 000 laimikių.
#   1) lentelės (leaderboard) ir sąrašų užklausų trukmė su RLS, EXPLAIN ANALYZE;
#   2) pgbench: daug vienu metu skaitančių ir rašančių vartotojų.
# bash tests/db/load.sh        (LOAD_SECONDS=20 LOAD_CLIENTS=32 – trukmė ir klientų skaičius)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
if [ "$(id -u)" = "0" ]; then
  COPY="$(mktemp -d)"
  cp -r "$ROOT/supabase" "$ROOT/tests" "$COPY/"
  chown -R postgres "$COPY"
  status=0
  runuser -u postgres -- env LOAD_SECONDS="${LOAD_SECONDS:-20}" LOAD_CLIENTS="${LOAD_CLIENTS:-32}" bash "$COPY/tests/db/load.sh" || status=$?
  rm -rf "$COPY"
  exit $status
fi
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54331}"
SECS="${LOAD_SECONDS:-20}"
CLIENTS="${LOAD_CLIENTS:-32}"
cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORK/data" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
# Kuklūs nustatymai, artimi nemokamam Supabase planui (mažai atminties).
"$PGBIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses='' -c shared_buffers=128MB -c max_connections=100 -c work_mem=4MB" -l "$WORK/log" -w start >/dev/null
PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -c "create extension pgcrypto;"
"${PSQL[@]}" -f "$ROOT/tests/db/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f" 2>/dev/null; done
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"

echo "== Duomenų generavimas"
"${PSQL[@]}" <<'SQL'
\timing on
set session_replication_role = replica;  -- be trigerių: generuojam tiesiogiai
create function pg_temp.u(n int) returns uuid language sql immutable as
  $$ select ('00000000-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $$;
insert into auth.users (id, email) select pg_temp.u(g), 'u' || g || '@t.lt' from generate_series(1, 5000) g;
insert into public.profiles (id, nickname, region, trust_score, is_admin)
  select pg_temp.u(g), 'zvejys_' || g, 'Rajonas ' || (g % 60), 50, g = 1 from generate_series(1, 5000) g;
-- 200 turnyrų: 1-asis – didelis (3 000 dalyvių, vyksta), kiti įvairūs
insert into public.tournaments (id, organizer_id, title, format, top_n, min_length_mm, starts_at, ends_at, visibility, leaderboard_hidden, created_at)
  select ('10000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, pg_temp.u(1 + g % 5000), 'Turnyras ' || g,
         case when g % 2 = 0 then 'biggest' else 'top_n_sum' end, 3, (g % 4) * 100,
         now() - ((g % 60) || ' days')::interval, now() - ((g % 60) || ' days')::interval + ((7 + g % 50) || ' days')::interval,
         case when g % 10 = 0 then 'private' else 'public' end, g % 7 = 0, now() - interval '70 days'
    from generate_series(1, 200) g;
update public.tournaments set starts_at = now() - interval '10 days', ends_at = now() + interval '20 days', visibility = 'public', leaderboard_hidden = false
 where id = '10000000-0000-4000-8000-000000000001';
insert into public.tournament_species select id, 1 + (row_number() over ())::int % 5 from public.tournaments where title not like '%1';
insert into public.entries (tournament_id, user_id)
  select '10000000-0000-4000-8000-000000000001', pg_temp.u(g) from generate_series(1, 3000) g;
insert into public.entries (tournament_id, user_id)
  select distinct ('10000000-0000-4000-8000-' || lpad(to_hex(2 + (g * 7919) % 199), 12, '0'))::uuid, pg_temp.u(1 + (g * 31) % 5000)
    from generate_series(1, 60000) g on conflict do nothing;
insert into public.catches (id, user_id, client_id, species_id, length_mm, captured_at_device, received_at, photo_path, photo_sha256, status, created_at)
  select gen_random_uuid(), pg_temp.u(1 + (g * 13) % 5000), gen_random_uuid(), 1 + g % 6, 200 + (g * 37) % 900,
         now() - ((g % 80) || ' days')::interval - ((g % 1440) || ' minutes')::interval,
         now() - ((g % 80) || ' days')::interval - ((g % 1440) || ' minutes')::interval + interval '1 minute',
         'x/' || g || '.jpg', md5(g::text) || md5((g * 3)::text),
         case when g % 10 < 8 then 'approved' when g % 10 = 8 then 'pending' else 'rejected' end,
         now() - ((g % 80) || ' days')::interval
    from generate_series(1, 120000) g;
insert into public.catch_locations (catch_id, lat, lng, accuracy_m)
  select id, 54 + random(), 23 + random(), 5 + (random() * 50)::int from public.catches;
set session_replication_role = origin;
analyze;
select (select count(*) from public.profiles) profiles, (select count(*) from public.tournaments) tournaments,
       (select count(*) from public.entries) entries, (select count(*) from public.catches) catches;
SQL

echo "== Užklausų trukmė su RLS (vidurkis iš 20 kartų)"
"${PSQL[@]}" <<'SQL'
create function pg_temp.bench(p_label text, p_sql text, p_user uuid, p_limit_ms numeric) returns void
language plpgsql as $$
declare t0 timestamptz; ms numeric; i int;
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  execute format('set local role %I', case when p_user is null then 'anon' else 'authenticated' end);
  execute p_sql;  -- pašildymas
  t0 := clock_timestamp();
  for i in 1..20 loop execute p_sql; end loop;
  ms := extract(epoch from clock_timestamp() - t0) * 1000 / 20;
  reset role;
  raise notice '%: % ms', rpad(p_label, 46), round(ms, 2);
  if ms > p_limit_ms then raise exception 'FAIL: % užtruko % ms (riba % ms)', p_label, round(ms, 1), p_limit_ms; end if;
end $$;
select pg_temp.bench('Didelio turnyro lentelė (3000 dalyvių), anon',
  $$select count(*) from public.leaderboard('10000000-0000-4000-8000-000000000001')$$, null, 300);
select pg_temp.bench('Didelio turnyro lentelė, dalyvis',
  $$select count(*) from public.leaderboard('10000000-0000-4000-8000-000000000001')$$, '00000000-0000-4000-8000-000000000064', 300);
select pg_temp.bench('Turnyrų sąrašas su rūšimis ir dalyvių sk.',
  $$select count(*) from (select t.*, (select array_agg(species_id) from public.tournament_species s where s.tournament_id = t.id),
     (select count(*) from public.entries e where e.tournament_id = t.id) from public.tournaments t order by starts_at) x$$,
  '00000000-0000-4000-8000-000000000064', 150);
select pg_temp.bench('Mano laimikiai (dienoraštis)',
  $$select count(*) from (select * from public.catches where user_id = '00000000-0000-4000-8000-000000000064' order by captured_at_device desc) x$$,
  '00000000-0000-4000-8000-000000000064', 50);
select pg_temp.bench('Kito žvejo profilis (patvirtinti laimikiai)',
  $$select count(*) from public.catches where user_id = '00000000-0000-4000-8000-0000000000c8' and status = 'approved'$$,
  '00000000-0000-4000-8000-000000000064', 50);
select pg_temp.bench('Moderavimo eilė su vietomis (admin)',
  $$select count(*) from (select c.*, l.lat from public.catches c left join public.catch_locations l on l.catch_id = c.id
     where c.status = 'pending' order by received_at limit 50) x$$, '00000000-0000-4000-8000-000000000001', 150);
select pg_temp.bench('Laimikio įterpimas (trigeris + paros limitas)',
  $$insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
    select v, 1, 500, now(), '00000000-0000-4000-8000-000000000999/' || v || '.jpg', encode(digest(v::text, 'sha256'), 'hex')
      from gen_random_uuid() v$$, '00000000-0000-4000-8000-000000000999', 30);
SQL

echo "== EXPLAIN ANALYZE: lentelės funkcijos vidus (didelis turnyras)"
"${PSQL[@]}" -c "set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000064'; set role authenticated;
explain (analyze, buffers, costs off, timing off, summary on)
select c.user_id, c.length_mm from public.catches c
  join public.entries e on e.tournament_id = '10000000-0000-4000-8000-000000000001' and e.user_id = c.user_id
 where c.status = 'approved' and c.captured_at_device >= now() - interval '10 days';" | grep -E "Scan|Join|Execution|Planning" | head -12

echo "== pgbench: $CLIENTS vienu metu jungiami vartotojai, ${SECS}s kiekvienam scenarijui"
cat > "$WORK/read.sql" <<'SQL'
\set u random(1, 5000)
\set t random(1, 200)
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-' || lpad(to_hex(:u), 12, '0'), true);
set local role authenticated;
select count(*) from public.leaderboard(('10000000-0000-4000-8000-' || lpad(to_hex(:t), 12, '0'))::uuid);
select count(*) from public.catches where user_id = ('00000000-0000-4000-8000-' || lpad(to_hex(:u), 12, '0'))::uuid;
commit;
SQL
cat > "$WORK/hot.sql" <<'SQL'
\set u random(1, 3000)
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-' || lpad(to_hex(:u), 12, '0'), true);
set local role authenticated;
select count(*) from public.leaderboard('10000000-0000-4000-8000-000000000001');
commit;
SQL
cat > "$WORK/write.sql" <<'SQL'
\set u random(1, 5000)
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-' || lpad(to_hex(:u), 12, '0'), true);
set local role authenticated;
insert into public.catches (client_id, species_id, length_mm, captured_at_device, photo_path, photo_sha256)
  select v, 1 + :u % 6, 300 + :u % 700, now(), '00000000-0000-4000-8000-' || lpad(to_hex(:u), 12, '0') || '/' || v || '.jpg',
         encode(digest(v::text, 'sha256'), 'hex') from gen_random_uuid() v;
commit;
SQL
PGB=("$PGBIN/pgbench" -h "$WORK" -p "$PORT" -U postgres -n -c "$CLIENTS" -j 4 -T "$SECS" postgres)
run_bench() {
  local name="$1" file="$2" min_tps="$3" max_lat="$4"
  local out tps lat
  out="$("${PGB[@]}" -f "$file" 2>&1)" || { echo "pgbench klaida:"; echo "$out" | tail -8; exit 1; }
  tps="$(echo "$out" | sed -n 's/^tps = \([0-9.]*\).*/\1/p' | head -1)"
  lat="$(echo "$out" | sed -n 's/^latency average = \([0-9.]*\) ms/\1/p')"
  fail="$(echo "$out" | sed -n 's/^number of failed transactions: \([0-9]*\).*/\1/p')"
  printf "  %-44s %8s tps   vid. %7s ms   klaidų %s\n" "$name" "$tps" "$lat" "${fail:-0}"
  awk -v t="$tps" -v m="$min_tps" -v l="$lat" -v x="$max_lat" -v f="${fail:-0}" 'BEGIN { exit !(t >= m && l <= x && f == 0) }' \
    || { echo "FAIL: $name (riba ≥ $min_tps tps, ≤ $max_lat ms, 0 klaidų)"; echo "$out" | tail -5; exit 1; }
}
run_bench "Skaitymas: atsitiktinė lentelė + dienoraštis" "$WORK/read.sql" 100 500
run_bench "Karšta lentelė: visi žiūri didžiausią turnyrą" "$WORK/hot.sql" 50 1000
run_bench "Rašymas: laimikių įkėlimas" "$WORK/write.sql" 300 200
"${PSQL[@]}" -c "select count(*) as laimikiu_po_testo from public.catches;"
echo "APKROVOS TESTAS PRAĖJO"
