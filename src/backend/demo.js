// Demonstracinis režimas: visi duomenys tik šiame telefone (localStorage + IndexedDB).
// Leidžia išbandyti programėlę dar prieš prijungiant Supabase.
import { SPECIES, speciesId } from './species.js';
import { computeLeaderboard } from '../lib/scoring.js';
import { PermanentError, RetryLaterError, idbStore, memoryStore } from '../lib/outbox.js';
import { phase, registrationOpen } from '../lib/format.js';
import { banActive } from '../lib/bans.js';
import { rolesOf, ASSIGNABLE } from '../lib/roles.js';

const KEY = 'zt-demo-v1';
const ME = '00000000-0000-4000-8000-000000000001';
const H = 3600e3;
const D = 24 * H;
const code10 = () => Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');

function seed() {
  const now = Date.now();
  const iso = (off) => new Date(now + off).toISOString();
  const people = [
    ['Ąžuolas_K', 'Kauno r.'], ['Lydekininkas', 'Utenos r.'], ['MariųVilkas', 'Kaišiadorių r.'],
    ['Rūta_Ž', 'Molėtų r.'], ['Spiningas88', 'Vilniaus r.'], ['Nemuno_Jonas', 'Kauno r.'],
    ['Tomas_Ž', 'Alytaus r.'], ['Žvejė_Ieva', 'Zarasų r.'], ['Ešerys_LT', 'Šiaulių r.']
  ];
  const profiles = {
    [ME]: { id: ME, nickname: 'zvejys_demo', region: 'Kaunas', is_admin: true, roles: ['owner'], trust_score: 50, created_at: iso(-120 * D) }
  };
  const ids = people.map(([nickname, region], i) => {
    const id = `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`;
    profiles[id] = { id, nickname, region, is_admin: false, roles: [], trust_score: 60, created_at: iso(-200 * D) };
    return id;
  });

  const T = (id, o) => ({
    id, organizer_id: ids[0], description: null, visibility: 'public', fee_cents: 0,
    created_at: iso(-30 * D), top_n: 3, min_length_mm: 0, prizes: null, sponsor_name: null, sponsor_url: null,
    leaderboard_hidden: false, invite_code: code10(), ...o
  });
  const tournaments = [
    T('t-taure', { title: 'Rudens lydekų taurė', format: 'top_n_sum', top_n: 3, min_length_mm: 500,
      starts_at: iso(-4 * D), ends_at: iso(2 * D + 14 * H),
      description: 'Trys ilgiausios lydekos sumuojamos. Nuotrauka su matavimo liniuote, matomas visas žuvies ilgis.',
      prizes: 'Rėmėjų dovanos: spiningas, ritė, masalų rinkinys', prize_fund_cents: 50000, prize_split: [50, 30, 20] }),
    T('t-sezonas', { title: 'Sezono iššūkis', format: 'biggest', starts_at: iso(-60 * D), ends_at: iso(39 * D),
      description: 'Didžiausia bet kurios rūšies žuvis per sezoną.' }),
    T('t-eseriai', { title: 'Ešerių savaitgalis', format: 'biggest', min_length_mm: 200, late_join_minutes: 0,
      starts_at: iso(30 * H), ends_at: iso(30 * H + 2 * D) }),
    T('t-plesrunai', { title: 'Rugsėjo plėšrūnai', format: 'top_n_sum', top_n: 3, min_length_mm: 400,
      starts_at: iso(-40 * D), ends_at: iso(-22 * D), prize_fund_cents: 10000, prize_split: [60, 40] }),
    T('t-slaptas', { title: 'Draugų iššūkis', format: 'biggest', organizer_id: ME, visibility: 'private',
      leaderboard_hidden: true, starts_at: iso(-2 * D), ends_at: iso(5 * D),
      description: 'Privatus turnyras tik su kvietimu. Lentelė paslėpta iki pabaigos.' })
  ];
  const tournament_species = [
    ['t-taure', speciesId('lydeka')], ['t-eseriai', speciesId('eserys')],
    ['t-plesrunai', speciesId('lydeka')], ['t-plesrunai', speciesId('starkis')]
  ].map(([tournament_id, species_id]) => ({ tournament_id, species_id }));

  const entries = [];
  // Demo dalyviai užsiregistravo dieną prieš startą – visi jų laimikiai įskaitomi.
  const enter = (t, users) => {
    const joined = new Date(new Date(tournaments.find((x) => x.id === t).starts_at).getTime() - D).toISOString();
    users.forEach((u) => entries.push({ tournament_id: t, user_id: u, joined_at: joined }));
  };
  enter('t-taure', ids);
  enter('t-sezonas', ids.slice(0, 7));
  enter('t-eseriai', ids.slice(2, 6));
  enter('t-plesrunai', [...ids, ME]);
  enter('t-slaptas', [ME, ids[2], ids[5]]);

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

  const tournament_sponsors = [
    { id: 's1', tournament_id: 't-taure', name: 'Ežero žvejybos parduotuvė', url: 'https://example.com', amount_cents: 30000, sort: 0 },
    { id: 's2', tournament_id: 't-taure', name: 'Kauno žvejų klubas', url: null, amount_cents: 20000, sort: 1 },
    { id: 's3', tournament_id: 't-plesrunai', name: 'Plėšrūnų bendrija', url: null, amount_cents: 10000, sort: 0 }
  ];
  const announcements = [
    { id: 'a1', tournament_id: 't-taure', author_id: ids[0], created_at: iso(-2 * H),
      message: 'Primename: ilgis matuojamas nuo snukio iki uodegos galo, liniuotė turi matytis visa. Sėkmės!' }
  ];
  const reports = [
    { id: 'r1', catch_id: 'demo-c28', reporter_id: ids[1], reason: 'old_photo', message: 'Šią nuotrauką mačiau Facebook grupėje pernai',
      status: 'open', created_at: iso(-3 * H) }
  ];
  return { profiles, tournaments, tournament_species, tournament_sponsors, entries, catches, locations: {}, disputes: [],
    announcements, reports, blank_trips: [], bans: [] };
}

