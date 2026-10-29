import test from 'node:test';
import assert from 'node:assert/strict';
import { sortSponsors, mainSponsor, unseenToday, fitBox, reportText, logoTile, sponsorLink, sponsorMini } from '../../src/lib/sponsors.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test('rėmėjai: generalinis pirmas, toliau – pagal tvarką', () => {
  const list = [{ id: 'b', sort: 1, tier: 'partner' }, { id: 'c', sort: 2, tier: 'main' }, { id: 'a', sort: 0, tier: 'partner' }];
  assert.deepEqual(sortSponsors(list).map((x) => x.id), ['c', 'a', 'b']);
  assert.equal(mainSponsor(list).id, 'c');
  assert.equal(mainSponsor([{ id: 'x', tier: 'partner' }]), null);
  assert.deepEqual(sortSponsors(null), []);
});

test('parodymai: vienas įrenginys – vienas kartas per dieną', () => {
  const store = mem();
  const d1 = new Date('2026-10-29T08:00:00Z');
  assert.deepEqual(unseenToday(['a', 'b', 'a'], store, d1), ['a', 'b']);
  assert.deepEqual(unseenToday(['a', 'c'], store, d1), ['c']);
  assert.deepEqual(unseenToday(['a', 'b', 'c'], store, new Date('2026-10-30T08:00:00Z')), ['a', 'b', 'c'], 'kitą dieną – iš naujo');
  assert.deepEqual(unseenToday(['a'], { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }, d1), ['a'], 'be saugyklos');
});

test('logotipas telpa į 480×240, nedidinamas', () => {
  assert.deepEqual(fitBox(1000, 1000), { w: 240, h: 240 });
  assert.deepEqual(fitBox(2000, 500), { w: 480, h: 120 });
  assert.deepEqual(fitBox(200, 100), { w: 200, h: 100 });
});

test('logotipo plytelė ir nuoroda saugios', () => {
  const s = { id: 's1', name: '<b>Parduotuvė</b>', url: 'javascript:alert(1)', logo_url: null };
  const tile = String(logoTile(s));
  assert.ok(tile.includes('&lt;b&gt;Parduotuvė'), tile);
  assert.ok(!String(sponsorLink(s, 'x')).includes('href'), 'javascript: nuoroda nerodoma');
  const ok = String(sponsorLink({ ...s, url: 'https://example.com' }, 'x'));
  assert.ok(ok.includes('rel="noopener noreferrer sponsored"') && ok.includes('data-sponsor-click="s1"'), ok);
  const img = String(logoTile({ name: 'A"B', logo_url: 'https://x.supabase.co/a.webp' }));
  assert.ok(img.includes('alt="A&quot;B"') && img.includes('<img'), img);
});

test('kortelės blokas: logotipai arba pavadinimai', () => {
  assert.equal(sponsorMini({ sponsors: [] }), '');
  const names = String(sponsorMini({ sponsors: [{ id: 'a', name: 'A', sort: 0 }, { id: 'b', name: 'B', sort: 1 }, { id: 'c', name: 'C', sort: 2 }] }));
  assert.ok(names.includes('Remia: A, B ir kt.'), names);
  const logos = String(sponsorMini({ sponsors: [1, 2, 3, 4].map((i) => ({ id: `s${i}`, name: `S${i}`, sort: i, logo_url: `https://x/${i}.webp` })) }));
  assert.equal((logos.match(/<img/g) || []).length, 3);
  assert.ok(logos.includes('+1'), logos);
});

test('ataskaita rėmėjui', () => {
  const text = reportText({
    tournament: { title: 'Rudens taurė', starts_at: 'A', ends_at: 'B' },
    report: { participants: 30, catches: 1234, sponsors: [{ id: 's1', views: 1500, clicks: 42, views_7d: 300, clicks_7d: 7 }] },
    sponsor: { id: 's1', name: 'Ežeras', tier: 'main', logo_url: 'x' },
    url: 'https://z/#/t/1'
  });
  assert.match(text, /Rėmėjo ataskaita: Ežeras/);
  assert.match(text, /Generalinis rėmėjas · logotipas rodomas/);
  assert.match(text, /Dalyvių: 30/);
  assert.match(text, /Logotipo parodymai: 1\s500 \(per 7 d\.: 300\)/);
  assert.match(text, /Paspaudimai į svetainę: 42/);
  assert.match(text, /Turnyras: https:\/\/z\/#\/t\/1/);
  const none = reportText({ tournament: { title: 'T' }, report: null, sponsor: { id: 'x', name: 'X' } });
  assert.match(none, /Logotipo parodymai: 0/);
});
