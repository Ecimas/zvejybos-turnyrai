import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  seasonStats, speciesCollection, daypartStats, baitStats, weatherRanges, fishingDays, goalProgress, goalTitle,
  moonPhase, biteForecast, windDir, dayKey
} from '../../src/lib/insights.js';
import { parseForecast } from '../../src/lib/forecast.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).toISOString();
const fish = (id, species_id, length_mm, when, extra = {}) => ({ id, species_id, length_mm, captured_at_device: when, status: 'approved', ...extra });
const NOW = new Date(2026, 10, 2, 9); // 2026-11-02 09:00
const C = [
  fish('a', 1, 690, at(2026, 9, 12, 7), { bait: 'Vobleris', weather: { temp_c: 12, wind_ms: 3, pressure_hpa: 1012 } }),
  fish('b', 2, 350, at(2026, 11, 1, 6), { bait: 'twisteris', weather: { temp_c: 6, wind_ms: 2, pressure_hpa: 1009 } }),
  fish('c', 3, 540, at(2026, 10, 20, 18), { bait: 'Twisteris ', weather: { temp_c: 8, wind_ms: 4, pressure_hpa: 1015 } }),
  fish('d', 1, 520, at(2026, 10, 21, 8), { bait: 'Vobleris', weather: { temp_c: 9, wind_ms: 5, pressure_hpa: 1006 } }),
  fish('e', 4, 410, at(2025, 8, 3, 13)),
  fish('x', 1, 999, at(2026, 10, 22, 9), { status: 'rejected' })
];
const TRIPS = [{ id: 't1', trip_date: '2026-10-25', hours: 3 }, { id: 't2', trip_date: '2026-10-20' }];
const SPECIES = [{ id: 1, name_lt: 'Lydeka' }, { id: 2, name_lt: 'Ešerys' }, { id: 3, name_lt: 'Starkis' }, { id: 4, name_lt: 'Karšis' }, { id: 5, name_lt: 'Kuoja' }];
const name = (id) => SPECIES.find((s) => s.id === id)?.name_lt;

test('sezonas', () => {
  const s = seasonStats(C, TRIPS, NOW);
  assert.equal(s.count, 4, 'atmesti ir pernai – neskaičiuojami');
  assert.equal(s.days, 5, '4 dienos su laimikiais + 1 išvyka be (spal. 20 jau yra)');
  assert.equal(s.biggest.id, 'a');
});

test('kolekcija', () => {
  const k = speciesCollection(C, SPECIES);
  assert.equal(k.caught, 4);
  assert.equal(k.total, 5);
  assert.deepEqual(k.items.map((x) => [x.species.id, x.best?.length_mm ?? null]), [[1, 690], [3, 540], [4, 410], [2, 350], [5, null]]);
});

test('paros laikas, masalai, orai', () => {
  const d = daypartStats(C);
  assert.equal(d.top.key, 'morning');
  assert.equal(d.rows.find((r) => r.key === 'morning').count, 3);
  assert.equal(d.total, 5);
  const b = baitStats(C);
  assert.deepEqual(b.map((x) => [x.bait, x.count, x.avgMm]), [['Vobleris', 2, 605], ['Twisteris', 2, 445]]);
  const w = weatherRanges(C);
  assert.deepEqual(w.pressure, [1005, 1015]);
  assert.equal(w.windMax, 4);
  assert.deepEqual(w.temp, [6, 9]);
  assert.equal(weatherRanges(C.slice(0, 2)), null, 'per mažai duomenų');
});

test('žvejybos dienos ir serija', () => {
  const f = fishingDays(C, TRIPS, NOW, 12);
  assert.equal(f.cells.length, 84);
  const cell = (k) => f.cells.find((c) => c.date === k);
  assert.equal(cell('2026-11-01').kind, 'catch');
  assert.equal(cell('2026-10-25').kind, 'blank');
  assert.equal(cell('2026-10-20').kind, 'catch');
  assert.equal(cell('2026-11-03').kind, 'future');
  assert.equal(f.cells.at(-1).date, '2026-11-08', 'baigiasi šios savaitės sekmadieniu');
  assert.equal(f.streak, 2, 'spal. 20–21');
});

