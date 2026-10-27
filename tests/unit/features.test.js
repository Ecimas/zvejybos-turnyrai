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
