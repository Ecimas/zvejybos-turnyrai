import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBadges, longestStreak } from '../../src/lib/badges.js';
import { parseWeather, fetchWeather, weatherLine } from '../../src/lib/weather.js';

const day = (d, h = 8) => new Date(2026, 9, d, h).toISOString();

test('serija: dienos iš eilės, ne tos pačios dienos laimikiai', () => {
  assert.equal(longestStreak([]), 0);
  assert.equal(longestStreak([day(1), day(1, 20)]), 1);
  assert.equal(longestStreak([day(1), day(2), day(3), day(5), day(6)]), 3);
  assert.equal(longestStreak([day(6), day(5), day(4)]), 3);
});

test('serija veikia per mėnesio ir laiko keitimo ribą', () => {
  const dates = [new Date(2026, 9, 24, 23).toISOString(), new Date(2026, 9, 25, 1).toISOString(),
    new Date(2026, 9, 26, 12).toISOString(), new Date(2026, 9, 31, 9).toISOString(), new Date(2026, 10, 1, 9).toISOString()];
  assert.equal(longestStreak(dates), 3);
});

test('ženkliukai: tik patvirtinti laimikiai', () => {
  const catches = [
    { status: 'approved', species_id: 1, length_mm: 810, captured_at_device: day(1) },
    { status: 'approved', species_id: 2, length_mm: 300, captured_at_device: day(2) },
    { status: 'approved', species_id: 3, length_mm: 400, captured_at_device: day(3) },
    { status: 'pending', species_id: 4, length_mm: 1200, captured_at_device: day(4) },
    { status: 'rejected', species_id: 5, length_mm: 1100, captured_at_device: day(4) }
  ];
  const b = Object.fromEntries(computeBadges(catches, 5).map((x) => [x.key, x]));
  assert.equal(b.first.earned, true);
  assert.equal(b.big80.earned, true);
  assert.equal(b.metre.earned, false, 'nepatvirtinta metrinė neturi skaičiuotis');
  assert.equal(b.species5.earned, false);
  assert.equal(b.species5.progress, 3 / 5);
  assert.equal(b.streak3.earned, true);
  assert.equal(b.tourn5.earned, true);
  assert.equal(b.catches25.progress, 3 / 25);
});

test('oras: atsakymo apdorojimas ir blogi duomenys', () => {
  const w = parseWeather({ current: { temperature_2m: 6.44, wind_speed_10m: 3.06, surface_pressure: 1012.6, weather_code: 3 } });
  assert.deepEqual(w, { temp_c: 6.4, wind_ms: 3.1, pressure_hpa: 1013, code: 3 });
  assert.equal(weatherLine(w), '6,4 °C, debesuota, vėjas 3,1 m/s, 1013 hPa');
  assert.equal(parseWeather({}), null);
  assert.equal(parseWeather({ current: { temperature_2m: 'x' } }), null);
  assert.equal(weatherLine(null), '');
});

