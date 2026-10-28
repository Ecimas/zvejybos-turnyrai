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
