import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncClock, trustedNow, clockOffsetS, resetClock, clockWarnings } from '../../src/lib/clock.js';

const fmt = (d) => d.toISOString().slice(11, 16);

test('laikrodis: serverio laikas susiejamas su monotoniniu laikmačiu', async () => {
  resetClock();
  let perf = 1000;
  const now = () => perf;
  const server = Date.parse('2026-10-28T10:00:00Z');
  const backend = { serverNow: async () => { perf += 200; return new Date(server).toISOString(); } };
  assert.equal(trustedNow(now), null);
  assert.equal(await syncClock(backend, now), true);
  // atsakymas užtruko 200 ms -> serverio laikas laikomas viduriu (+100 ms)
  assert.equal(trustedNow(now), server + 100);
  perf += 60_000;
  assert.equal(trustedNow(now), server + 100 + 60_000);
  // telefonas rodo 3 val. anksčiau (laikrodis pasuktas atgal)
  const device = server + 60_100 - 3 * 3600e3;
  assert.equal(clockOffsetS(device, now), 10800);
  // po 20 min. be naujo susiejimo – nebepatikima
  perf += 20 * 60e3;
  assert.equal(trustedNow(now), null);
  assert.equal(clockOffsetS(device, now), null);
});

test('laikrodis: klaida ar lėtas atsakymas – susiejimo nėra', async () => {
  resetClock();
  let perf = 0;
  const now = () => perf;
  assert.equal(await syncClock({ serverNow: async () => { throw new Error('offline'); } }, now), false);
  assert.equal(await syncClock({ serverNow: async () => { perf += 6000; return new Date().toISOString(); } }, now), false);
  assert.equal(await syncClock({ serverNow: async () => 'ne data' }, now), false);
  assert.equal(await syncClock(null, now), false);
  assert.equal(trustedNow(now), null);
});

test('moderatoriaus įspėjimai apie laiką', () => {
  const base = { captured_at_device: '2026-10-28T08:00:00Z', received_at: '2026-10-28T08:01:00Z' };
  assert.deepEqual(clockWarnings({ ...base, clock_offset_s: 30 }, fmt), []);
  assert.deepEqual(clockWarnings({ ...base, clock_offset_s: null }, fmt), []);
  const back = clockWarnings({ ...base, clock_offset_s: 3 * 3600 }, fmt);
  assert.equal(back.length, 1);
  assert.match(back[0], /atsiliko 3 val\..*11:00/);
  assert.match(clockWarnings({ ...base, clock_offset_s: -600 }, fmt)[0], /skubėjo 10 min\./);
  const late = clockWarnings({ captured_at_device: '2026-10-28T08:00:00Z', received_at: '2026-10-28T13:00:00Z', clock_offset_s: null }, fmt);
  assert.match(late[0], /Išsiųsta tik po 5 val\..*nepatikrintas/);
  // vėlai išsiųsta, bet laikas patikrintas ir teisingas – įspėjimo nėra
  assert.deepEqual(clockWarnings({ captured_at_device: '2026-10-28T08:00:00Z', received_at: '2026-10-28T13:00:00Z', clock_offset_s: 5 }, fmt), []);
});

import { catchTime, fitReason } from '../../src/lib/scoring.js';

test('tikras laikas: laikrodis atsuktas atgal prieš pabaigą – laimikis po pabaigos neįskaitomas', () => {
  const t = { min_length_mm: 0, starts_at: '2026-11-12T06:00:00Z', ends_at: '2026-11-12T10:00:00Z' }; // 12:00 Vilniaus laiku
  // 11:59 telefonas atsuktas į 10:00; žuvis pagauta 12:30 tikru laiku (telefonas rodo 10:31)
  const c = { species_id: 1, length_mm: 600, captured_at_device: '2026-11-12T08:31:00Z', received_at: '2026-11-12T10:31:00Z', status: 'approved' };
  assert.equal(fitReason(t, [], true, { ...c, clock_offset_s: 7140 }), 'after', 'patikrinta fotografuojant');
  assert.equal(fitReason(t, [], true, { ...c, clock_offset_s: null, send_offset_s: 7140 }), 'after', 'patikrinta siunčiant');
  // be jokios patikros (nuotrauka ir siuntimas be ryšio, laikrodis atstatytas) – įskaitoma, bet moderatorius mato įspėjimą
  assert.equal(fitReason(t, [], true, { ...c, received_at: '2026-11-12T10:35:00Z' }), 'ok');
  // smulkūs skirtumai (iki 60 s) neperkelia laiko per pabaigos ribą
  assert.equal(fitReason(t, [], true, { ...c, captured_at_device: '2026-11-12T09:59:40Z', received_at: '2026-11-12T10:00:10Z', send_offset_s: 30 }), 'ok');
  assert.equal(catchTime({ captured_at_device: '2026-11-12T08:00:00Z', clock_offset_s: 59 }), Date.parse('2026-11-12T08:00:00Z'));
  assert.equal(catchTime({ captured_at_device: '2026-11-12T08:00:00Z', clock_offset_s: -600, send_offset_s: 7000 }), Date.parse('2026-11-12T07:50:00Z'));
  // telefono laikas skuba, bet skirtumas žinomas – nebelaikoma „iš ateities“
  assert.equal(fitReason(t, [], true, { ...c, captured_at_device: '2026-11-12T09:30:00Z', received_at: '2026-11-12T08:30:00Z', clock_offset_s: -3600 }), 'ok');
});
