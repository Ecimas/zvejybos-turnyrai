import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceInfo, modelName } from '../../src/lib/presence.js';

const win = (standalone = false) => ({ matchMedia: () => ({ matches: standalone }) });
const doc = { referrer: '' };

test('Android Chrome: modelis iš Client Hints (UA sumažintas iki „K“)', async () => {
  const nav = {
    userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
    userAgentData: { platform: 'Android', getHighEntropyValues: async () => ({ model: 'SM-S918B', platformVersion: '14.0.0' }) }
  };
  assert.deepEqual(await deviceInfo(nav, win(true), doc), { model: 'SM-S918B', platform: 'Android', os: '14.0', browser: 'Chrome', installed: true });
});

test('Samsung Internet ir senas UA su modeliu', async () => {
  const nav = { userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A536B Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36' };
  const d = await deviceInfo(nav, win(), doc);
  assert.equal(d.model, 'SM-A536B');
  assert.equal(d.browser, 'Samsung Internet');
  assert.equal(d.os, '13');
});

test('iPhone Safari ir Chrome iOS; įdiegta pradžios ekrane', async () => {
  const safari = await deviceInfo({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1', standalone: true }, win(), doc);
  assert.deepEqual(safari, { model: 'iPhone', platform: 'iOS', os: '17.5', browser: 'Safari', installed: true });
  const crios = await deviceInfo({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1' }, win(), doc);
  assert.equal(crios.browser, 'Chrome');
  const ipad = await deviceInfo({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', maxTouchPoints: 5 }, win(), doc);
  assert.equal(ipad.model, 'iPad');
});

test('Google Play programėlė (TWA) ir kompiuteris', async () => {
  const twa = await deviceInfo({ userAgent: 'Mozilla/5.0 (Linux; Android 14; K) Chrome/129.0 Mobile Safari/537.36' }, win(), { referrer: 'android-app://lt.zvejybosturnyrai.app/' });
  assert.equal(twa.installed, true);
  assert.equal(twa.model, 'Android (modelis nežinomas)');
  const pc = await deviceInfo({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0' }, win(), doc);
  assert.deepEqual([pc.platform, pc.model, pc.browser], ['Windows', 'Kompiuteris', 'Edge']);
});

test('Samsung kodų pavadinimai', () => {
  assert.equal(modelName('SM-S918B'), 'Galaxy S23 Ultra (SM-S918B)');
  assert.equal(modelName('SM-A536B'), 'Galaxy A53 (SM-A536B)');
  assert.equal(modelName('Pixel 8'), 'Pixel 8');
  assert.equal(modelName(''), 'Nežinomas');
});