export function createDemoBackend({ photos } = {}) {
  let db;
  try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db) { db = seed(); }
  db.disputes ||= [];
  db.tournament_sponsors ||= [];
  db.reports ||= [];
  db.blank_trips ||= [];
  db.announcements ||= [];
  db.bans ||= [];
  db.checks ||= [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* pilna atmintis */ } };
  save();
  const photoStore = photos || (typeof indexedDB !== 'undefined' ? idbStore('zvejybos-turnyrai-demo', 'photos') : memoryStore());
  const urls = new Map();
  const listeners = new Set();
  const user = { id: ME, email: 'demo@zvejybosturnyrai.lt' };

  const visible = (t) => t.visibility === 'public' || t.organizer_id === ME
    || db.entries.some((e) => e.tournament_id === t.id && e.user_id === ME);
  const isOrganizerBeforeStart = (t) => t && t.organizer_id === ME && Date.now() < new Date(t.starts_at).getTime();
  const decorate = (t) => ({
    ...t,
    species_ids: db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => x.species_id),
    sponsors: db.tournament_sponsors.filter((x) => x.tournament_id === t.id).sort((a, b) => a.sort - b.sort),
    last_announcement_at: db.announcements.filter((a) => a.tournament_id === t.id)
      .reduce((m, a) => (!m || a.created_at > m ? a.created_at : m), null),
    participants: db.entries.filter((e) => e.tournament_id === t.id).length,
    joined: db.entries.some((e) => e.tournament_id === t.id && e.user_id === ME),
    joined_at: db.entries.find((e) => e.tournament_id === t.id && e.user_id === ME)?.joined_at ?? null
  });

  return {
    mode: 'demo',
    async init() {},
    getUser: () => user,
    onAuth(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    async signIn() {},
    async authProviders() { return { google: false }; },
    async signInWithGoogle() {},
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
    async tournaments() { return db.tournaments.filter(visible).map(decorate); },
    async tournament(id) {
      const t = db.tournaments.find((x) => x.id === id);
      return t && visible(t) ? decorate(t) : null;
    },
    async createTournament(data) {
      const id = `t-${Date.now().toString(36)}`;
      const { species_ids, sponsors = [], ...rest } = data;
      const recent = db.tournaments.filter((t) => t.organizer_id === ME && Date.now() - new Date(t.created_at) < D).length;
      if (recent >= 10) throw new Error('Per parą galima sukurti ne daugiau kaip 10 turnyrų');
      db.tournaments.push({ id, organizer_id: ME, visibility: 'public', fee_cents: 0, leaderboard_hidden: false,
        invite_code: code10(), created_at: new Date().toISOString(), ...rest });
      species_ids.forEach((species_id) => db.tournament_species.push({ tournament_id: id, species_id }));
      sponsors.forEach((s, i) => db.tournament_sponsors.push({ ...s, id: `s-${id}-${i}`, tournament_id: id, sort: i }));
      db.entries.push({ tournament_id: id, user_id: ME, joined_at: new Date().toISOString() });
      save();
      return id;
    },
    async updateTournament(id, data) {
      const t = db.tournaments.find((x) => x.id === id);
      if (!isOrganizerBeforeStart(t)) throw new Error('Turnyras jau prasidėjo – keisti nebegalima');
      const { species_ids, sponsors, ...rest } = data;
      Object.assign(t, rest);
      if (sponsors) {
        db.tournament_sponsors = db.tournament_sponsors.filter((x) => x.tournament_id !== id)
          .concat(sponsors.map((s, i) => ({ ...s, id: `s-${id}-${i}`, tournament_id: id, sort: i })));
      }
      if (species_ids) {
        db.tournament_species = db.tournament_species.filter((x) => x.tournament_id !== id)
          .concat(species_ids.map((species_id) => ({ tournament_id: id, species_id })));
      }
      save();
    },
    async deleteTournament(id) {
      const t = db.tournaments.find((x) => x.id === id);
      if (!isOrganizerBeforeStart(t)) throw new Error('Prasidėjusio turnyro ištrinti negalima');
      db.tournaments = db.tournaments.filter((x) => x.id !== id);
      db.tournament_species = db.tournament_species.filter((x) => x.tournament_id !== id);
      db.tournament_sponsors = db.tournament_sponsors.filter((x) => x.tournament_id !== id);
      db.entries = db.entries.filter((x) => x.tournament_id !== id);
      save();
    },
    async getInvite(code) {
      const t = db.tournaments.find((x) => x.invite_code === String(code).trim().toLowerCase() && registrationOpen(x));
      if (!t) return null;
      const { id, title, format, top_n, min_length_mm, starts_at, ends_at } = t;
      return { id, title, format, top_n, min_length_mm, starts_at, ends_at, participants: db.entries.filter((e) => e.tournament_id === id).length };
    },
    async joinWithInvite(code) {
      const t = await this.getInvite(code);
      if (!t) throw new Error('Kvietimas negalioja arba turnyras jau baigėsi');
      if (!db.entries.some((e) => e.tournament_id === t.id && e.user_id === ME)) {
        db.entries.push({ tournament_id: t.id, user_id: ME, joined_at: new Date().toISOString() });
        save();
      }
      return t.id;
    },
    async join(id) {
      const t = db.tournaments.find((x) => x.id === id);
      if (!t || (t.organizer_id !== ME && !registrationOpen(t))) throw new Error('Registracija jau baigėsi');
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
      const rows = computeLeaderboard({
        tournament: t,
        speciesIds: db.tournament_species.filter((x) => x.tournament_id === id).map((x) => x.species_id),
        entries: db.entries.filter((e) => e.tournament_id === id && !banActive(db.bans.find((b) => b.user_id === e.user_id))),
        catches: db.catches,
        profiles: db.profiles
      });
      // Kaip serveryje: paslėpta lentelė vykstant turnyrui – tik savo eilutė be vietos
      // (organizatorius ir moderatoriai mato viską).
      const hidden = t.leaderboard_hidden && phase(t) !== 'done' && t.organizer_id !== ME && !db.profiles[ME]?.is_admin;
      return hidden ? rows.filter((r) => r.user_id === ME).map((r) => ({ ...r, rank: null })) : rows;
    },

    async myCatches() {
      return db.catches.filter((c) => c.user_id === ME)
        .sort((a, b) => b.captured_at_device.localeCompare(a.captured_at_device));
    },
    async userCatches(userId) {
      return db.catches.filter((c) => c.user_id === userId && (c.status === 'approved' || userId === ME));
    },
    async catchDetail(id) {
      const c = db.catches.find((x) => x.id === id);
      if (!c || (c.status !== 'approved' && c.user_id !== ME && !db.profiles[ME]?.is_admin)) return null;
      const p = db.profiles[c.user_id];
      const own = c.user_id === ME;
      return { ...c, bait: own ? c.bait ?? null : undefined, notes: own ? c.notes ?? null : undefined,
        nickname: p?.nickname ?? '', region: p?.region ?? null,
        location: own || db.profiles[ME]?.is_admin ? db.locations[c.id] || null : null };
    },
    async userEntries(userId) {
      return db.entries.filter((e) => e.user_id === userId).map(({ tournament_id, joined_at }) => ({ tournament_id, joined_at }));
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
      const today = db.catches.filter((c) => c.user_id === ME && Date.now() - new Date(c.received_at) < D).length;
      if (today >= 50) throw new RetryLaterError('Paros limitas – 50 laimikių. Išsiųsime automatiškai vėliau', 'catch_limit');
      if (db.catches.some((c) => c.photo_sha256 === item.sha256)) {
        throw new PermanentError('Ši nuotrauka jau buvo įkelta', 'duplicate_photo');
      }
      const path = `${ME}/${item.clientId}.jpg`;
      await photoStore.put({ clientId: path, blob: item.photo });
      const row = {
        id: item.clientId, client_id: item.clientId, user_id: ME, species_id: item.speciesId,
        length_mm: item.lengthMm, captured_at_device: item.capturedAt, received_at: new Date().toISOString(),
        photo_path: path, photo_sha256: item.sha256, status: 'pending', reject_reason: null,
        weight_g: item.weightG ?? null, bait: item.bait || null, notes: item.notes || null, weather: item.weather ?? null,
        created_at: new Date().toISOString()
      };
      db.catches.push(row);
      if (item.location) db.locations[row.id] = item.location;
      save();
      return row;
    },

    async updateCatch(id, { bait, notes }) {
      const c = db.catches.find((x) => x.id === id && x.user_id === ME);
      if (!c) throw new Error('Nepavyko išsaugoti');
      if (String(bait || '').length > 80 || String(notes || '').length > 500) throw new Error('Per ilgas tekstas');
      c.bait = bait || null;
      c.notes = notes || null;
      save();
    },

    async myDisputes() { return db.disputes.filter((d) => d.user_id === ME); },
    async openDispute(catchId, message) {
      const c = db.catches.find((x) => x.id === catchId && x.user_id === ME && x.status === 'rejected');
      if (!c) throw new Error('Nepavyko pateikti');
      if (db.disputes.some((d) => d.catch_id === catchId)) throw new Error('Ginčas dėl šio laimikio jau pateiktas');
      const msg = String(message || '').trim();
      if (msg.length < 3 || msg.length > 500) throw new Error('Parašyk 3–500 simbolių');
      db.disputes.push({ id: `d-${Date.now().toString(36)}`, catch_id: catchId, user_id: ME, message: msg, status: 'open',
        resolution: null, resolved_by: null, resolved_at: null, created_at: new Date().toISOString() });
      save();
    },
    async openDisputes() {
      return db.disputes.filter((d) => d.status === 'open').map((d) => ({
        ...d,
        catch: db.catches.find((c) => c.id === d.catch_id) || null,
        nickname: db.profiles[d.user_id]?.nickname ?? '',
        trust_score: db.profiles[d.user_id]?.trust_score ?? 50
      }));
    },
    async resolveDispute(id, accept, note) {
      const d = db.disputes.find((x) => x.id === id && x.status === 'open');
      if (!d) throw new Error('Ginčas nerastas');
      Object.assign(d, { status: accept ? 'accepted' : 'rejected', resolution: String(note || '').trim() || null,
        resolved_by: ME, resolved_at: new Date().toISOString() });
      if (accept) {
        const c = db.catches.find((x) => x.id === d.catch_id);
        if (c) Object.assign(c, { status: 'approved', reject_reason: null });
      }
      save();
    },
    async moderators() {
      return Object.values(db.profiles).filter((p) => p.is_admin).map(({ id, nickname, region }) => ({ id, nickname, region }));
    },
    async staff() {
      return Object.values(db.profiles).filter((p) => rolesOf(p).length)
        .map((p) => ({ id: p.id, nickname: p.nickname, region: p.region, roles: rolesOf(p) }))
        .sort((a, b) => a.nickname.localeCompare(b.nickname));
    },
    async setRole(nickname, role, on) {
      if (!rolesOf(db.profiles[ME]).includes('owner')) throw new Error('Roles skirti gali tik savininkas');
      const p = Object.values(db.profiles).find((x) => x.nickname.toLowerCase() === String(nickname).trim().toLowerCase());
      if (!p) throw new Error('Tokio slapyvardžio nėra');
      if (!ASSIGNABLE.some((r) => r.key === role)) throw new Error('Tokios rolės nėra');
      const roles = rolesOf(p);
      if (roles.includes('owner')) throw new Error('Savininko rolių keisti negalima');
      if (on && banActive(db.bans.find((b) => b.user_id === p.id))) throw new Error('Užblokuotam žvejui rolės suteikti negalima');
      p.roles = on ? [...new Set([...roles, role])].sort() : roles.filter((r) => r !== role);
      p.is_admin = p.roles.length > 0;
      save();
    },
    async setModerator(nickname, admin) {
      const p = Object.values(db.profiles).find((x) => x.nickname.toLowerCase() === String(nickname).trim().toLowerCase());
      if (!p) throw new Error('Tokio slapyvardžio nėra');
      if (!admin && p.is_admin && Object.values(db.profiles).filter((x) => x.is_admin).length <= 1) {
        throw new Error('Negalima pašalinti paskutinio moderatoriaus');
      }
      p.is_admin = admin;
      save();
    },

    // Atsitiktiniai patikrinimai (demo – telefone)
    async myChecks() {
      return db.checks.filter((k) => k.user_id === ME && ['open', 'answered'].includes(k.status));
    },
    async check(id) {
      const k = db.checks.find((x) => x.id === id);
      if (!k || (k.user_id !== ME && !rolesOf(db.profiles[ME]).length)) return null;
      return { ...k, catch: db.catches.find((c) => c.id === k.catch_id) || null };
    },
    async catchCheck(catchId) {
      return db.checks.find((k) => k.catch_id === catchId && ['open', 'answered'].includes(k.status)) || null;
    },
    async answerCheck(id) {
      const k = db.checks.find((x) => x.id === id && x.user_id === ME);
      if (!k || k.status !== 'open') throw new Error('Į šią patikrą jau atsakyta');
      if (Date.parse(k.due_at) < Date.now()) throw new Error('Terminas jau baigėsi');
      Object.assign(k, { status: 'answered', answered_at: new Date().toISOString(), photo_path: null });
      save();
    },
    async requestCheck(catchId, instruction, hours) {
      const c = db.catches.find((x) => x.id === catchId);
      if (!c) throw new Error('Laimikis nerastas');
      if (c.user_id === ME) throw new Error('Savo laimikio tikrinti negalima');
      if (db.checks.some((k) => k.catch_id === catchId && ['open', 'answered'].includes(k.status))) throw new Error('Šiam laimikiui patikra jau vyksta');
      const text = String(instruction || '').trim();
      if (text.length < 3) throw new Error('Įrašyk, ką žvejys turi nufotografuoti');
      const id = `chk-${Date.now().toString(36)}`;
      db.checks.push({ id, catch_id: catchId, user_id: c.user_id, instruction: text.slice(0, 200), status: 'open',
        due_at: new Date(Date.now() + hours * 3600e3).toISOString(), created_at: new Date().toISOString(), photo_path: null });
      save();
      return id;
    },
    async randomCheckCandidate() {
      const live = db.tournaments.filter((t) => phase(t) === 'live');
      const picks = [];
      for (const t of live) {
        const board = await this.leaderboard(t.id);
        for (const r of board.filter((x) => x.rank !== null && x.rank <= 3 && x.user_id !== ME)) {
          const best = db.catches.filter((c) => c.user_id === r.user_id && c.status === 'approved'
              && c.captured_at_device >= t.starts_at && c.captured_at_device < t.ends_at)
            .sort((a, b) => b.length_mm - a.length_mm)[0];
          if (best && !db.checks.some((k) => k.catch_id === best.id)) picks.push(best.id);
        }
      }
      return picks.length ? picks[Math.floor(Math.random() * picks.length)] : null;
    },
    async moderationChecks() {
      return db.checks.filter((k) => ['open', 'answered'].includes(k.status))
        .map((k) => ({ ...k, catch: db.catches.find((c) => c.id === k.catch_id) || null, nickname: db.profiles[k.user_id]?.nickname ?? '' }));
    },
    async resolveCheck(id, pass, note) {
      const k = db.checks.find((x) => x.id === id);
      if (!k || k.status !== 'answered') throw new Error('Patikra jau išspręsta');
      Object.assign(k, { status: pass ? 'passed' : 'failed', resolved_at: new Date().toISOString(), note: note || null });
      if (!pass) {
        const c = db.catches.find((x) => x.id === k.catch_id);
        if (c) Object.assign(c, { status: 'rejected', reject_reason: `Nepraėjo papildomos patikros${note ? `: ${note}` : ''}` });
      }
      save();
    },

    async pushPublicKey() { return null; },
    async savePushSubscription() {},
    async removePushSubscription() {},
    async notificationSettings() { return { review: true, overtaken: true, start: true, announcements: true, ...(db.notify || {}) }; },
    async saveNotificationSettings(s) { db.notify = { ...s }; save(); },
    async sendTestPush() { return false; },

    async myBan() {
      const b = db.bans.find((x) => x.user_id === ME);
      return banActive(b) ? b : null;
    },
    async userBan(userId) {
      const b = db.bans.find((x) => x.user_id === userId);
      return banActive(b) ? b : null;
    },
    async bans() {
      return db.bans.filter((b) => banActive(b))
        .map((b) => ({ ...b, nickname: db.profiles[b.user_id]?.nickname ?? '' }))
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async banUser(userId, days, reason) {
      const p = db.profiles[userId];
      const why = String(reason || '').trim();
      if (!p) throw new Error('Žvejys nerastas');
      if (userId === ME) throw new Error('Savęs blokuoti negalima');
      if (rolesOf(p).length) throw new Error('Komandos nario blokuoti negalima – pirma atimk jo roles');
      if (why.length < 3) throw new Error('Įrašyk priežastį (bent 3 simboliai)');
      db.bans = db.bans.filter((b) => b.user_id !== userId);
      db.bans.push({ user_id: userId, reason: why.slice(0, 300), banned_by: ME, created_at: new Date().toISOString(),
        until: days === null ? null : new Date(Date.now() + days * 864e5).toISOString() });
      save();
    },
    async unbanUser(userId) {
      db.bans = db.bans.filter((b) => b.user_id !== userId);
      save();
    },
    async resetNickname(userId) {
      const nick = `zvejys_${userId.replace(/[^0-9a-f]/gi, '').padEnd(8, '0').slice(0, 8).toLowerCase()}`;
      db.profiles[userId].nickname = nick;
      save();
      return nick;
    },

    async exportData() {
      return {
        exported_at: new Date().toISOString(),
        email: user.email,
        profile: { ...db.profiles[ME] },
        catches: db.catches.filter((c) => c.user_id === ME).map((c) => ({ ...c, catch_locations: db.locations[c.id] || null })),
        entries: db.entries.filter((e) => e.user_id === ME),
        tournaments_organized: db.tournaments.filter((t) => t.organizer_id === ME),
        disputes: db.disputes.filter((d) => d.user_id === ME),
        blank_trips: db.blank_trips.filter((b) => b.user_id === ME),
        catch_reports: db.reports.filter((r) => r.reporter_id === ME)
      };
    },
    async deleteAccount(onStep = () => {}) {
      onStep('data');
      onStep('photos');
      onStep('account');
      localStorage.removeItem(KEY);
      db = seed();
      save();
    },

    async reportCatch(catchId, reason, message) {
      const c = db.catches.find((x) => x.id === catchId && x.status === 'approved' && x.user_id !== ME);
      if (!c) throw new Error('Nepavyko pranešti');
      if (db.reports.some((r) => r.catch_id === catchId && r.reporter_id === ME)) throw new Error('Apie šį laimikį jau pranešei');
      db.reports.push({ id: `r-${Date.now().toString(36)}`, catch_id: catchId, reporter_id: ME, reason,
        message: String(message || '').trim() || null, status: 'open', created_at: new Date().toISOString() });
      save();
    },
    async myReport(catchId) {
      return db.reports.find((r) => r.catch_id === catchId && r.reporter_id === ME) || null;
    },
    async openReports() {
      return db.reports.filter((r) => r.status === 'open').map((r) => ({
        ...r, catch: db.catches.find((c) => c.id === r.catch_id) || null, reporter: db.profiles[r.reporter_id]?.nickname ?? ''
      }));
    },
    async resolveReport(id, uphold, reason) {
      const r = db.reports.find((x) => x.id === id && x.status === 'open');
      if (!r) throw new Error('Pranešimas nerastas');
      if (uphold && !String(reason || '').trim()) throw new Error('Nurodyk atmetimo priežastį');
      if (uphold) {
        const c = db.catches.find((x) => x.id === r.catch_id);
        Object.assign(c, { status: 'rejected', reject_reason: String(reason).trim() });
        const p = db.profiles[c.user_id];
        if (p) p.trust_score = Math.max(0, p.trust_score - 5);
      }
      db.reports.filter((x) => x.catch_id === r.catch_id && x.status === 'open')
        .forEach((x) => Object.assign(x, { status: uphold ? 'upheld' : 'dismissed', resolved_by: ME, resolved_at: new Date().toISOString() }));
      save();
    },

    async blankTrips() {
      return db.blank_trips.filter((b) => b.user_id === ME).sort((a, b) => b.trip_date.localeCompare(a.trip_date));
    },
    async addBlankTrip(trip) {
      const today = new Date().toISOString().slice(0, 10);
      if (trip.trip_date > today) throw new Error('Data negali būti ateityje');
      if (db.blank_trips.filter((b) => b.user_id === ME && Date.now() - new Date(b.created_at) < D).length >= 10) {
        throw new Error('Per parą galima įrašyti ne daugiau kaip 10 išvykų');
      }
      db.blank_trips.push({ ...trip, id: `b-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, user_id: ME, created_at: new Date().toISOString() });
      save();
    },
    async deleteBlankTrip(id) {
      db.blank_trips = db.blank_trips.filter((b) => !(b.id === id && b.user_id === ME));
      save();
    },

    async announcements(tournamentId) {
      return db.announcements.filter((a) => a.tournament_id === tournamentId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    async postAnnouncement(tournamentId, message) {
      const t = db.tournaments.find((x) => x.id === tournamentId);
      if (!t || t.organizer_id !== ME) throw new Error('Pranešimus rašo tik organizatorius');
      const msg = String(message || '').trim();
      if (msg.length < 2 || msg.length > 500) throw new Error('Pranešimas: 2–500 simbolių');
      if (db.announcements.filter((a) => a.tournament_id === tournamentId && Date.now() - new Date(a.created_at) < D).length >= 10) {
        throw new Error('Per parą – ne daugiau kaip 10 pranešimų');
      }
      db.announcements.push({ id: `a-${Date.now().toString(36)}`, tournament_id: tournamentId, author_id: ME, message: msg, created_at: new Date().toISOString() });
      save();
    },
    async deleteAnnouncement(id) {
      db.announcements = db.announcements.filter((a) => !(a.id === id && a.author_id === ME));
      save();
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
      if (c.status === 'pending') {
        const p = db.profiles[c.user_id];
        if (p) p.trust_score = Math.max(0, Math.min(100, p.trust_score + (approve ? 1 : -5)));
      }
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