test('tikslai', () => {
  const g1 = { kind: 'length', species_id: 1, target: 80, period: 'season' };
  const p1 = goalProgress(g1, C, TRIPS, NOW, name);
  assert.equal(p1.done, false);
  assert.equal(p1.detail, 'Geriausia: 69 cm – trūksta 11 cm');
  assert.equal(Math.round(p1.pct * 100), 86);
  assert.equal(goalTitle(g1, name, NOW), 'Lydeka ≥ 80 cm šį sezoną');
  const g2 = { kind: 'count', target: 10, period: 'month' };
  assert.equal(goalProgress(g2, C, TRIPS, NOW).detail, '1 iš 10');
  assert.equal(goalTitle(g2, name, NOW), '10 laimikių per lapkritį');
  const g3 = { kind: 'species', target: 3, period: 'season' };
  const p3 = goalProgress(g3, C, TRIPS, NOW);
  assert.equal(p3.done, true);
  assert.equal(dayKey(p3.doneAt), '2026-11-01');
  assert.equal(goalTitle({ kind: 'species', target: 21, period: 'ever' }), '21 skirtinga rūšis');
  const g4 = { kind: 'days', target: 5, period: 'season' };
  assert.equal(goalProgress(g4, C, TRIPS, NOW).done, true);
  const g5 = { kind: 'new_species', target: 1, period: 'ever', created_at: at(2026, 10, 1) };
  const p5 = goalProgress(g5, C, TRIPS, NOW, name);
  assert.equal(p5.done, true, 'starkis ir ešerys – nauji po spal. 1');
  assert.equal(p5.detail, 'Nauja rūšis – Starkis');
  const g6 = { kind: 'new_species', target: 1, period: 'ever', created_at: at(2026, 11, 2) };
  assert.equal(goalProgress(g6, C, TRIPS, NOW).done, false);
});

test('mėnulis, vėjas', () => {
  assert.equal(moonPhase(new Date(Date.UTC(2026, 0, 3, 10))).name, 'pilnatis'); // 2026-01-03 pilnatis
  assert.equal(moonPhase(new Date(Date.UTC(2026, 0, 18, 19))).name, 'jaunatis');
  assert.equal(windDir(225), 'PV');
  assert.equal(windDir(0), 'Š');
});

test('kibimo prognozė', () => {
  const t0 = NOW.getTime();
  const hours = [-3, -2, -1, 0, 1, 2, 3].map((d) => ({ t: t0 + d * 3600e3, temp: 8, pressure: 1014 - d * 0.5, wind: 3, dir: 225, code: 3 }));
  const f = biteForecast({ hours, sunrise: new Date(2026, 10, 2, 7, 30).getTime(), sunset: new Date(2026, 10, 2, 16, 40).getTime() }, NOW,
    { key: 'morning' });
  assert.ok(f.score >= 7 && f.score <= 10, f.score);
  assert.equal(f.label === 'geras' || f.label === 'puikus', true);
  assert.deepEqual(f.windows, [[6, 9], [14, 16]]);
  assert.ok(f.reasons.includes('slėgis lėtai krenta'));
  const storm = biteForecast({ hours: hours.map((h) => ({ ...h, wind: 12, code: 95, pressure: 1014 + (h.t - t0) / 3600e3 * 2 })) }, NOW);
  assert.ok(storm.score <= 3, storm.score);
  assert.equal(biteForecast({ hours: [] }, NOW), null);
});

test('prognozės atsakymo skaitymas', () => {
  const s = Math.floor(NOW.getTime() / 1000);
  const p = parseForecast({ hourly: { time: [s, s + 3600], temperature_2m: [5, 6], surface_pressure: [1010, 1011], wind_speed_10m: [2, 3], wind_direction_10m: [90, 100], weather_code: [3, 61] },
    daily: { sunrise: [s - 3600], sunset: [s + 7 * 3600] } });
  assert.equal(p.hours.length, 2);
  assert.equal(p.hours[1].code, 61);
  assert.equal(parseForecast({ current: {} }), null);
});
