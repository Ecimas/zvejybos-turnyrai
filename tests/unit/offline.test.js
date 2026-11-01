import test from 'node:test';
import assert from 'node:assert/strict';
import { withOffline, isNetworkError, cachedAt, OFFLINE_TEXT } from '../../src/lib/offline.js';

function memStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _m: m
  };
}
const netErr = () => Object.assign(new Error('TypeError: Failed to fetch'), {});
function setOnline(v) { Object.defineProperty(globalThis, 'navigator', { value: { onLine: v }, configurable: true }); }

function fakeBackend() {
  let fail = false;
  let calls = 0;
  return {
    setFail(v) { fail = v; },
    get calls() { return calls; },
    getUser: () => ({ id: 'u1' }),
    async tournaments() { calls++; if (fail) throw netErr(); return [{ id: 't1', title: 'Taurė' }]; },
    async leaderboard(id) { calls++; if (fail) throw netErr(); return [{ user_id: 'u1', rank: 1, id }]; },
    async join() { if (fail) throw netErr(); return 'ok'; },
    async signOut() { return true; }
  };
}

test('ryšio klaidų atpažinimas', () => {
  assert.ok(isNetworkError(new TypeError('x')));
  assert.ok(isNetworkError(new Error('TypeError: Failed to fetch')));
  assert.ok(isNetworkError({ message: 'NetworkError when attempting to fetch resource.' }));
  assert.ok(!isNetworkError(new Error('not allowed')));
  assert.ok(!isNetworkError(null));
});

test('be ryšio rodomi paskutiniai matyti duomenys su laiku', async () => {
  setOnline(true);
  const storage = memStorage();
  let t = 1000;
  const b = withOffline(fakeBackend(), { storage, now: () => t });
  assert.equal((await b.tournaments())[0].title, 'Taurė');
  assert.equal(cachedAt(await b.tournaments()), null, 'iš tinklo – be žymos');
  assert.equal(b.offline.staleAt, null);
  b.setFail(true);
  t = 5000;
  const cached = await b.tournaments();
  assert.equal(cached[0].title, 'Taurė');
  assert.ok(cachedAt(cached) > 0, 'iš atminties – su laiku');
  assert.ok(b.offline.staleAt !== null);
  // Argumentai – atskiri įrašai: kito turnyro lentelės atmintyje nėra
  await assert.rejects(() => b.leaderboard('t9'), (e) => e.message === OFFLINE_TEXT);
  b.offline.reset();
  assert.equal(b.offline.staleAt, null);
});

test('be ryšio (navigator.onLine=false) tinklas nebandomas', async () => {
  setOnline(true);
  const fb = fakeBackend();
  const b = withOffline(fb, { storage: memStorage() });
  await b.leaderboard('t1');
  const before = fb.calls;
  setOnline(false);
  const rows = await b.leaderboard('t1');
  assert.equal(rows[0].rank, 1);
  assert.equal(fb.calls, before, 'tinklas neturėjo būti kviečiamas');
  await assert.rejects(() => b.join('t1'), (e) => e.offline && e.message === OFFLINE_TEXT);
  setOnline(true);
});

test('rašymas dingus ryšiui – aiški žinutė; kitos klaidos nekeičiamos', async () => {
  setOnline(true);
  const fb = fakeBackend();
  const b = withOffline(fb, { storage: memStorage() });
  assert.equal(await b.join('t1'), 'ok');
  fb.setFail(true);
  await assert.rejects(() => b.join('t1'), (e) => e.message === OFFLINE_TEXT);
});

test('silpnas ryšys: per ilgai laukiant rodoma atmintis', async () => {
  setOnline(true);
  const fb = fakeBackend();
  const b = withOffline(fb, { storage: memStorage(), slowMs: 20 });
  await b.tournaments();
  fb.tournaments = undefined;
  const slow = withOffline({ getUser: () => ({ id: 'u1' }), tournaments: () => new Promise((r) => setTimeout(() => r([{ id: 'new' }]), 200)) },
    { storage: memStorage(), slowMs: 20 });
  // be atminties – laukiam tinklo
  assert.equal((await slow.tournaments())[0].id, 'new');
  // su atmintimi – po 20 ms grąžinama atmintis
  const out = await slow.tournaments();
  assert.equal(out[0].id, 'new');
  assert.ok(cachedAt(out));
});

test('atsijungus išsaugoti duomenys ištrinami', async () => {
  setOnline(true);
  const storage = memStorage();
  const b = withOffline(fakeBackend(), { storage });
  await b.tournaments();
  assert.ok([...storage._m.keys()].some((k) => k.startsWith('zt-cache:u1:')));
  await b.signOut();
  assert.equal([...storage._m.keys()].filter((k) => k.startsWith('zt-cache:')).length, 0);
});
