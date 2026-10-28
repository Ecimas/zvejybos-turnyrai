// Demonstracinis režimas: visi duomenys tik šiame telefone (localStorage + IndexedDB).
// Leidžia išbandyti programėlę dar prieš prijungiant Supabase.
import { SPECIES, speciesId } from './species.js';
import { computeLeaderboard, leagueStandings } from '../lib/scoring.js';
import { duelBracket } from '../lib/duels.js';
import { PermanentError, RetryLaterError, idbStore, memoryStore } from '../lib/outbox.js';
import { phase, registrationOpen } from '../lib/format.js';
import { banActive } from '../lib/bans.js';
import { rolesOf, ASSIGNABLE, permsOf } from '../lib/roles.js';

const KEY = 'zt-demo-v1';
const ME = '00000000-0000-4000-8000-000000000001';
const H = 3600e3;
const D = 24 * H;
const LEAGUE_NAME = /^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_"„“()-]+$/;
const DIV_NAME = /^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_+()-]+$/;
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
    T('t-sezonas', { title: 'Sezono iššūkis', format: 'biggest', starts_at: iso(-60 * D), ends_at: iso(39 * D), team_mode: true,
      description: 'Didžiausia bet kurios rūšies žuvis per sezoną.' }),
    T('t-eseriai', { title: 'Ešerių savaitgalis', format: 'biggest', min_length_mm: 200, late_join_minutes: 0,
      starts_at: iso(30 * H), ends_at: iso(30 * H + 2 * D) }),
    T('t-plesrunai', { title: 'Rugsėjo plėšrūnai', format: 'top_n_sum', top_n: 3, min_length_mm: 400,
      starts_at: iso(-40 * D), ends_at: iso(-22 * D), prize_fund_cents: 10000, prize_split: [60, 40] }),
    T('t-slaptas', { title: 'Draugų iššūkis', format: 'biggest', organizer_id: ME, visibility: 'private',
      leaderboard_hidden: true, starts_at: iso(-2 * D), ends_at: iso(5 * D),
      description: 'Privatus turnyras tik su kvietimu. Lentelė paslėpta iki pabaigos.' }),
    T('t-taskai', { title: 'Marių taškų taurė', format: 'species_points', top_n: 3, starts_at: iso(-3 * D), ends_at: iso(3 * D),
      league_id: 'lyga-marios', description: 'Retesnė žuvis – daugiau taškų: starkis ×1,5, karšis ×2.' }),
    T('t-dvikovos', { title: 'Ešerių dvikovos', format: 'duels', top_n: 1, late_join_minutes: 0,
      starts_at: iso(-2.5 * D), ends_at: iso(0.5 * D), description: 'Atkrintamosios poros: rate laimi didesnį ešerį pagavęs.' })
  ];
  tournaments.find((t) => t.id === 't-taure').league_id = 'lyga-marios';
  tournaments.find((t) => t.id === 't-plesrunai').league_id = 'lyga-marios';
  const tournament_species = [
    ['t-taure', speciesId('lydeka')], ['t-eseriai', speciesId('eserys')],
    ['t-plesrunai', speciesId('lydeka')], ['t-plesrunai', speciesId('starkis')],
    ['t-taskai', speciesId('lydeka'), 100], ['t-taskai', speciesId('starkis'), 150], ['t-taskai', speciesId('karsis'), 200],
    ['t-dvikovos', speciesId('eserys')]
  ].map(([tournament_id, species_id, points_pct = 100]) => ({ tournament_id, species_id, points_pct }));

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
  enter('t-taskai', [ids[1], ids[3], ids[5], ids[7], ids[8]]);
  enter('t-dvikovos', [ME, ...ids.slice(0, 7)]);

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
  // Taškų taurė: lydekos ×1, starkiai ×1,5, karšiai ×2
  [[1, 'starkis', 640], [1, 'lydeka', 720], [3, 'karsis', 480], [3, 'karsis', 455], [5, 'lydeka', 810], [5, 'starkis', 520],
   [7, 'karsis', 510], [8, 'starkis', 600], [8, 'lydeka', 690], [8, 'karsis', 420]]
    .forEach(([i, code, len], j) => add(ids[i], code, len, -(2.6 * D) + j * 7 * H));
  // Dvikovos: 8 dalyviai, 3 ratai po parą; du ratai baigti, finalas vyksta
  [ME, ...ids.slice(0, 7)].forEach((u, i) => {
    add(u, 'eserys', 280 + ((i * 137) % 240), -2.3 * D + i * H);
    add(u, 'eserys', 300 + ((i * 89 + 50) % 230), -1.2 * D + i * H);
    if (i % 2) add(u, 'eserys', 310 + ((i * 53) % 200), -0.4 * D + i * H);
  });

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
  // Demo: mano laimikių vietos prie Kauno marių ir Nemuno (žemėlapiui).
  // Kelios žuvys toje pačioje vietoje (iki ~20 m) – žemėlapyje sugrupuojamos.
  const SPOTS = [[54.866, 24.06], [54.897, 23.94], [54.852, 24.12]];
  const locations = {};
  catches.filter((c) => c.user_id === ME).forEach((c, i) => {
    const [lat, lng] = SPOTS[i % SPOTS.length];
    locations[c.id] = { lat: lat + (i % 2) * 0.0001, lng: lng + (i % 2) * 0.0001, accuracy: 8 };
  });
  // Klubai: atviras Kauno ir uždaras Nemuno; sezono turnyre – komandinė įskaita.
  const clubs = [
    { id: 'club-kaunas', name: 'Kauno lydekininkai', region: 'Kaunas', description: 'Žvejojam Kauno mariose ir Nemune. Kas savaitę – bendras išvykimas.', owner_id: ids[0], open: true, invite_code: 'a1b2c3d4e5', created_at: iso(-90 * D) },
    { id: 'club-nemunas', name: 'Nemuno ešeriai', region: 'Alytaus r.', description: null, owner_id: ids[4], open: false, invite_code: 'f6e5d4c3b2', created_at: iso(-50 * D) }
  ];
  const club_members = [
    ...[0, 1, 2, 3].map((i) => ({ club_id: 'club-kaunas', user_id: ids[i], role: i === 0 ? 'owner' : 'member', joined_at: iso(-80 * D) })),
    ...[4, 5, 6].map((i) => ({ club_id: 'club-nemunas', user_id: ids[i], role: i === 4 ? 'owner' : 'member', joined_at: iso(-40 * D) }))
  ];
  entries.filter((e) => e.tournament_id === 't-sezonas').forEach((e) => {
    e.club_id = club_members.find((m) => m.user_id === e.user_id)?.club_id ?? null;
  });
  // Sezono lyga ir divizionai (Rudens lydekų taurė: krantas ir valtis)
  const leagues = [{ id: 'lyga-marios', name: 'Kauno marių lyga', season: new Date(now).getFullYear(), owner_id: ids[0],
    description: 'Etapų taškai: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1.', created_at: iso(-60 * D) }];
  const divisions = [
    { id: 'div-krantas', tournament_id: 't-taure', name: 'Krantas', sort: 0 },
    { id: 'div-valtis', tournament_id: 't-taure', name: 'Valtis', sort: 1 }
  ];
  entries.filter((e) => e.tournament_id === 't-taure').forEach((e, i) => { e.division_id = i % 2 ? 'div-valtis' : 'div-krantas'; });
  return { profiles, tournaments, tournament_species, tournament_sponsors, entries, catches, locations, disputes: [],
    announcements, reports, blank_trips: [], bans: [], follows: [], clubs, club_members, leagues, divisions };
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
  db.follows ||= [];
  db.clubs ||= [];
  db.club_members ||= [];
  db.leagues ||= [];
  db.divisions ||= [];
  db.admin_log ||= [];
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* pilna atmintis */ } };
  save();
  const photoStore = photos || (typeof indexedDB !== 'undefined' ? idbStore('zvejybos-turnyrai-demo', 'photos') : memoryStore());
  const urls = new Map();
  const listeners = new Set();
  const user = { id: ME, email: 'demo@zvejybosturnyrai.lt' };

  const visible = (t) => t.visibility === 'public' || t.organizer_id === ME
    || db.entries.some((e) => e.tournament_id === t.id && e.user_id === ME);
  const isOrganizerBeforeStart = (t) => t && t.organizer_id === ME && Date.now() < new Date(t.starts_at).getTime();
  const isTournamentAdmin = () => permsOf(db.profiles[ME]).has('tournaments');
  const RULE_KEYS = ['format', 'top_n', 'min_length_mm', 'starts_at', 'team_mode', 'league_id', 'prize_fund_cents', 'prize_split'];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const decorate = (t) => ({
    ...t,
    species_ids: db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => x.species_id),
    species_pct: Object.fromEntries(db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => [x.species_id, x.points_pct ?? 100])),
    divisions: db.divisions.filter((d) => d.tournament_id === t.id).sort((a, b) => a.sort - b.sort),
    league: (({ id, name, season } = {}) => (id ? { id, name, season } : null))(db.leagues.find((l) => l.id === t.league_id)),
    my_division_id: db.entries.find((e) => e.tournament_id === t.id && e.user_id === ME)?.division_id ?? null,
    sponsors: db.tournament_sponsors.filter((x) => x.tournament_id === t.id).sort((a, b) => a.sort - b.sort),
    last_announcement_at: db.announcements.filter((a) => a.tournament_id === t.id)
      .reduce((m, a) => (!m || a.created_at > m ? a.created_at : m), null),
    participants: db.entries.filter((e) => e.tournament_id === t.id).length,
    joined: db.entries.some((e) => e.tournament_id === t.id && e.user_id === ME),
    my_club_id: db.entries.find((e) => e.tournament_id === t.id && e.user_id === ME)?.club_id ?? null,
    joined_at: db.entries.find((e) => e.tournament_id === t.id && e.user_id === ME)?.joined_at ?? null
  });

  // Kaip serverio trigeris: dvikovose – registracija tik iki starto, be slėpimo ir komandų.
  const formatRules = (t) => {
    if (t.format === 'duels') Object.assign(t, { late_join_minutes: 0, leaderboard_hidden: false, team_mode: false });
    return t;
  };
  const checkLeague = (leagueId) => {
    if (leagueId && !db.leagues.some((l) => l.id === leagueId && l.owner_id === ME)) throw new Error('Į lygą gali įtraukti tik lygos savininkas');
  };
  const saveDivisions = (id, list) => {
    const names = list.map((d) => String(d.name || '').trim());
    if (names.length > 8) throw new Error('Daugiausia 8 divizionai');
    if (names.some((n) => n.length < 2 || n.length > 30 || !DIV_NAME.test(n))) throw new Error('Diviziono pavadinimas: 2–30 raidžių');
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new Error('Divizionų pavadinimai turi skirtis');
    const keep = new Set(list.filter((d) => d.id).map((d) => d.id));
    db.divisions.filter((d) => d.tournament_id === id && !keep.has(d.id)).forEach((d) => {
      db.entries.forEach((e) => { if (e.division_id === d.id) e.division_id = null; });
    });
    db.divisions = db.divisions.filter((d) => d.tournament_id !== id || keep.has(d.id));
    list.forEach((d, i) => {
      const old = d.id && db.divisions.find((x) => x.id === d.id);
      if (old) Object.assign(old, { name: names[i], sort: i });
      else db.divisions.push({ id: `div-${id}-${Date.now().toString(36)}-${i}`, tournament_id: id, name: names[i], sort: i });
    });
  };

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
      return t && (visible(t) || isTournamentAdmin()) ? decorate(t) : null;
    },
    async createTournament(data) {
      const id = `t-${Date.now().toString(36)}`;
      const { species_ids, species_pct = {}, sponsors = [], divisions = [], ...rest } = data;
      const recent = db.tournaments.filter((t) => t.organizer_id === ME && Date.now() - new Date(t.created_at) < D).length;
      if (recent >= 10) throw new Error('Per parą galima sukurti ne daugiau kaip 10 turnyrų');
      checkLeague(rest.league_id);
      db.tournaments.push(formatRules({ id, organizer_id: ME, visibility: 'public', fee_cents: 0, leaderboard_hidden: false,
        invite_code: code10(), created_at: new Date().toISOString(), ...rest }));
      species_ids.forEach((species_id) => db.tournament_species.push({ tournament_id: id, species_id, points_pct: species_pct[species_id] ?? 100 }));
      saveDivisions(id, divisions);
      sponsors.forEach((s, i) => db.tournament_sponsors.push({ ...s, id: `s-${id}-${i}`, tournament_id: id, sort: i }));
      db.entries.push({ tournament_id: id, user_id: ME, joined_at: new Date().toISOString() });
      save();
      return id;
    },
    async updateTournament(id, data) {
      const t = db.tournaments.find((x) => x.id === id);
      const asOrganizer = isOrganizerBeforeStart(t);
      if (!t || (!asOrganizer && !isTournamentAdmin())) throw new Error('Turnyras jau prasidėjo – keisti nebegalima');
      const { species_ids, species_pct = {}, sponsors, divisions, ...rest } = data;
      const started = Date.now() >= new Date(t.starts_at).getTime();
      if (!asOrganizer && started) {
        if (RULE_KEYS.some((k) => k in rest && !same(rest[k], t[k])) || species_ids || divisions) throw new Error('Prasidėjusio turnyro taisyklių keisti negalima');
        if ('ends_at' in rest && new Date(rest.ends_at) < Date.now() - 60e3) throw new Error('Pabaiga negali būti praeityje');
      }
      if (rest.league_id && rest.league_id !== t.league_id) checkLeague(rest.league_id);
      if (!asOrganizer) {
        const changes = Object.fromEntries(Object.keys(rest).filter((k) => !same(rest[k], t[k])).map((k) => [k, [t[k] ?? null, rest[k] ?? null]]));
        if (Object.keys(changes).length) {
          db.admin_log.unshift({ id: Date.now(), tournament_id: id, title: rest.title || t.title, organizer_id: t.organizer_id, action: 'update',
            changes, reason: null, created_at: new Date().toISOString(), actor_nick: db.profiles[ME].nickname });
        }
      }
      formatRules(Object.assign(t, rest));
      if (divisions) saveDivisions(id, divisions);
      if (sponsors) {
        db.tournament_sponsors = db.tournament_sponsors.filter((x) => x.tournament_id !== id)
          .concat(sponsors.map((s, i) => ({ ...s, id: `s-${id}-${i}`, tournament_id: id, sort: i })));
      }
      if (species_ids) {
        db.tournament_species = db.tournament_species.filter((x) => x.tournament_id !== id)
          .concat(species_ids.map((species_id) => ({ tournament_id: id, species_id, points_pct: species_pct[species_id] ?? 100 })));
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
      db.divisions = db.divisions.filter((x) => x.tournament_id !== id);
      save();
    },
    async adminDeleteTournament(id, reason) {
      if (!isTournamentAdmin()) throw new Error('Neturi teisės šalinti turnyrų');
      const why = String(reason || '').trim().slice(0, 300);
      if (why.length < 5) throw new Error('Nurodyk priežastį (bent 5 simboliai)');
      const t = db.tournaments.find((x) => x.id === id);
      if (!t) throw new Error('Turnyras jau pašalintas');
      db.admin_log.unshift({ id: Date.now(), tournament_id: id, title: t.title, organizer_id: t.organizer_id, action: 'delete',
        changes: { entries: db.entries.filter((e) => e.tournament_id === id).length }, reason: why,
        created_at: new Date().toISOString(), actor_nick: db.profiles[ME].nickname });
      db.tournaments = db.tournaments.filter((x) => x.id !== id);
      for (const k of ['tournament_species', 'tournament_sponsors', 'entries', 'divisions', 'announcements']) db[k] = db[k].filter((x) => x.tournament_id !== id);
      save();
    },
    async tournamentAdminLog() {
      if (!isTournamentAdmin()) throw new Error('Neturi teisės');
      return db.admin_log.slice(0, 100);
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
        speciesPct: Object.fromEntries(db.tournament_species.filter((x) => x.tournament_id === id).map((x) => [x.species_id, x.points_pct ?? 100])),
        entries: db.entries.filter((e) => e.tournament_id === id && !banActive(db.bans.find((b) => b.user_id === e.user_id))),
        catches: db.catches,
        profiles: db.profiles
      });
      // Kaip serveryje: paslėpta lentelė vykstant turnyrui – tik savo eilutė be vietos
      // (organizatorius ir moderatoriai mato viską).
      const hidden = t.leaderboard_hidden && phase(t) !== 'done' && t.organizer_id !== ME && !db.profiles[ME]?.is_admin;
      return hidden ? rows.filter((r) => r.user_id === ME).map((r) => ({ ...r, rank: null })) : rows;
    },
    async serverNow() { return new Date().toISOString(); },
    async touchPresence(d) {
      db.presence ||= {};
      db.devices ||= [];
      db.presence[ME] = new Date().toISOString();
      const row = db.devices.find((x) => x.user_id === ME && x.model === d.model && x.platform === d.platform && x.browser === d.browser);
      if (row) Object.assign(row, { last_seen: new Date().toISOString(), installed: row.installed || !!d.installed });
      else db.devices.push({ user_id: ME, model: d.model, platform: d.platform, os_version: d.os || null, browser: d.browser, installed: !!d.installed, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() });
      save();
    },
    async adminStats() {
      if (!rolesOf(db.profiles[ME]).includes('owner')) throw new Error('Statistiką mato tik savininkas');
      const now = Date.now();
      const day0 = new Date(); day0.setHours(0, 0, 0, 0);
      const profs = Object.values(db.profiles);
      // Demo: kiti žvejai „buvo“ pagal savo paskutinį laimikį; įrenginiai – pavyzdiniai
      const seen = { ...Object.fromEntries(profs.map((p) => [p.id, db.catches.filter((c) => c.user_id === p.id).map((c) => c.received_at).sort().pop() || null])), ...(db.presence || {}) };
      const DEMO_DEV = [['SM-S918B', 'Android', 'Chrome'], ['SM-A536B', 'Android', 'Samsung Internet'], ['iPhone', 'iOS', 'Safari'], ['Pixel 8', 'Android', 'Chrome'],
        ['SM-A546B', 'Android', 'Chrome'], ['iPhone', 'iOS', 'Safari'], ['2201117TG', 'Android', 'Chrome'], ['SM-S918B', 'Android', 'Chrome'], ['iPhone', 'iOS', 'Chrome']];
      const devices = [...profs.filter((p) => p.id !== ME).map((p, i) => ({ user_id: p.id, model: DEMO_DEV[i % 9][0], platform: DEMO_DEV[i % 9][1], browser: DEMO_DEV[i % 9][2], installed: i % 3 === 0 })), ...(db.devices || [])];
      const since = (t) => Object.values(seen).filter((v) => v && Date.parse(v) >= t).length;
      const group = (key) => Object.values(devices.reduce((m, d) => {
        const k = key(d);
        m[k] ||= { ...(k.includes('|') ? { model: d.model, platform: d.platform } : {}), key: k, users: new Set() };
        m[k].users.add(d.user_id);
        return m;
      }, {})).map((x) => ({ ...x, users: x.users.size })).sort((a, b) => b.users - a.users || a.key.localeCompare(b.key));
      const signups = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(day0.getTime() - (29 - i) * 864e5);
        const next = d.getTime() + 864e5;
        return { day: d.toISOString().slice(0, 10), count: profs.filter((p) => Date.parse(p.created_at) >= d.getTime() && Date.parse(p.created_at) < next).length };
      });
      return {
        users: profs.length,
        new_today: profs.filter((p) => Date.parse(p.created_at) >= day0.getTime()).length,
        new_7d: profs.filter((p) => Date.parse(p.created_at) >= now - 7 * D).length,
        new_30d: profs.filter((p) => Date.parse(p.created_at) >= now - 30 * D).length,
        online_now: since(now - 5 * 60e3), active_today: since(day0.getTime()), active_7d: since(now - 7 * D), active_30d: since(now - 30 * D),
        catches_today: db.catches.filter((c) => Date.parse(c.received_at) >= day0.getTime()).length,
        pending: db.catches.filter((c) => c.status === 'pending').length,
        live_tournaments: db.tournaments.filter((t) => phase(t) === 'live').length,
        signups,
        models: group((d) => `${d.model}|${d.platform}`).map(({ model, platform, users }) => ({ model, platform, users })).slice(0, 20),
        platforms: group((d) => d.platform).map((x) => ({ platform: x.key, users: x.users })),
        browsers: group((d) => d.browser).map((x) => ({ browser: x.key, users: x.users })),
        installed: new Set(devices.filter((d) => d.installed).map((d) => d.user_id)).size,
        with_device: new Set(devices.map((d) => d.user_id)).size
      };
    },
    async divisionMap(id) {
      return new Map(db.entries.filter((e) => e.tournament_id === id).map((e) => [e.user_id, e.division_id ?? null]));
    },
    async setEntryDivision(tournamentId, divisionId) {
      const t = db.tournaments.find((x) => x.id === tournamentId);
      const e = db.entries.find((x) => x.tournament_id === tournamentId && x.user_id === ME);
      if (!t || !e) throw new Error('Nepavyko išsaugoti');
      if (!(Date.now() < Date.parse(t.starts_at) || registrationOpen(t))) throw new Error('Registracija baigėsi – diviziono keisti nebegalima');
      if (divisionId && !db.divisions.some((d) => d.id === divisionId && d.tournament_id === tournamentId)) throw new Error('Tokio diviziono nėra');
      e.division_id = divisionId || null;
      save();
    },
    async duelBracket(id) {
      const t = db.tournaments.find((x) => x.id === id);
      if (!t || !visible(t)) return [];
      return duelBracket({
        tournament: t,
        speciesIds: db.tournament_species.filter((x) => x.tournament_id === id).map((x) => x.species_id),
        entries: db.entries.filter((e) => e.tournament_id === id),
        catches: db.catches,
        profiles: db.profiles,
        banned: (u) => banActive(db.bans.find((b) => b.user_id === u))
      });
    },

    // Sezono lygos
    async leagues() {
      return db.leagues.map((l) => ({ ...l, events: db.tournaments.filter((t) => t.league_id === l.id && visible(t)).length }))
        .sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
    },
    async league(id) {
      const l = db.leagues.find((x) => x.id === id);
      if (!l) return null;
      const list = db.tournaments.filter((t) => t.league_id === id);
      const counted = list.filter((t) => t.visibility === 'public' && Date.now() >= Date.parse(t.starts_at) && !(t.leaderboard_hidden && phase(t) !== 'done'));
      const boards = await Promise.all(counted.map((t) => this.leaderboard(t.id)));
      return { ...l, standings: leagueStandings(boards), tournaments: list.filter(visible).sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(decorate) };
    },
    async myLeagues() {
      return db.leagues.filter((l) => l.owner_id === ME).map(({ id, name, season }) => ({ id, name, season }));
    },
    async createLeague({ name, season, description }) {
      const n = String(name || '').trim();
      if (!LEAGUE_NAME.test(n) || n.length < 3 || n.length > 60) throw new Error('Pavadinime gali būti raidės, skaičiai, tarpai ir . , - _ ( ) (3–60 simbolių)');
      if (!(season >= 2024 && season <= 2100)) throw new Error('Netinkamas sezonas');
      if (db.leagues.filter((l) => l.owner_id === ME).length >= 5) throw new Error('Galima sukurti iki 5 lygų');
      if (db.leagues.some((l) => l.season === season && l.name.toLowerCase() === n.toLowerCase())) throw new Error('Tokia lyga šiam sezonui jau yra');
      const id = `lyga-${Date.now().toString(36)}`;
      db.leagues.push({ id, name: n, season, description: description || null, owner_id: ME, created_at: new Date().toISOString() });
      save();
      return id;
    },
    async updateLeague(id, patch) {
      const l = db.leagues.find((x) => x.id === id && x.owner_id === ME);
      if (!l) throw new Error('Nepavyko išsaugoti');
      const n = String(patch.name ?? l.name).trim();
      if (!LEAGUE_NAME.test(n) || n.length < 3) throw new Error('Netinkamas pavadinimas');
      if (db.leagues.some((x) => x.id !== id && x.season === l.season && x.name.toLowerCase() === n.toLowerCase())) throw new Error('Tokia lyga šiam sezonui jau yra');
      Object.assign(l, { name: n, description: patch.description ?? l.description });
      save();
    },
    async deleteLeague(id) {
      if (!db.leagues.some((x) => x.id === id && x.owner_id === ME)) throw new Error('Nepavyko ištrinti');
      db.leagues = db.leagues.filter((x) => x.id !== id);
      db.tournaments.forEach((t) => { if (t.league_id === id) t.league_id = null; });
      save();
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
        clock_offset_s: Number.isInteger(item.clockOffsetS) ? item.clockOffsetS : null,
        send_offset_s: 0,
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

    // Sekimas ir klubai
    async followStats(userId) {
      return {
        followers: db.follows.filter((f) => f.followee_id === userId).length,
        following: db.follows.filter((f) => f.follower_id === userId).length,
        i_follow: db.follows.some((f) => f.follower_id === ME && f.followee_id === userId)
      };
    },
    async follow(userId) {
      if (userId === ME) throw new Error('Savęs sekti negalima');
      if (!db.follows.some((f) => f.follower_id === ME && f.followee_id === userId)) db.follows.push({ follower_id: ME, followee_id: userId, created_at: new Date().toISOString() });
      save();
    },
    async unfollow(userId) {
      db.follows = db.follows.filter((f) => !(f.follower_id === ME && f.followee_id === userId));
      save();
    },
    async followingFeed() {
      const ids = db.follows.filter((f) => f.follower_id === ME).map((f) => f.followee_id);
      const catches = db.catches.filter((c) => ids.includes(c.user_id) && c.status === 'approved')
        .sort((a, b) => b.captured_at_device.localeCompare(a.captured_at_device)).slice(0, 60)
        .map((c) => ({ ...c, nickname: db.profiles[c.user_id]?.nickname ?? '' }));
      return { following: ids.length, catches };
    },
    async clubs() {
      return db.clubs.map(({ invite_code, ...c }) => ({ ...c, members: db.club_members.filter((m) => m.club_id === c.id).length }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async club(id) {
      const c = db.clubs.find((x) => x.id === id);
      if (!c) return null;
      const { invite_code, ...rest } = c;
      const members = db.club_members.filter((m) => m.club_id === id)
        .map((m) => ({ ...m, nickname: db.profiles[m.user_id]?.nickname ?? '', region: db.profiles[m.user_id]?.region ?? null }))
        .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.nickname.localeCompare(b.nickname)));
      return { ...rest, members };
    },
    async myClubs() {
      return db.club_members.filter((m) => m.user_id === ME).map((m) => {
        const { invite_code, ...c } = db.clubs.find((x) => x.id === m.club_id) || {};
        return { ...c, my_role: m.role };
      }).filter((c) => c.id);
    },
    async userClubs(userId) {
      return db.club_members.filter((m) => m.user_id === userId)
        .map((m) => ({ id: m.club_id, name: db.clubs.find((x) => x.id === m.club_id)?.name ?? '', role: m.role }));
    },
    async createClub({ name, region, description, open }) {
      const n = String(name || '').trim();
      if (n.length < 3 || n.length > 40 || !/^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_"„“-]+$/.test(n)) throw new Error('Pavadinime gali būti raidės, skaičiai, tarpai ir . , - _ (3–40 simbolių)');
      if (db.clubs.some((c) => c.name.toLowerCase() === n.toLowerCase())) throw new Error('Toks klubo pavadinimas jau užimtas');
      if (db.clubs.filter((c) => c.owner_id === ME).length >= 3) throw new Error('Galima sukurti iki 3 klubų');
      const id = `club-${Date.now().toString(36)}`;
      db.clubs.push({ id, name: n, region: region || null, description: description || null, owner_id: ME, open: !!open,
        invite_code: Math.random().toString(16).slice(2, 12).padEnd(10, '0'), created_at: new Date().toISOString() });
      db.club_members.push({ club_id: id, user_id: ME, role: 'owner', joined_at: new Date().toISOString() });
      save();
      return id;
    },
    async updateClub(id, patch) {
      const c = db.clubs.find((x) => x.id === id && x.owner_id === ME);
      if (c) Object.assign(c, patch);
      save();
    },
    async deleteClub(id) {
      if (!db.clubs.some((x) => x.id === id && x.owner_id === ME)) return;
      db.clubs = db.clubs.filter((x) => x.id !== id);
      db.club_members = db.club_members.filter((m) => m.club_id !== id);
      db.entries.forEach((e) => { if (e.club_id === id) e.club_id = null; });
      save();
    },
    async joinClub(id, code) {
      const c = db.clubs.find((x) => x.id === id);
      if (!c) throw new Error('Klubas nerastas');
      if (db.club_members.some((m) => m.club_id === id && m.user_id === ME)) return;
      if (!c.open && String(code || '').trim().toLowerCase() !== c.invite_code) throw new Error('Neteisingas kvietimo kodas');
      if (db.club_members.filter((m) => m.user_id === ME).length >= 10) throw new Error('Galima būti iki 10 klubų narys');
      db.club_members.push({ club_id: id, user_id: ME, role: 'member', joined_at: new Date().toISOString() });
      save();
    },
    async leaveClub(id) {
      db.club_members = db.club_members.filter((m) => !(m.club_id === id && m.user_id === ME && m.role !== 'owner'));
      save();
    },
    async removeClubMember(id, userId) {
      if (!db.clubs.some((x) => x.id === id && x.owner_id === ME)) return;
      db.club_members = db.club_members.filter((m) => !(m.club_id === id && m.user_id === userId && m.role !== 'owner'));
      save();
    },
    async clubInviteCode(id) {
      return db.club_members.some((m) => m.club_id === id && m.user_id === ME) ? db.clubs.find((x) => x.id === id)?.invite_code ?? null : null;
    },
    async clubCatches(memberIds) {
      return db.catches.filter((c) => memberIds.includes(c.user_id) && c.status === 'approved')
        .sort((a, b) => b.captured_at_device.localeCompare(a.captured_at_device)).slice(0, 30)
        .map((c) => ({ ...c, nickname: db.profiles[c.user_id]?.nickname ?? '' }));
    },
    async setEntryClub(tournamentId, clubId) {
      const e = db.entries.find((x) => x.tournament_id === tournamentId && x.user_id === ME);
      if (!e) throw new Error('Nedalyvauji šiame turnyre');
      if (clubId && !db.club_members.some((m) => m.club_id === clubId && m.user_id === ME)) throw new Error('Tu ne šio klubo narys');
      e.club_id = clubId || null;
      save();
    },
    async teamLeaderboard(tournamentId) {
      const t = db.tournaments.find((x) => x.id === tournamentId);
      if (!t?.team_mode) return [];
      const board = await this.leaderboard(tournamentId);
      if (board.some((r) => r.rank === null)) return [];
      const byClub = new Map();
      for (const r of board) {
        const clubId = db.entries.find((e) => e.tournament_id === tournamentId && e.user_id === r.user_id)?.club_id;
        if (!clubId) continue;
        if (!byClub.has(clubId)) byClub.set(clubId, []);
        byClub.get(clubId).push(r.score_mm);
      }
      const rows = [...byClub].map(([club_id, scores]) => {
        const top = scores.sort((a, b) => b - a).slice(0, 3);
        return { club_id, name: db.clubs.find((c) => c.id === club_id)?.name ?? '', score_mm: top.reduce((a, b) => a + b, 0),
          counted: top.length, members: db.entries.filter((e) => e.tournament_id === tournamentId && e.club_id === club_id).length };
      }).sort((a, b) => b.score_mm - a.score_mm);
      rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].score_mm === r.score_mm ? rows[i - 1].rank : i + 1; });
      return rows;
    },

    async myMap() {
      return {
        keep: !!db.keepSpots,
        catches: db.catches.filter((c) => c.user_id === ME)
          .sort((a, b) => b.captured_at_device.localeCompare(a.captured_at_device))
          .map((c) => ({ ...c, location: db.locations[c.id] || null, kept: !!db.keepSpots && !!db.locations[c.id] }))
      };
    },
    async setKeepSpots(on) { db.keepSpots = !!on; save(); return 0; },

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
        catch_reports: db.reports.filter((r) => r.reporter_id === ME),
        follows: db.follows.filter((f) => f.follower_id === ME).map((f) => ({ followee_id: f.followee_id, created_at: f.created_at })),
        clubs: db.club_members.filter((m) => m.user_id === ME)
          .map((m) => ({ role: m.role, joined_at: m.joined_at, clubs: (({ id, name }) => ({ id, name }))(db.clubs.find((c) => c.id === m.club_id) || {}) }))
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
