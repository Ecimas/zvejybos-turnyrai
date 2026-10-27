// Demonstracinis režimas: visi duomenys tik šiame telefone (localStorage + IndexedDB).
// Leidžia išbandyti programėlę dar prieš prijungiant Supabase.
import { SPECIES, speciesId } from './species.js';
import { computeLeaderboard } from '../lib/scoring.js';
import { PermanentError, idbStore, memoryStore } from '../lib/outbox.js';

const KEY = 'zt-demo-v1';
const ME = '00000000-0000-4000-8000-000000000001';
const H = 3600e3;
const D = 24 * H;

function seed() {
  const now = Date.now();
  const iso = (off) => new Date(now + off).toISOString();
  const people = [
    ['Ąžuolas_K', 'Kauno r.'], ['Lydekininkas', 'Utenos r.'], ['MariųVilkas', 'Kaišiadorių r.'],
    ['Rūta_Ž', 'Molėtų r.'], ['Spiningas88', 'Vilniaus r.'], ['Nemuno_Jonas', 'Kauno r.'],
    ['Tomas_Ž', 'Alytaus r.'], ['Žvejė_Ieva', 'Zarasų r.'], ['Ešerys_LT', 'Šiaulių r.']
  ];
  const profiles = {
    [ME]: { id: ME, nickname: 'zvejys_demo', region: 'Kaunas', is_admin: true, trust_score: 50, created_at: iso(-120 * D) }
  };
  const ids = people.map(([nickname, region], i) => {
    const id = `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
    profiles[id] = { id, nickname, region, is_admin: false, trust_score: 60, created_at: iso(-200 * D) };
    return id;
  });

  const T = (id, o) => ({
    id, organizer_id: ids[0], description: null, visibility: 'public', fee_cents: 0,
    created_at: iso(-30 * D), top_n: 3, min_length_mm: 0, ...o
  });
  const tournaments = [
    T('t-taure', { title: 'Rudens lydekų taurė', format: 'top_n_sum', top_n: 3, min_length_mm: 500,
      starts_at: iso(-4 * D), ends_at: iso(2 * D + 14 * H),
      description: 'Trys ilgiausios lydekos sumuojamos. Nuotrauka su matavimo liniuote, matomas visas žuvies ilgis.' }),
    T('t-sezonas', { title: 'Sezono iššūkis', format: 'biggest', starts_at: iso(-60 * D), ends_at: iso(39 * D),
      description: 'Didžiausia bet kurios rūšies žuvis per sezoną.' }),
    T('t-eseriai', { title: 'Ešerių savaitgalis', format: 'biggest', min_length_mm: 200,
      starts_at: iso(30 * H), ends_at: iso(30 * H + 2 * D) }),
    T('t-plesrunai', { title: 'Rugsėjo plėšrūnai', format: 'top_n_sum', top_n: 3, min_length_mm: 400,
      starts_at: iso(-40 * D), ends_at: iso(-22 * D) })
  ];
  const tournament_species = [
    ['t-taure', speciesId('lydeka')], ['t-eseriai', speciesId('eserys')],
    ['t-plesrunai', speciesId('lydeka')], ['t-plesrunai', speciesId('starkis')]
  ].map(([tournament_id, species_id]) => ({ tournament_id, species_id }));

  const entries = [];
  const enter = (t, users) => users.forEach((u) => entries.push({ tournament_id: t, user_id: u, joined_at: iso(-5 * D) }));
  enter('t-taure', ids);
  enter('t-sezonas', ids.slice(0, 7));
  enter('t-eseriai', ids.slice(2, 6));
  enter('t-plesrunai', [...ids, ME]);

  const catches = [];
  let n = 0;
  const add = (user, code, len, off) => {
    n++;
    catches.push({
      id: `demo-c${n}`, client_id: `demo-c${n}`, user_id: user, species_id: speciesId(code), length_mm: len,
      captured_at_device: iso(off), received_at: iso(off + 60e3), photo_path: null,
      photo_sha256: `demo${n}`, status: 'approved', reject_reason: null, created_at: iso(off)
    });
  };
  const pike = [
    [920, 880, 880], [870, 850, 830], [860, 810, 800], [820, 790, 750], [790, 760, 740],
    [760, 730, 680], [740, 700, 650], [710, 680, 590], [700, 640, 570]
  ];
  pike.forEach((lens, i) => lens.forEach((len, j) => add(ids[i], 'lydeka', len, -(3.9 * D) + (i * 5 + j * 13) * H)));
  add(ids[0], 'samas', 1420, -20 * D);
  add(ids[3], 'karpis', 890, -12 * D);
  add(ids[1], 'starkis', 760, -30 * D);
  add(ids[4], 'lydeka', 810, -33 * D);
  add(ids[2], 'lydeka', 780, -35 * D);
  add(ME, 'lydeka', 690, -36 * D);
  add(ME, 'starkis', 540, -31 * D);
  add(ME, 'eserys', 340, -50 * D);
  add(ME, 'karsis', 520, -70 * D);

  return { profiles, tournaments, tournament_species, entries, catches, locations: {} };
}

export function createDemoBackend({ photos } = {}) {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) { db = seed(); }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* pilna atmintis */ } };
  save();
  const photoStore = photos || (typeof indexedDB !== 'undefined' ? idbStore('zvejybos-turnyrai-demo', 'photos') : memoryStore());
  const urls = new Map();
  const listeners = new Set();
  const user = { id: ME, email: 'demo@zvejybosturnyrai.lt' };

  const decorate = (t) => ({
    ...t,
    species_ids: db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => x.species_id),
    participants: db.entries.filter((e) => e.tournament_id === t.id).length,
    joined: db.entries.some((e) => e.tournament_id === t.id && e.user_id === ME)
  });

  return {
    mode: 'demo',
    async init() {},
    getUser: () => user,
    onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signIn() {},
    async verifyCode() {},
    async signOut() {
      localStorage.removeItem(KEY);
      db = seed();
      save();
    },

    async myProfile() { return { ...db.profiles[ME] }; },
    async updateProfile({ nickname, region }) {
      const taken = Object.values(db.profiles).some((p) => p.id !== ME && p.nickname.toLowerCase() === nickname.toLowerCase());
      if (taken) throw new Error('Toks slapyvardis jau užimtas');
      Object.assign(db.profiles[ME], { nickname, region: region || null });
      save();
    },

    async species() { return SPECIES; },
    async tournaments() { return db.tournaments.map(decorate); },
    async tournament(id) {
      const t = db.tournaments.find((x) => x.id === id);
      return t ? decorate(t) : null;
    },
    async createTournament(data) {
      const id = `t-${Date.now().toString(36)}`;
      const { species_ids, ...rest } = data;
      db.tournaments.push({ id, organizer_id: ME, visibility: 'public', fee_cents: 0, created_at: new Date().toISOString(), ...rest });
      species_ids.forEach((species_id) => db.tournament_species.push({ tournament_id: id, species_id }));
      db.entries.push({ tournament_id: id, user_id: ME, joined_at: new Date().toISOString() });
      save();
      return id;
    },
    async join(id) {
      if (!db.entries.some((e) => e.tournament_id === id && e.user_id === ME)) {
        db.entries.push({ tournament_id: id, user_id: ME, joined_at: new Date().toISOString() });
        save();
      }
    },
    async leave(id) {
      db.entries = db.entries.filter((e) => !(e.tournament_id === id && e.user_id === ME));
      save();
    },
    async participants(id) {
      return db.entries.filter((e) => e.tournament_id === id).map((e) => db.profiles[e.user_id]).filter(Boolean);
    },
    async leaderboard(id) {
      const t = db.tournaments.find((x) => x.id === id);
      if (!t) return [];
      return computeLeaderboard({
        tournament: t,
        speciesIds: db.tournament_species.filter((x) => x.tournament_id === id).map((x) => x.species_id),
        entries: db.entries.filter((e) => e.tournament_id === id).map((e) => e.user_id),
        catches: db.catches,
        profiles: db.profiles
      });
    },

    async myCatches() {
      return db.catches.filter((c) => c.user_id === ME)
        .sort((a, b) => b.captured_at_device.localeCompare(a.captured_at_device));
    },
    async userCatches(userId) {
      return db.catches.filter((c) => c.user_id === userId && (c.status === 'approved' || userId === ME));
    },
    async photoUrl(path) {
      if (!path) return null;
      if (urls.has(path)) return urls.get(path);
      const rec = await photoStore.get(path);
      if (!rec?.blob) return null;
      const url = URL.createObjectURL(rec.blob);
      urls.set(path, url);
      return url;
    },
    async submitCatch(item) {
      const existing = db.catches.find((c) => c.user_id === ME && c.client_id === item.clientId);
      if (existing) return existing;
      if (db.catches.some((c) => c.photo_sha256 === item.sha256)) {
        throw new PermanentError('Ši nuotrauka jau buvo įkelta', 'duplicate_photo');
      }
      const path = `${ME}/${item.clientId}.jpg`;
      await photoStore.put({ clientId: path, blob: item.photo });
      const row = {
        id: item.clientId, client_id: item.clientId, user_id: ME, species_id: item.speciesId,
        length_mm: item.lengthMm, captured_at_device: item.capturedAt, received_at: new Date().toISOString(),
        photo_path: path, photo_sha256: item.sha256, status: 'pending', reject_reason: null,
        created_at: new Date().toISOString()
      };
      db.catches.push(row);
      if (item.location) db.locations[row.id] = item.location;
      save();
      return row;
    },

    async pending() {
      return db.catches.filter((c) => c.status === 'pending').map((c) => ({
        ...c,
        nickname: db.profiles[c.user_id]?.nickname ?? '',
        trust_score: db.profiles[c.user_id]?.trust_score ?? 50,
        location: db.locations[c.id] || null
      }));
    },
    async review(id, approve, reason) {
      const c = db.catches.find((x) => x.id === id);
      if (!c) throw new Error('Laimikis nerastas');
      if (!approve && !String(reason || '').trim()) throw new Error('Nurodyk atmetimo priežastį');
      c.status = approve ? 'approved' : 'rejected';
      c.reject_reason = approve ? null : String(reason).trim();
      c.reviewed_at = new Date().toISOString();
      save();
    },

    async profile(userId) {
      const p = db.profiles[userId];
      return p ? { id: p.id, nickname: p.nickname, region: p.region, created_at: p.created_at } : null;
    },
    async userTournamentCount(userId) {
      return db.entries.filter((e) => e.user_id === userId).length;
    }
  };
}