test('oras: tinklo klaida ir laukimo riba grąžina null, ne klaidą', async () => {
  assert.equal(await fetchWeather(54.9, 23.9, { fetchImpl: async () => { throw new TypeError('offline'); } }), null);
  assert.equal(await fetchWeather(54.9, 23.9, { fetchImpl: async () => ({ ok: false }) }), null);
  const slow = (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort'))));
  const t0 = Date.now();
  assert.equal(await fetchWeather(54.9, 23.9, { fetchImpl: slow, timeoutMs: 50 }), null);
  assert.ok(Date.now() - t0 < 1000);
  let asked = '';
  await fetchWeather(54.91234, 23.98765, { fetchImpl: async (u) => { asked = u; return { ok: true, json: async () => ({}) }; } });
  assert.match(asked, /latitude=54\.912&longitude=23\.988/, 'koordinatės apvalinamos – tikslios vietos neišduodamos');
});

test('atotrūkis iki aukštesnės vietos, įskaitant lygų rezultatą', async () => {
  const { gapText } = await import('../../src/lib/format.js');
  assert.equal(gapText({ rank: 2, score_mm: 810 }, { score_mm: 740 }), 'Iki #2 trūksta 7 cm');
  assert.equal(gapText({ rank: 5, score_mm: 620 }, { score_mm: 620 }), 'Tiek pat kaip #5 – jis pagavo anksčiau, reikia bent 1 mm daugiau');
});

test('vėlyva registracija: iki pabaigos, tik iki starto, N min. po starto', async () => {
  const { registrationOpen, registrationClosesAt, registrationLabel } = await import('../../src/lib/format.js');
  const H = 3600e3;
  const now = Date.parse('2026-10-27T12:00:00Z');
  const t = (startOff, endOff, late) => ({ starts_at: new Date(now + startOff).toISOString(), ends_at: new Date(now + endOff).toISOString(), late_join_minutes: late });
  assert.equal(registrationOpen(t(-2 * H, 5 * H, null), now), true, 'null – iki pabaigos');
  assert.equal(registrationOpen(t(-2 * H, 5 * H, undefined), now), true, 'senas turnyras be lauko');
  assert.equal(registrationOpen(t(-2 * H, -1, null), now), false, 'pasibaigęs');
  assert.equal(registrationOpen(t(1 * H, 5 * H, 0), now), true, 'prieš startą su 0');
  assert.equal(registrationOpen(t(-1, 5 * H, 0), now), false, 'po starto su 0');
  assert.equal(registrationOpen(t(-2 * H, 5 * H, 180), now), true, '3 val. riba');
  assert.equal(registrationOpen(t(-3 * H, 5 * H, 180), now), false, 'lygiai riboje – jau uždaryta');
  assert.equal(registrationClosesAt(t(-1 * H, 1 * H, 1440)), now + 1 * H, 'riba ne vėliau nei pabaiga');
  assert.equal(registrationLabel(t(0, H, null)), 'Iki pabaigos');
  assert.equal(registrationLabel(t(0, H, 0)), 'Tik iki starto');
  assert.match(registrationLabel(t(0, 5 * H, 60)), /^Iki /);
});

test('blokavimas: galiojimas ir tekstai', async () => {
  const { banActive, banUntilText, BAN_DAYS } = await import('../../src/lib/bans.js');
  const now = Date.parse('2026-10-27T12:00:00Z');
  assert.equal(banActive(null, now), false);
  assert.equal(banActive({ until: null }, now), true, 'visam laikui');
  assert.equal(banActive({ until: '2026-10-28T12:00:00+00:00' }, now), true, 'Supabase laiko formatas');
  assert.equal(banActive({ until: '2026-10-27T11:59:59Z' }, now), false, 'pasibaigęs');
  assert.equal(banUntilText({ until: null }), 'visam laikui');
  assert.match(banUntilText({ until: '2026-10-28T12:00:00Z' }), /^iki /);
  assert.deepEqual(BAN_DAYS.map(([d]) => d), [1, 7, 30, null]);
});

test('rolės: teisės, senas is_admin, savininko neskiriama', async () => {
  const { permsOf, rolesOf, isStaff, can, ASSIGNABLE, roleLabel } = await import('../../src/lib/roles.js');
  const sorted = (s) => [...s].sort();
  assert.deepEqual(sorted(permsOf({ roles: ['owner'] })), ['ban', 'disputes', 'review', 'roles']);
  assert.deepEqual(sorted(permsOf({ roles: ['admin'] })), ['ban', 'disputes', 'review']);
  assert.deepEqual(sorted(permsOf({ roles: ['moderator'] })), ['review']);
  assert.deepEqual(sorted(permsOf({ roles: ['judge'] })), ['disputes']);
  assert.deepEqual(sorted(permsOf({ roles: ['guard'] })), ['ban']);
  assert.deepEqual(sorted(permsOf({ roles: ['judge', 'guard'] })), ['ban', 'disputes'], 'kelios rolės sudedamos');
  assert.deepEqual(sorted(permsOf({ roles: [], is_admin: true })), [], 'roles svarbiau už is_admin');
  assert.deepEqual(rolesOf({ is_admin: true }), ['owner'], 'senas profilis be roles');
  assert.equal(isStaff({ roles: [] }), false);
  assert.equal(isStaff(null), false);
  assert.equal(can({ profile: { roles: ['moderator'] } }, 'ban'), false);
  assert.equal(can({ profile: null }, 'review'), false);
  assert.ok(!ASSIGNABLE.some((r) => r.key === 'owner'), 'savininko programėlėje skirti negalima');
  assert.equal(roleLabel('judge'), 'Ginčų teisėjas');
});

test('žemėlapis: atstumas ir vietų grupavimas (~50 m)', async () => {
  const { distance, groupSpots, colorFor } = await import('../../src/lib/map.js');
  assert.ok(Math.abs(distance(54.9, 23.9, 54.9, 23.9)) < 1e-6);
  const d = distance(54.9, 23.9, 54.9009, 23.9); // ~100 m į šiaurę
  assert.ok(d > 95 && d < 105, String(d));
  const pts = [
    { id: 1, lat: 54.9, lng: 23.9 }, { id: 2, lat: 54.9002, lng: 23.9002 }, // ~26 m – ta pati vieta
    { id: 3, lat: 54.91, lng: 23.9 }, { id: 4, lat: 55.5, lng: 24.5 }
  ];
  const g = groupSpots(pts);
  assert.deepEqual(g.map((x) => x.items.map((i) => i.id)), [[1, 2], [3], [4]]);
  assert.equal(colorFor(1), colorFor(9), 'spalvos kartojasi kas 8');
  assert.notEqual(colorFor(1), colorFor(2));
});
