// Supabase kliento imitacija naršyklės testams (tikras režimas be tinklo).
// Įkeliama vietoj https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm.
// Įgyvendina tik tai, ką naudoja src/backend/supabase.js, ir užrašo visus kvietimus į window.__sbCalls.

const SPECIES = ['lydeka', 'eserys', 'starkis', 'karsis', 'kuoja', 'karpis', 'lynas', 'sapalas', 'salatis', 'strepetys',
  'plakis', 'raude', 'karosas', 'usorius', 'vegele', 'samas', 'upetakis', 'kirslys', 'kita'];
const NAMES = ['Lydeka', 'Ešerys', 'Starkis', 'Karšis', 'Kuoja', 'Karpis', 'Lynas', 'Šapalas', 'Salatis', 'Strepetys',
  'Plakis', 'Raudė', 'Karosas', 'Ūsorius', 'Vėgėlė', 'Šamas', 'Upėtakis', 'Kiršlys', 'Kita'];
const KEY = 'fake-sb-db';
const SESSION = 'fake-sb-session';
const H = 3600e3;

const calls = (window.__sbCalls = window.__sbCalls || []);
const log = (kind, detail) => calls.push({ kind, ...detail });
const iso = (off) => new Date(Date.now() + off).toISOString();
// 0011: registracija atvira iki pabaigos arba late_join_minutes po starto.
const regOpen = (t) => Date.now() < new Date(t.ends_at)
  && (t.late_join_minutes == null || Date.now() < new Date(t.starts_at).getTime() + t.late_join_minutes * 60e3);

function seed() {
  const other = '00000000-0000-4000-8000-0000000000aa';
  return {
    species: SPECIES.map((code, i) => ({ id: i + 1, code, name_lt: NAMES[i] })),
    profiles: [{ id: other, nickname: 'Kitas_Zvejys', region: 'Vilniaus r.', trust_score: 50, is_admin: false, created_at: iso(-90 * 24 * H) }],
    tournaments: [{
      id: 'tttttttt-0000-4000-8000-000000000001', organizer_id: other, title: 'Testo lydekų taurė',
      description: null, format: 'top_n_sum', top_n: 3, min_length_mm: 400, visibility: 'public', fee_cents: 0,
      starts_at: iso(-24 * H), ends_at: iso(48 * H), created_at: iso(-48 * H),
      prizes: null, sponsor_name: null, sponsor_url: null, leaderboard_hidden: false, invite_code: 'aaaaaaaaaa'
    }, {
      id: 'tttttttt-0000-4000-8000-000000000002', organizer_id: other, title: 'Slaptas klubo turnyras',
      description: null, format: 'biggest', top_n: 3, min_length_mm: 0, visibility: 'private', fee_cents: 0,
      starts_at: iso(-2 * H), ends_at: iso(72 * H), created_at: iso(-48 * H),
      prizes: 'Taurė', sponsor_name: null, sponsor_url: null, leaderboard_hidden: true, invite_code: 'b1b2b3b4b5'
    }, {
      id: 'tttttttt-0000-4000-8000-000000000003', organizer_id: other, title: 'Uždaros registracijos turnyras',
      description: null, format: 'biggest', top_n: 3, min_length_mm: 0, visibility: 'public', fee_cents: 0,
      starts_at: iso(-3 * H), ends_at: iso(48 * H), created_at: iso(-48 * H), late_join_minutes: 60,
      prizes: null, sponsor_name: null, sponsor_url: null, leaderboard_hidden: false, invite_code: 'c1c2c3c4c5'
    }],
    tournament_species: [{ tournament_id: 'tttttttt-0000-4000-8000-000000000001', species_id: 1 }],
    user_bans: [],
    push_subscriptions: [],
    catch_checks: [],
    catch_spots: [],
    spot_settings: [],
    notification_settings: [],
    follows: [],
    clubs: [{ id: 'clclclcl-0000-4000-8000-000000000001', name: 'Testo klubas', region: 'Vilniaus r.', description: 'Uždaras klubas',
      owner_id: other, open: false, invite_code: 'd1d2d3d4d5', created_at: iso(-30 * 24 * H) }],
    club_members: [{ club_id: 'clclclcl-0000-4000-8000-000000000001', user_id: other, role: 'owner', joined_at: iso(-30 * 24 * H) }],
    leagues: [],
    tournament_divisions: [],
    entries: [{ tournament_id: 'tttttttt-0000-4000-8000-000000000001', user_id: other, joined_at: iso(-20 * H) },
      { tournament_id: 'tttttttt-0000-4000-8000-000000000002', user_id: other, joined_at: iso(-20 * H) }],
    catches: [{
      id: 'cccccccc-0000-4000-8000-000000000001', user_id: other, client_id: 'cccccccc-0000-4000-8000-000000000001',
      species_id: 1, length_mm: 700, captured_at_device: iso(-10 * H), received_at: iso(-10 * H),
      photo_path: `${other}/x.jpg`, photo_sha256: 'f'.repeat(64), status: 'approved', reject_reason: null, created_at: iso(-10 * H)
    }, {
      id: 'cccccccc-0000-4000-8000-000000000002', user_id: other, client_id: 'cccccccc-0000-4000-8000-000000000002',
      species_id: 3, length_mm: 650, captured_at_device: iso(-1 * H), received_at: iso(-1 * H),
      photo_path: `${other}/y.jpg`, photo_sha256: 'e'.repeat(64), status: 'approved', reject_reason: null, created_at: iso(-1 * H)
    }],
    catch_locations: [],
    disputes: [],
    tournament_sponsors: [],
    catch_reports: [],
    blank_trips: [],
    tournament_announcements: []
  };
}

let db;
try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
if (!db) db = seed();
const save = () => localStorage.setItem(KEY, JSON.stringify(db));
save();
window.__fakeDb = { get: () => db, save, set: (fn) => { fn(db); save(); } };

const blobs = new Map();
const failNext = (window.__sbFail = window.__sbFail || {});
const uuid = () => crypto.randomUUID();
const err = (code, message, extra = {}) => ({ code, message, ...extra });

function session() {
  try { return JSON.parse(localStorage.getItem(SESSION)); } catch { return null; }
}
const uid = () => session()?.user?.id ?? null;
// 0014: rolės. is_admin = turi bent vieną rolę; konkrečios teisės – pagal roles.
const myRoles = () => {
  const p = db.profiles.find((x) => x.id === uid());
  return p ? (Array.isArray(p.roles) ? p.roles : (p.is_admin ? ['owner'] : [])) : [];
};
const isAdmin = () => myRoles().length > 0;
const PERMS = { owner: ['review', 'disputes', 'ban', 'roles'], admin: ['review', 'disputes', 'ban'], moderator: ['review'], judge: ['disputes'], guard: ['ban'] };
const hasPerm = (perm) => myRoles().some((r) => PERMS[r]?.includes(perm));
// 0013: aktyvus blokavimas
db.user_bans ||= [];
db.push_subscriptions ||= [];
db.catch_checks ||= [];
db.catch_spots ||= [];
db.spot_settings ||= [];
db.notification_settings ||= [];
db.follows ||= [];
db.clubs ||= [];
db.club_members ||= [];
db.leagues ||= [];
db.tournament_divisions ||= [];
db.user_presence ||= [];
db.user_devices ||= [];
const LEAGUE_NAME = /^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_"„“()-]+$/;
const DIV_NAME = /^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_+()-]+$/;
const regOrSoon = (t) => Date.now() < new Date(t.starts_at) || regOpen(t);
const speciesPctOf = (tid) => Object.fromEntries(db.tournament_species.filter((x) => x.tournament_id === tid).map((x) => [x.species_id, x.points_pct ?? 100]));
const CLUB_NAME = /^[A-Za-z0-9ĄČĘĖĮŠŲŪŽąčęėįšųūž .,_"„“-]+$/;
const FAKE_VAPID = 'B' + 'Q'.repeat(86);
const bannedId = (id) => db.user_bans.some((b) => b.user_id === id && (!b.until || Date.parse(b.until) > Date.now()));
const BAN_INSERT = ['catches', 'entries', 'tournaments', 'catch_reports', 'tournament_announcements', 'disputes'];

// Paprastas RLS atitikmuo – kad testai pagautų užklausas, kurios tikroje bazėje grąžintų ne tai.
function visible(table, row) {
  if (table === 'tournaments') {
    return row.visibility === 'public' || row.organizer_id === uid()
      || db.entries.some((e) => e.tournament_id === row.id && e.user_id === uid());
  }
  if (table === 'disputes') return row.user_id === uid() || hasPerm('disputes');
  if (table === 'catch_reports') return row.reporter_id === uid() || hasPerm('disputes');
  if (table === 'user_bans') return !!uid() && (row.user_id === uid() || hasPerm('ban'));
  if (table === 'push_subscriptions' || table === 'notification_settings') return !!uid() && row.user_id === uid();
  if (table === 'catch_checks') return !!uid() && (row.user_id === uid() || hasPerm('review'));
  if (table === 'catch_spots' || table === 'spot_settings') return !!uid() && row.user_id === uid();
  if (table === 'blank_trips') return row.user_id === uid();
  if (table === 'follows') return !!uid() && (row.follower_id === uid() || row.followee_id === uid());
  if (table === 'user_devices' || table === 'user_presence') return !!uid() && row.user_id === uid();
  if (table === 'tournament_announcements') {
    const t = db.tournaments.find((x) => x.id === row.tournament_id);
    return !!t && visible('tournaments', t);
  }
  if (table === 'catches') return row.user_id === uid() || row.status === 'approved' || isAdmin();
  if (table === 'catch_locations') return hasPerm('review') || db.catches.some((c) => c.id === row.catch_id && c.user_id === uid());
  return true;
}

function embed(table, row, spec) {
  const out = {};
  for (const part of spec) {
    if (table === 'tournaments' && part.startsWith('tournament_species(')) {
      out.tournament_species = db.tournament_species.filter((x) => x.tournament_id === row.id)
        .map((x) => pick({ points_pct: 100, ...x }, part.slice(19, -1).split(',').map((c) => c.trim())));
    } else if (table === 'tournaments' && part.startsWith('tournament_divisions(')) {
      out.tournament_divisions = db.tournament_divisions.filter((x) => x.tournament_id === row.id)
        .map((x) => pick(x, part.slice(21, -1).split(',').map((c) => c.trim())));
    } else if (table === 'tournaments' && part.startsWith('leagues(')) {
      const l = db.leagues.find((x) => x.id === row.league_id);
      out.leagues = l ? pick(l, part.slice(8, -1).split(',').map((c) => c.trim())) : null;
    } else if (table === 'leagues' && part === 'tournaments(count)') {
      out.tournaments = [{ count: db.tournaments.filter((t) => t.league_id === row.id && visible('tournaments', t)).length }];
    } else if (table === 'tournaments' && part.startsWith('tournament_sponsors(')) {
      out.tournament_sponsors = (db.tournament_sponsors || []).filter((x) => x.tournament_id === row.id)
        .map((x) => pick(x, part.slice(20, -1).split(',').map((c) => c.trim())));
    } else if (table === 'tournaments' && part === 'tournament_announcements(created_at)') {
      out.tournament_announcements = db.tournament_announcements.filter((a) => a.tournament_id === row.id && visible('tournament_announcements', a))
        .map((a) => ({ created_at: a.created_at }));
    } else if (table === 'catch_reports' && part.startsWith('catches(')) {
      const c = db.catches.find((x) => x.id === row.catch_id);
      out.catches = c ? pick(c, part.slice(8, -1).split(',').map((x) => x.trim())) : null;
    } else if (table === 'catch_reports' && part.startsWith('profiles!catch_reports_reporter_id_fkey(')) {
      const p = db.profiles.find((x) => x.id === row.reporter_id);
      out.profiles = p ? { nickname: p.nickname } : null;
    } else if (table === 'tournaments' && part === 'entries(count)') {
      out.entries = [{ count: db.entries.filter((e) => e.tournament_id === row.id).length }];
    } else if (table === 'entries' && part.startsWith('profiles(')) {
      const p = db.profiles.find((x) => x.id === row.user_id);
      out.profiles = p ? { id: p.id, nickname: p.nickname, region: p.region } : null;
    } else if (table === 'catches' && part.startsWith('profiles!catches_user_id_fkey(')) {
      const p = db.profiles.find((x) => x.id === row.user_id);
      out.profiles = p ? { nickname: p.nickname, trust_score: p.trust_score, region: p.region } : null;
    } else if (table === 'disputes' && part.startsWith('catches(')) {
      const c = db.catches.find((x) => x.id === row.catch_id);
      out.catches = c ? pick(c, part.slice(8, -1).split(',').map((x) => x.trim())) : null;
    } else if (table === 'disputes' && part.startsWith('profiles!disputes_user_id_fkey(')) {
      const p = db.profiles.find((x) => x.id === row.user_id);
      out.profiles = p ? { nickname: p.nickname, trust_score: p.trust_score } : null;
    } else if (table === 'catch_checks' && part.startsWith('catches(')) {
      const c = db.catches.find((x) => x.id === row.catch_id);
      out.catches = c ? pick(c, part.slice(8, -1).split(',').map((x) => x.trim())) : null;
    } else if (table === 'catch_checks' && part.startsWith('profiles!catch_checks_user_id_fkey(')) {
      const p = db.profiles.find((x) => x.id === row.user_id);
      out.profiles = p ? { nickname: p.nickname } : null;
    } else if (table === 'user_bans' && part.startsWith('profiles!user_bans_user_id_fkey(')) {
      const p = db.profiles.find((x) => x.id === row.user_id);
      out.profiles = p ? { nickname: p.nickname } : null;
    } else if (table === 'clubs' && part === 'club_members(count)') {
      out.club_members = [{ count: db.club_members.filter((m) => m.club_id === row.id).length }];
    } else if (table === 'clubs' && part.startsWith('club_members(')) {
      const inner = splitSelect(part.slice(13, -1));
      out.club_members = db.club_members.filter((m) => m.club_id === row.id)
        .map((m) => ({ ...pick(m, inner.cols), ...embed('club_members', m, inner.embeds) }));
    } else if (table === 'club_members' && part.startsWith('profiles(')) {
      const p = db.profiles.find((x) => x.id === row.user_id);
      out.profiles = p ? pick(p, part.slice(9, -1).split(',').map((c) => c.trim())) : null;
    } else if (table === 'club_members' && part.startsWith('clubs(')) {
      const c = db.clubs.find((x) => x.id === row.club_id);
      out.clubs = c ? pick(c, part.slice(6, -1).split(',').map((x) => x.trim())) : null;
    } else if (table === 'catches' && part.startsWith('catch_spots(')) {
      const sp = db.catch_spots.find((x) => x.catch_id === row.id);
      out.catch_spots = sp && visible('catch_spots', sp) ? { lat: sp.lat, lng: sp.lng, accuracy_m: sp.accuracy_m } : null;
    } else if (table === 'catches' && part.startsWith('catch_locations(')) {
      const l = db.catch_locations.find((x) => x.catch_id === row.id);
      out.catch_locations = l && visible('catch_locations', l) ? { lat: l.lat, lng: l.lng, accuracy_m: l.accuracy_m } : null;
    } else {
      throw new Error(`fake: nepalaikomas embed ${table}.${part}`);
    }
  }
  return out;
}

function pick(row, cols) {
  if (cols.includes('*')) return { ...row };
  const o = {};
  cols.forEach((c) => { o[c] = row[c]; });
  return o;
}

function splitSelect(sel) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel || '*') {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return { cols: parts.filter((p) => !p.includes('(')), embeds: parts.filter((p) => p.includes('(')) };
}

const beforeStart = (t) => t && Date.now() < new Date(t.starts_at).getTime();
function canEditTournament(id) {
  const t = db.tournaments.find((x) => x.id === id);
  return !!t && t.organizer_id === uid() && (beforeStart(t) || Date.now() - new Date(t.created_at) < 10 * 60e3);
}
// RLS atitikmuo rašymui: eilutės, kurių taisyklė neleidžia, tiesiog nepaliečiamos (kaip PostgREST).
function writable(table, row) {
  if (table === 'tournaments') return row.organizer_id === uid() && beforeStart(row);
  if (table === 'tournament_species' || table === 'tournament_sponsors') return canEditTournament(row.tournament_id);
  if (table === 'tournament_divisions') { const t = db.tournaments.find((x) => x.id === row.tournament_id); return !!t && t.organizer_id === uid() && beforeStart(t); }
  if (table === 'leagues') return row.owner_id === uid();
  if (table === 'entries') return row.user_id === uid() && beforeStart(db.tournaments.find((x) => x.id === row.tournament_id));
  if (table === 'catches') return row.user_id === uid();
  if (table === 'profiles') return row.id === uid();
  if (table === 'blank_trips') return row.user_id === uid();
  if (table === 'tournament_announcements') return row.author_id === uid();
  if (table === 'notification_settings') return row.user_id === uid();
  if (table === 'catch_spots') return row.user_id === uid();
  if (table === 'follows') return row.follower_id === uid();
  if (table === 'clubs') return row.owner_id === uid();
  if (table === 'club_members') {
    return row.role !== 'owner' && (row.user_id === uid() || db.clubs.some((c) => c.id === row.club_id && c.owner_id === uid()));
  }
  return false;
}

class Query {
  constructor(table) {
    this.table = table;
    this.filters = [];
    this.op = 'select';
    this.sel = '*';
    this.opts = {};
    this.mode = 'many';
    this.returning = false;
    this.sort = null;
  }
  select(sel = '*', opts = {}) {
    if (this.op === 'select') { this.sel = sel; this.opts = opts; } else { this.returning = true; this.sel = sel; }
    return this;
  }
  insert(rows) { this.op = 'insert'; this.rows = Array.isArray(rows) ? rows : [rows]; return this; }
  update(obj) { this.op = 'update'; this.patch = obj; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(col, val) { this.filters.push([col, val]); return this; }
  in(col, vals) { this.filters.push([col, { in: vals }]); return this; }
  order(col, o = {}) { this.sort = [col, o.ascending !== false]; return this; }
  limit(n) { this.max = n; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }

  matches(row) { return this.filters.every(([c, v]) => (v && typeof v === 'object' && Array.isArray(v.in) ? v.in.includes(row[c]) : row[c] === v)); }

  run() {
    log('from', { table: this.table, op: this.op, sel: this.sel, filters: this.filters, rows: this.rows, patch: this.patch });
    // Stulpelių teisės (0008): masalo ir pastabų, taip pat „*“ iš catches skaityti negalima – kaip tikroje bazėje.
    if (this.op === 'select' || this.returning) {
      const { cols, embeds } = splitSelect(this.sel);
      const catchCols = [
        ...(this.table === 'catches' ? (cols.length ? cols : ['*']) : []),
        ...embeds.filter((e) => e.startsWith('catches(')).flatMap((e) => e.slice(8, -1).split(',').map((x) => x.trim()))
      ];
      if (catchCols.some((c) => c === '*' || c === 'bait' || c === 'notes')) {
        return { data: null, error: err('42501', 'permission denied for table catches') };
      }
      // 0019: clubs.invite_code skaityti negalima (tik per club_invite_code()).
      const clubCols = [
        ...(this.table === 'clubs' ? (cols.length ? cols : ['*']) : []),
        ...embeds.filter((e) => e.startsWith('clubs(')).flatMap((e) => e.slice(6, -1).split(',').map((x) => x.trim()))
      ];
      if (clubCols.some((c) => c === '*' || c === 'invite_code')) {
        return { data: null, error: err('42501', 'permission denied for table clubs') };
      }
    }
    const t = db[this.table];
    if (!t) return { data: null, error: err('42P01', `relation ${this.table} does not exist`) };
    let data;
    if (this.op === 'insert') {
      if (!uid()) return { data: null, error: err('42501', 'new row violates row-level security policy') };
      if (this.table === 'user_bans' || this.table === 'push_subscriptions' || this.table === 'catch_checks') return { data: null, error: err('42501', `permission denied for table ${this.table}`) };
      if (this.table === 'notification_settings') {
        if (this.rows.some((r) => r.user_id && r.user_id !== uid())) return { data: null, error: err('42501', 'rls notification_settings') };
        if (db.notification_settings.some((x) => x.user_id === uid())) return { data: null, error: err('23505', 'duplicate key notification_settings_pkey') };
        this.rows = this.rows.map((r) => ({ ...r, user_id: uid() }));
      }
      if (this.table === 'club_members') return { data: null, error: err('42501', 'permission denied for table club_members') };
      if (BAN_INSERT.concat(['follows', 'clubs', 'leagues']).includes(this.table) && bannedId(uid())) {
        return { data: null, error: err('42501', `new row violates row-level security policy for table "${this.table}"`) };
      }
      const inserted = [];
      for (const r of this.rows) {
        const row = { ...r };
        if (this.table === 'catches') {
          if (failNext.catchInsert) { failNext.catchInsert--; return { data: null, error: err('', 'TypeError: Failed to fetch') }; }
          if (db.catches.some((c) => c.user_id === uid() && c.client_id === row.client_id)) {
            return { data: null, error: err('23505', 'duplicate key value violates unique constraint "catches_user_id_client_id_key"') };
          }
          if (db.catches.some((c) => c.photo_sha256 === row.photo_sha256)) {
            return { data: null, error: err('23505', 'duplicate key value violates unique constraint "catches_photo_sha256_uniq"', { details: 'Key (photo_sha256)=(...) already exists.' }) };
          }
          if (row.photo_path.split('/')[0] !== uid()) return { data: null, error: err('P0001', 'photo_path must be inside the uploader\'s own folder') };
          if (db.catches.filter((c) => c.user_id === uid() && Date.now() - new Date(c.received_at) < 24 * H).length >= 50) {
            return { data: null, error: err('P0001', 'catch_limit', { hint: 'Ne daugiau kaip 50 laimikių per parą' }) };
          }
          if (row.clock_offset_s != null && !(Number.isInteger(row.clock_offset_s) && Math.abs(row.clock_offset_s) <= 31536000)) return { data: null, error: err('23514', 'catches_clock_offset_s_check') };
          const serverNow = Date.now() + (window.__serverOffsetMs || 0);
          row.send_offset_s = row.sent_at_device ? Math.round((serverNow - Date.parse(row.sent_at_device)) / 1000) : null;
          Object.assign(row, { id: uuid(), user_id: uid(), status: 'pending', reject_reason: null, received_at: new Date(serverNow).toISOString(), created_at: new Date(serverNow).toISOString() });
        }
        if (this.table === 'follows') {
          if (row.follower_id && row.follower_id !== uid()) return { data: null, error: err('42501', 'new row violates row-level security policy for table "follows"') };
          row.follower_id = uid();
          if (row.followee_id === uid()) return { data: null, error: err('23514', 'new row violates check constraint "follows_check"') };
          if (!db.profiles.some((p) => p.id === row.followee_id)) return { data: null, error: err('23503', 'insert or update on table "follows" violates foreign key constraint') };
          if (db.follows.some((f) => f.follower_id === uid() && f.followee_id === row.followee_id)) return { data: null, error: err('23505', 'duplicate key value violates unique constraint "follows_pkey"') };
          if (db.follows.filter((f) => f.follower_id === uid()).length >= 500) return { data: null, error: err('P0001', 'follow_limit') };
          row.created_at = new Date().toISOString();
        }
        if (this.table === 'clubs') {
          if (row.owner_id && row.owner_id !== uid()) return { data: null, error: err('42501', 'new row violates row-level security policy for table "clubs"') };
          if ('invite_code' in row) return { data: null, error: err('42501', 'permission denied for table clubs') };
          const name = String(row.name || '').trim();
          if (name.length < 3 || name.length > 40 || !CLUB_NAME.test(row.name || '')) return { data: null, error: err('23514', 'new row for relation "clubs" violates check constraint "clubs_name_check"') };
          if ((row.description || '').length > 300 || (row.region || '').length > 40) return { data: null, error: err('23514', 'check constraint clubs') };
          if (db.clubs.filter((c) => c.owner_id === uid()).length >= 3) return { data: null, error: err('P0001', 'club_limit') };
          if (db.clubs.some((c) => c.name.toLowerCase() === name.toLowerCase())) return { data: null, error: err('23505', 'duplicate key value violates unique constraint "clubs_name_uniq"') };
          Object.assign(row, { id: uuid(), name, owner_id: uid(), open: row.open !== false, region: row.region ?? null, description: row.description ?? null,
            invite_code: uuid().replace(/-/g, '').slice(0, 10), created_at: new Date().toISOString() });
          db.club_members.push({ club_id: row.id, user_id: uid(), role: 'owner', joined_at: row.created_at });
        }
        if (this.table === 'leagues') {
          if (row.owner_id && row.owner_id !== uid()) return { data: null, error: err('42501', 'new row violates row-level security policy for table "leagues"') };
          const name = String(row.name || '').trim();
          if (name.length < 3 || name.length > 60 || !LEAGUE_NAME.test(row.name || '') || !(row.season >= 2024 && row.season <= 2100)) return { data: null, error: err('23514', 'new row for relation "leagues" violates check constraint "leagues_name_check"') };
          if (db.leagues.filter((l) => l.owner_id === uid()).length >= 5) return { data: null, error: err('P0001', 'league_limit') };
          if (db.leagues.some((l) => l.season === row.season && l.name.toLowerCase() === name.toLowerCase())) return { data: null, error: err('23505', 'duplicate key value violates unique constraint "leagues_name_uniq"') };
          Object.assign(row, { id: uuid(), name, owner_id: uid(), description: row.description ?? null, created_at: new Date().toISOString() });
        }
        if (this.table === 'tournament_divisions') {
          if (!writable('tournament_divisions', row)) return { data: null, error: err('42501', 'new row violates row-level security policy for table "tournament_divisions"') };
          const name = String(row.name || '').trim();
          if (db.tournament_divisions.filter((d) => d.tournament_id === row.tournament_id).length >= 8) return { data: null, error: err('P0001', 'division_limit') };
          if (name.length < 2 || name.length > 30 || !DIV_NAME.test(row.name || '')) return { data: null, error: err('23514', 'check constraint tournament_divisions_name_check') };
          if (db.tournament_divisions.some((d) => d.tournament_id === row.tournament_id && d.name.toLowerCase() === name.toLowerCase())) return { data: null, error: err('23505', 'duplicate key value violates unique constraint "tournament_divisions_name_uniq"') };
          Object.assign(row, { id: uuid(), name, sort: row.sort ?? 0 });
        }
        if (this.table === 'tournament_species' && row.points_pct !== undefined && !(row.points_pct >= 10 && row.points_pct <= 1000)) {
          return { data: null, error: err('23514', 'check constraint tournament_species_points_pct_check') };
        }
        if (this.table === 'catch_locations') {
          if (!db.catches.some((c) => c.id === row.catch_id && c.user_id === uid())) return { data: null, error: err('42501', 'rls') };
          if (db.catch_locations.some((x) => x.catch_id === row.catch_id)) return { data: null, error: err('23505', 'duplicate key catch_locations_pkey') };
        }
        if (this.table === 'entries') {
          row.user_id = row.user_id ?? uid();
          if (db.entries.some((e) => e.tournament_id === row.tournament_id && e.user_id === row.user_id)) {
            return { data: null, error: err('23505', 'duplicate key entries_pkey') };
          }
          const tt = db.tournaments.find((x) => x.id === row.tournament_id);
          if (!tt || Date.now() >= new Date(tt.ends_at) || (tt.organizer_id !== uid() && (tt.visibility !== 'public' || !regOpen(tt)))) {
            return { data: null, error: err('42501', 'new row violates row-level security policy for table "entries"') };
          }
          row.joined_at = new Date().toISOString();
          if (row.club_id && !db.club_members.some((m) => m.club_id === row.club_id && m.user_id === row.user_id)) row.club_id = null;
          row.club_id ??= null;
          if (row.division_id && !db.tournament_divisions.some((d) => d.id === row.division_id && d.tournament_id === row.tournament_id)) row.division_id = null;
          row.division_id ??= null;
        }
        if (this.table === 'tournaments') {
          if (db.tournaments.filter((x) => x.organizer_id === uid() && Date.now() - new Date(x.created_at) < 24 * H).length >= 10) {
            return { data: null, error: err('P0001', 'tournament_limit') };
          }
          if (row.sponsor_url && !/^https:\/\/[^\s<>"']{3,200}$/.test(row.sponsor_url)) return { data: null, error: err('23514', 'check constraint sponsor_url') };
          Object.assign(row, { id: uuid(), visibility: row.visibility || 'public', leaderboard_hidden: !!row.leaderboard_hidden,
            fee_cents: 0, created_at: new Date().toISOString(), invite_code: uuid().replace(/-/g, '').slice(0, 10) });
          if (!['biggest', 'top_n_sum', 'species_points', 'duels'].includes(row.format)) return { data: null, error: err('23514', 'tournaments_format_check') };
          if (row.league_id && !db.leagues.some((l) => l.id === row.league_id && l.owner_id === uid())) return { data: null, error: err('P0001', 'league_owner') };
          if (row.format === 'duels') Object.assign(row, { late_join_minutes: 0, leaderboard_hidden: false, team_mode: false });
        }
        if (this.table === 'catch_reports') {
          const c = db.catches.find((x) => x.id === row.catch_id);
          if (!c || c.status !== 'approved' || c.user_id === uid()) return { data: null, error: err('42501', 'new row violates row-level security policy for table "catch_reports"') };
          if (db.catch_reports.some((x) => x.catch_id === row.catch_id && x.reporter_id === uid())) return { data: null, error: err('23505', 'duplicate key catch_reports_catch_id_reporter_id_key') };
          Object.assign(row, { id: uuid(), reporter_id: uid(), status: 'open', created_at: new Date().toISOString() });
        }
        if (this.table === 'blank_trips') {
          if (row.trip_date > new Date(Date.now() + 86400e3).toISOString().slice(0, 10)) return { data: null, error: err('P0001', 'trip_in_future') };
          if (row.hours !== null && row.hours !== undefined && !(row.hours > 0 && row.hours <= 24)) return { data: null, error: err('23514', 'check constraint blank_trips_hours') };
          Object.assign(row, { id: uuid(), user_id: uid(), created_at: new Date().toISOString() });
        }
        if (this.table === 'tournament_announcements') {
          const t = db.tournaments.find((x) => x.id === row.tournament_id);
          if (!t || t.organizer_id !== uid()) return { data: null, error: err('42501', 'new row violates row-level security policy for table "tournament_announcements"') };
          Object.assign(row, { id: uuid(), author_id: uid(), message: String(row.message).trim(), created_at: new Date().toISOString() });
        }
        if (this.table === 'tournament_sponsors') {
          if (!canEditTournament(row.tournament_id)) return { data: null, error: err('42501', 'new row violates row-level security policy for table "tournament_sponsors"') };
          if (row.url && !/^https:\/\/[^\s<>"']{3,200}$/.test(row.url)) return { data: null, error: err('23514', 'check constraint tournament_sponsors_url') };
          if (db.tournament_sponsors.filter((x) => x.tournament_id === row.tournament_id).length >= 10) return { data: null, error: err('P0001', 'sponsor_limit') };
          Object.assign(row, { id: uuid(), name: String(row.name).trim(), created_at: new Date().toISOString() });
        }
        if (this.table === 'tournaments' && row.prize_fund_cents && !Array.isArray(row.prize_split)) {
          return { data: null, error: err('23514', 'tournaments_prize_split_required') };
        }
        if (this.table === 'tournament_species' && !canEditTournament(row.tournament_id)) {
          return { data: null, error: err('42501', 'new row violates row-level security policy for table "tournament_species"') };
        }
        if (this.table === 'disputes') {
          const c = db.catches.find((x) => x.id === row.catch_id);
          if (!c || c.user_id !== uid() || c.status !== 'rejected') return { data: null, error: err('42501', 'rls disputes') };
          if (db.disputes.some((d) => d.catch_id === row.catch_id)) return { data: null, error: err('23505', 'duplicate key disputes_catch_id_key') };
          const msg = String(row.message || '').trim();
          if (msg.length < 3 || msg.length > 500) return { data: null, error: err('23514', 'check constraint disputes_message') };
          Object.assign(row, { id: uuid(), user_id: uid(), message: msg, status: 'open', resolution: null, resolved_by: null, resolved_at: null, created_at: new Date().toISOString() });
        }
        t.push(row);
        inserted.push(row);
      }
      save();
      data = inserted;
    } else if (this.op === 'update') {
      if (this.table === 'user_bans') return { data: null, error: err('42501', 'permission denied for table user_bans') };
      if ((this.table === 'profiles' || this.table === 'tournaments') && bannedId(uid())) return { data: [], error: null };
      if (this.table === 'profiles') {
        const allowed = ['nickname', 'region'];
        if (Object.keys(this.patch).some((k) => !allowed.includes(k))) return { data: null, error: err('42501', 'permission denied') };
        if (this.patch.nickname && db.profiles.some((p) => p.id !== uid() && p.nickname === this.patch.nickname)) {
          return { data: null, error: err('23505', 'duplicate nickname') };
        }
      }
      if (this.table === 'catches') {
        if (Object.keys(this.patch).some((k) => !['bait', 'notes'].includes(k))) return { data: null, error: err('42501', 'permission denied for table catches') };
        if ((this.patch.bait || '').length > 80 || (this.patch.notes || '').length > 500) return { data: null, error: err('23514', 'check constraint') };
      }
      if (this.table === 'disputes') return { data: null, error: err('42501', 'permission denied for table disputes') };
      if (['follows', 'club_members'].includes(this.table)) return { data: null, error: err('42501', `permission denied for table ${this.table}`) };
      if (this.table === 'leagues' && Object.keys(this.patch).some((k) => !['name', 'description'].includes(k))) return { data: null, error: err('42501', 'permission denied for table leagues') };
      if (this.table === 'tournaments') {
        if (this.patch.league_id && !db.leagues.some((l) => l.id === this.patch.league_id && l.owner_id === uid())) return { data: null, error: err('P0001', 'league_owner') };
        if (this.patch.format && !['biggest', 'top_n_sum', 'species_points', 'duels'].includes(this.patch.format)) return { data: null, error: err('23514', 'tournaments_format_check') };
      }
      if (this.table === 'clubs') {
        if (Object.keys(this.patch).some((k) => !['name', 'region', 'description', 'open'].includes(k))) return { data: null, error: err('42501', 'permission denied for table clubs') };
        if ('name' in this.patch) {
          const name = String(this.patch.name || '').trim();
          if (name.length < 3 || name.length > 40 || !CLUB_NAME.test(this.patch.name)) return { data: null, error: err('23514', 'check constraint clubs_name_check') };
          const target = t.filter((r) => this.matches(r)).map((r) => r.id);
          if (db.clubs.some((c) => !target.includes(c.id) && c.name.toLowerCase() === name.toLowerCase())) return { data: null, error: err('23505', 'duplicate key value violates unique constraint "clubs_name_uniq"') };
        }
      }
      data = t.filter((r) => this.matches(r) && writable(this.table, r));
      data.forEach((r) => {
        Object.assign(r, this.patch);
        if (this.table === 'tournaments' && r.format === 'duels') Object.assign(r, { late_join_minutes: 0, leaderboard_hidden: false, team_mode: false });
      });
      save();
    } else if (this.op === 'delete') {
      if (this.table === 'catches' || this.table === 'disputes' || this.table === 'user_bans') return { data: null, error: err('42501', `permission denied for table ${this.table}`) };
      data = t.filter((r) => this.matches(r) && writable(this.table, r));
      db[this.table] = t.filter((r) => !data.includes(r));
      if (this.table === 'tournaments') {
        const gone = new Set(data.map((r) => r.id));
        db.tournament_species = db.tournament_species.filter((x) => !gone.has(x.tournament_id));
        db.tournament_sponsors = db.tournament_sponsors.filter((x) => !gone.has(x.tournament_id));
        db.entries = db.entries.filter((x) => !gone.has(x.tournament_id));
        db.tournament_divisions = db.tournament_divisions.filter((x) => !gone.has(x.tournament_id));
      }
      if (this.table === 'tournament_divisions') {
        const gone = new Set(data.map((r) => r.id));
        db.entries.forEach((e) => { if (gone.has(e.division_id)) e.division_id = null; });
      }
      if (this.table === 'leagues') {
        const gone = new Set(data.map((r) => r.id));
        db.tournaments.forEach((x) => { if (gone.has(x.league_id)) x.league_id = null; });
      }
      if (this.table === 'clubs') {
        const gone = new Set(data.map((r) => r.id));
        db.club_members = db.club_members.filter((m) => !gone.has(m.club_id));
        db.entries.forEach((e) => { if (gone.has(e.club_id)) e.club_id = null; });
      }
      save();
    } else {
      data = t.filter((r) => this.matches(r) && visible(this.table, r));
      if (this.sort) {
        const [c, asc] = this.sort;
        data = data.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      }
      if (this.max != null) data = data.slice(0, this.max);
    }
    if (this.op === 'select' && this.opts.head) return { data: null, count: data.length, error: null };
    if (this.op === 'select' || this.returning) {
      const { cols, embeds } = splitSelect(this.sel);
      data = data.map((r) => ({ ...pick(r, cols.length ? cols : ['*']), ...embed(this.table, r, embeds) }));
    } else if (this.op !== 'select') {
      data = null;
    }
    if (this.mode === 'single') {
      if (!data || data.length !== 1) return { data: null, error: err('PGRST116', 'JSON object requested, multiple (or no) rows returned') };
      return { data: data[0], error: null };
    }
    if (this.mode === 'maybe') return { data: data?.[0] ?? null, error: null };
    return { data, error: null };
  }
}

export function createClient(url, key) {
  log('createClient', { url, key });
  const listeners = new Set();
  const emit = (event) => listeners.forEach((cb) => cb(event, session()));
  return {
    auth: {
      async getSession() { return { data: { session: session() }, error: null }; },
      onAuthStateChange(cb) {
        listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      async signInWithOtp(opts) {
        log('signInWithOtp', { email: opts.email, captchaToken: opts.options?.captchaToken ?? null });
        if (window.__requireCaptcha && !opts.options?.captchaToken) return { data: null, error: { message: 'captcha protection: request disallowed (no captcha response)' } };
        return { data: {}, error: null };
      },
      // Google imitacija: sukuria (arba randa) vartotoją ir „grįžta“ į programėlę su #access_token, kaip tikras OAuth.
      async signInWithOAuth({ provider, options }) {
        log('signInWithOAuth', { provider, redirectTo: options?.redirectTo, queryParams: options?.queryParams });
        localStorage.setItem('fake-oauth-call', JSON.stringify({ provider, redirectTo: options?.redirectTo, queryParams: options?.queryParams }));
        if (failNext.oauth) { failNext.oauth--; return { data: null, error: { message: 'Unsupported provider: provider is not enabled' } }; }
        const email = window.__googleEmail || 'google.zvejys@gmail.com';
        let p = db.profiles.find((x) => x.email === email);
        if (!p) {
          const id = uuid();
          p = { id, email, nickname: 'zvejys_' + id.replace(/-/g, '').slice(0, 8), region: null, trust_score: 50, is_admin: false, created_at: new Date().toISOString() };
          db.profiles.push(p);
          save();
        }
        localStorage.setItem(SESSION, JSON.stringify({ access_token: 'google', user: { id: p.id, email } }));
        setTimeout(() => {
          history.replaceState(null, '', options.redirectTo + '#access_token=google&expires_in=3600&token_type=bearer&provider_token=x');
          location.reload();
        }, 0);
        return { data: { provider, url: 'https://accounts.google.com/' }, error: null };
      },
      async verifyOtp({ email, token, type }) {
        log('verifyOtp', { email, token, type });
        if (token !== '123456') return { data: { user: null, session: null }, error: { message: 'Token has expired or is invalid' } };
        let p = db.profiles.find((x) => x.email === email);
        if (!p) {
          const id = uuid();
          p = { id, email, nickname: 'zvejys_' + id.replace(/-/g, '').slice(0, 8), region: null, trust_score: 50, is_admin: false, created_at: new Date().toISOString() };
          db.profiles.push(p);
          save();
        }
        const s = { access_token: 'fake', user: { id: p.id, email } };
        localStorage.setItem(SESSION, JSON.stringify(s));
        setTimeout(() => emit('SIGNED_IN'), 0);
        return { data: { user: s.user, session: s }, error: null };
      },
      async signOut() {
        localStorage.removeItem(SESSION);
        setTimeout(() => emit('SIGNED_OUT'), 0);
        return { error: null };
      }
    },
    from: (table) => new Query(table),
    async rpc(name, args) {
      log('rpc', { name, args });
      if (name === 'review_catch') {
        if (!hasPerm('review')) return { data: null, error: err('P0001', 'not allowed') };
        const c = db.catches.find((x) => x.id === args.p_catch_id);
        if (!c) return { data: null, error: err('P0001', 'catch not found') };
        if (!args.p_approve && !String(args.p_reason || '').trim()) return { data: null, error: err('P0001', 'reject reason is required') };
        c.status = args.p_approve ? 'approved' : 'rejected';
        c.reject_reason = args.p_approve ? null : args.p_reason;
        save();
        return { data: null, error: null };
      }
      if (name === 'my_catch_notes') {
        if (!uid()) return { data: null, error: err('42501', 'permission denied for function my_catch_notes') };
        return { data: db.catches.filter((c) => c.user_id === uid() && (c.bait || c.notes)).map((c) => ({ id: c.id, bait: c.bait ?? null, notes: c.notes ?? null })), error: null };
      }
      if (name === 'get_invite') {
        const t = db.tournaments.find((x) => x.invite_code === String(args.p_code).trim().toLowerCase() && regOpen(x));
        if (!t) return { data: [], error: null };
        const { id, title, format, top_n, min_length_mm, starts_at, ends_at } = t;
        return { data: [{ id, title, format, top_n, min_length_mm, starts_at, ends_at, participants: db.entries.filter((e) => e.tournament_id === id).length }], error: null };
      }
      if (name === 'join_with_invite') {
        if (!uid()) return { data: null, error: err('P0001', 'not allowed') };
        const t = db.tournaments.find((x) => x.invite_code === String(args.p_code).trim().toLowerCase() && Date.now() < new Date(x.ends_at));
        if (!t) return { data: null, error: err('P0001', 'invite_invalid') };
        const already = db.entries.some((e) => e.tournament_id === t.id && e.user_id === uid());
        if (!already && !regOpen(t)) return { data: null, error: err('P0001', 'registration_closed') };
        if (!already) {
          db.entries.push({ tournament_id: t.id, user_id: uid(), joined_at: new Date().toISOString() });
          save();
        }
        return { data: t.id, error: null };
      }
      if (name === 'resolve_dispute') {
        if (!hasPerm('disputes')) return { data: null, error: err('P0001', 'not allowed') };
        const d = db.disputes.find((x) => x.id === args.p_id && x.status === 'open');
        if (!d) return { data: null, error: err('P0001', 'dispute not found') };
        Object.assign(d, { status: args.p_accept ? 'accepted' : 'rejected', resolution: String(args.p_note || '').trim() || null, resolved_by: uid(), resolved_at: new Date().toISOString() });
        if (args.p_accept) {
          const c = db.catches.find((x) => x.id === d.catch_id);
          Object.assign(c, { status: 'approved', reject_reason: null });
          const owner = db.profiles.find((x) => x.id === d.user_id);
          owner.trust_score = Math.min(100, owner.trust_score + 5);
        }
        save();
        return { data: null, error: null };
      }
      if (name === 'resolve_report') {
        if (!hasPerm('disputes')) return { data: null, error: err('P0001', 'not allowed') };
        const r = db.catch_reports.find((x) => x.id === args.p_id && x.status === 'open');
        if (!r) return { data: null, error: err('P0001', 'report not found') };
        if (args.p_uphold && !String(args.p_reason || '').trim()) return { data: null, error: err('P0001', 'reject reason is required') };
        if (args.p_uphold) {
          const c = db.catches.find((x) => x.id === r.catch_id);
          Object.assign(c, { status: 'rejected', reject_reason: String(args.p_reason).trim() });
          const owner = db.profiles.find((x) => x.id === c.user_id);
          owner.trust_score = Math.max(0, owner.trust_score - 5);
        }
        db.catch_reports.filter((x) => x.catch_id === r.catch_id && x.status === 'open')
          .forEach((x) => Object.assign(x, { status: args.p_uphold ? 'upheld' : 'dismissed', resolved_by: uid() }));
        save();
        return { data: null, error: null };
      }
      if (name === 'push_public_key') return { data: FAKE_VAPID, error: null };
      if (name === 'set_keep_spots') {
        if (!uid()) return { data: null, error: err('P0001', 'not allowed') };
        db.spot_settings = db.spot_settings.filter((x) => x.user_id !== uid()).concat([{ user_id: uid(), keep: !!args.p_keep }]);
        let n = 0;
        if (args.p_keep) {
          for (const l of db.catch_locations) {
            const c = db.catches.find((x) => x.id === l.catch_id);
            if (c?.user_id === uid() && !db.catch_spots.some((x) => x.catch_id === l.catch_id)) {
              db.catch_spots.push({ catch_id: l.catch_id, user_id: uid(), lat: l.lat, lng: l.lng, accuracy_m: l.accuracy_m });
              n++;
            }
          }
        }
        save();
        return { data: n, error: null };
      }
      if (name === 'request_catch_check') {
        if (!hasPerm('review')) return { data: null, error: err('P0001', 'not allowed') };
        const c = db.catches.find((x) => x.id === args.p_catch);
        if (!c) return { data: null, error: err('P0001', 'catch not found') };
        if (c.user_id === uid()) return { data: null, error: err('P0001', 'check_own') };
        if (!['pending', 'approved'].includes(c.status)) return { data: null, error: err('P0001', 'check_status') };
        const text = String(args.p_instruction || '').trim();
        if (text.length < 3) return { data: null, error: err('P0001', 'check_instruction') };
        if (!(args.p_hours >= 1 && args.p_hours <= 48)) return { data: null, error: err('P0001', 'check_hours') };
        if (db.catch_checks.some((k) => k.catch_id === c.id && ['open', 'answered'].includes(k.status))) return { data: null, error: err('P0001', 'check_exists') };
        const id = uuid();
        db.catch_checks.push({ id, catch_id: c.id, user_id: c.user_id, requested_by: uid(), instruction: text.slice(0, 200), status: 'open',
          due_at: new Date(Date.now() + args.p_hours * 3600e3).toISOString(), created_at: new Date().toISOString(), photo_path: null, photo_sha256: null, note: null });
        save();
        return { data: id, error: null };
      }
      if (name === 'answer_catch_check') {
        const k = db.catch_checks.find((x) => x.id === args.p_id);
        if (!k || k.user_id !== uid()) return { data: null, error: err('P0001', 'not allowed') };
        if (k.status !== 'open') return { data: null, error: err('P0001', 'check_closed') };
        if (Date.parse(k.due_at) < Date.now()) return { data: null, error: err('P0001', 'check_late') };
        if (args.p_photo_path !== `${uid()}/check-${k.id}.jpg`) return { data: null, error: err('P0001', 'check_path') };
        if (!/^[0-9a-f]{64}$/.test(args.p_sha256 || '')) return { data: null, error: err('P0001', 'check_sha') };
        if (db.catches.some((c) => c.photo_sha256 === args.p_sha256) || db.catch_checks.some((x) => x.photo_sha256 === args.p_sha256)) return { data: null, error: err('P0001', 'check_duplicate') };
        if (!blobs.has(args.p_photo_path)) return { data: null, error: err('P0001', 'check_no_photo') };
        Object.assign(k, { status: 'answered', photo_path: args.p_photo_path, photo_sha256: args.p_sha256, answered_at: new Date().toISOString() });
        save();
        return { data: null, error: null };
      }
      if (name === 'resolve_catch_check') {
        if (!hasPerm('review')) return { data: null, error: err('P0001', 'not allowed') };
        const k = db.catch_checks.find((x) => x.id === args.p_id);
        if (!k) return { data: null, error: err('P0001', 'check not found') };
        if (k.user_id === uid()) return { data: null, error: err('P0001', 'check_own') };
        if (k.status !== 'answered') return { data: null, error: err('P0001', 'check_state') };
        Object.assign(k, { status: args.p_pass ? 'passed' : 'failed', resolved_at: new Date().toISOString(), note: args.p_note || null });
        if (!args.p_pass) {
          const c = db.catches.find((x) => x.id === k.catch_id);
          if (c) Object.assign(c, { status: 'rejected', reject_reason: `Nepraėjo papildomos patikros${args.p_note ? `: ${args.p_note}` : ''}` });
        }
        save();
        return { data: null, error: null };
      }
      if (name === 'random_check_candidate') {
        if (!hasPerm('review')) return { data: null, error: err('P0001', 'not allowed') };
        const c = db.catches.filter((x) => x.status === 'approved' && x.user_id !== uid() && !db.catch_checks.some((k) => k.catch_id === x.id))
          .sort((a, b) => b.length_mm - a.length_mm)[0];
        return { data: c ? c.id : null, error: null };
      }
      if (name === 'save_push_subscription') {
        if (!uid()) return { data: null, error: err('42501', 'permission denied for function save_push_subscription') };
        if (!/^https:\/\//.test(args.p_endpoint || '')) return { data: null, error: err('23514', 'check constraint endpoint') };
        db.push_subscriptions = db.push_subscriptions.filter((s) => s.endpoint !== args.p_endpoint);
        db.push_subscriptions.push({ id: uuid(), user_id: uid(), endpoint: args.p_endpoint, p256dh: args.p_p256dh, auth: args.p_auth, gone_at: null, created_at: new Date().toISOString() });
        save();
        return { data: null, error: null };
      }
      if (name === 'remove_push_subscription') {
        db.push_subscriptions.filter((s) => s.endpoint === args.p_endpoint && s.user_id === uid()).forEach((s) => { s.gone_at = new Date().toISOString(); });
        save();
        return { data: null, error: null };
      }
      if (name === 'send_test_push') {
        if (!uid()) return { data: null, error: err('P0001', 'not allowed') };
        const has = db.push_subscriptions.some((s) => s.user_id === uid() && !s.gone_at);
        if (has) (db.notification_outbox ||= []).push({ user_id: uid(), kind: 'test', title: 'Pranešimai veikia!' });
        save();
        return { data: has, error: null };
      }
      if (name === 'ban_user') {
        if (!hasPerm('ban')) return { data: null, error: err('P0001', 'not allowed') };
        const p = db.profiles.find((x) => x.id === args.p_user);
        const why = String(args.p_reason || '').trim();
        if (args.p_user === uid()) return { data: null, error: err('P0001', 'ban_self') };
        if (!p) return { data: null, error: err('P0001', 'user not found') };
        if (p.is_admin || (p.roles || []).length) return { data: null, error: err('P0001', 'ban_admin') };
        if (args.p_days !== null && (args.p_days < 1 || args.p_days > 3650)) return { data: null, error: err('P0001', 'ban_days') };
        if (why.length < 3) return { data: null, error: err('P0001', 'ban_reason') };
        db.user_bans = db.user_bans.filter((b) => b.user_id !== p.id);
        db.user_bans.push({ user_id: p.id, reason: why.slice(0, 300), banned_by: uid(), created_at: new Date().toISOString(),
          until: args.p_days === null ? null : new Date(Date.now() + args.p_days * 864e5).toISOString() });
        save();
        return { data: null, error: null };
      }
      if (name === 'unban_user') {
        if (!hasPerm('ban')) return { data: null, error: err('P0001', 'not allowed') };
        db.user_bans = db.user_bans.filter((b) => b.user_id !== args.p_user);
        save();
        return { data: null, error: null };
      }
      if (name === 'reset_nickname') {
        if (!hasPerm('ban')) return { data: null, error: err('P0001', 'not allowed') };
        const p = db.profiles.find((x) => x.id === args.p_user);
        if (!p) return { data: null, error: err('P0001', 'user not found') };
        p.nickname = 'zvejys_' + p.id.replace(/-/g, '').slice(0, 8);
        save();
        return { data: p.nickname, error: null };
      }
      if (name === 'set_role' || name === 'set_moderator') {
        if (!hasPerm('roles')) return { data: null, error: err('P0001', 'not allowed') };
        const role = name === 'set_moderator' ? 'admin' : args.p_role;
        const on = name === 'set_moderator' ? !!args.p_admin : !!args.p_on;
        if (!['admin', 'moderator', 'judge', 'guard'].includes(role)) return { data: null, error: err('P0001', 'role_invalid') };
        const p = db.profiles.find((x) => x.nickname.toLowerCase() === String(args.p_nickname).trim().toLowerCase());
        if (!p) return { data: null, error: err('P0001', 'user not found') };
        const roles = Array.isArray(p.roles) ? p.roles : (p.is_admin ? ['owner'] : []);
        if (roles.includes('owner')) return { data: null, error: err('P0001', 'role_owner') };
        if (on && bannedId(p.id)) return { data: null, error: err('P0001', 'role_banned') };
        p.roles = on ? [...new Set([...roles, role])].sort() : roles.filter((x) => x !== role);
        p.is_admin = p.roles.length > 0;
        save();
        return { data: null, error: null };
      }
      if (name === 'begin_account_deletion' || name === 'finish_account_deletion') {
        if (failNext.noDeletion) return { data: null, error: err('PGRST202', `Could not find the function public.${name} without parameters in the schema cache`) };
        if (!uid()) return { data: null, error: err('P0001', 'not allowed') };
        const me = uid();
        const prof = db.profiles.find((x) => x.id === me);
        if (name === 'begin_account_deletion') {
          const mine = new Set(db.tournaments.filter((t) => t.organizer_id === me).map((t) => t.id));
          db.tournaments = db.tournaments.filter((t) => !mine.has(t.id));
          db.tournament_species = db.tournament_species.filter((x) => !mine.has(x.tournament_id));
          const myCatches = new Set(db.catches.filter((c) => c.user_id === me).map((c) => c.id));
          db.catches = db.catches.filter((c) => !myCatches.has(c.id));
          db.catch_locations = db.catch_locations.filter((l) => !myCatches.has(l.catch_id));
          db.disputes = db.disputes.filter((d) => !myCatches.has(d.catch_id));
          db.entries = db.entries.filter((e) => e.user_id !== me && !mine.has(e.tournament_id));
          prof.deleting_at = new Date().toISOString();
        } else {
          if (!prof?.deleting_at || db.catches.some((c) => c.user_id === me)) return { data: null, error: err('P0001', 'not allowed') };
          if ([...blobs.keys()].some((k) => k.startsWith(me + '/'))) return { data: null, error: err('P0001', 'fake: nuotraukos neištrintos') };
          db.profiles = db.profiles.filter((x) => x.id !== me);
          // ON DELETE CASCADE: sekimai, narystės, savi klubai (ir jų narystės); entries.club_id → null
          const myClubs = new Set(db.clubs.filter((c) => c.owner_id === me).map((c) => c.id));
          db.follows = db.follows.filter((f) => f.follower_id !== me && f.followee_id !== me);
          db.clubs = db.clubs.filter((c) => !myClubs.has(c.id));
          db.club_members = db.club_members.filter((m) => m.user_id !== me && !myClubs.has(m.club_id));
          db.entries.forEach((e) => { if (myClubs.has(e.club_id)) e.club_id = null; });
        }
        save();
        return { data: null, error: null };
      }
      if (name === 'follow_stats') {
        return { data: [{ followers: db.follows.filter((f) => f.followee_id === args.p_user).length,
          following: db.follows.filter((f) => f.follower_id === args.p_user).length,
          i_follow: db.follows.some((f) => f.follower_id === uid() && f.followee_id === args.p_user) }], error: null };
      }
      if (name === 'join_club') {
        if (!uid() || bannedId(uid())) return { data: null, error: err('P0001', 'not allowed') };
        const c = db.clubs.find((x) => x.id === args.p_club);
        if (!c) return { data: null, error: err('P0001', 'club not found') };
        if (db.club_members.some((m) => m.club_id === c.id && m.user_id === uid())) return { data: null, error: null };
        if (!c.open && String(args.p_code || '').trim().toLowerCase() !== c.invite_code) return { data: null, error: err('P0001', 'club_code') };
        if (db.club_members.filter((m) => m.user_id === uid()).length >= 10) return { data: null, error: err('P0001', 'club_member_limit') };
        db.club_members.push({ club_id: c.id, user_id: uid(), role: 'member', joined_at: new Date().toISOString() });
        save();
        return { data: null, error: null };
      }
      if (name === 'club_invite_code') {
        const c = db.clubs.find((x) => x.id === args.p_club);
        const member = c && db.club_members.some((m) => m.club_id === c.id && m.user_id === uid());
        return { data: member ? c.invite_code : null, error: null };
      }
      if (name === 'set_entry_club') {
        const t = db.tournaments.find((x) => x.id === args.p_tournament);
        const e = db.entries.find((x) => x.tournament_id === args.p_tournament && x.user_id === uid());
        if (!t || !e) return { data: null, error: err('P0001', 'not allowed') };
        if (!t.team_mode) return { data: null, error: err('P0001', 'team_off') };
        if (Date.now() >= new Date(t.ends_at)) return { data: null, error: err('P0001', 'team_closed') };
        if (args.p_club && !db.club_members.some((m) => m.club_id === args.p_club && m.user_id === uid())) return { data: null, error: err('P0001', 'team_not_member') };
        e.club_id = args.p_club || null;
        save();
        return { data: null, error: null };
      }
      if (name === 'team_leaderboard') {
        const t = db.tournaments.find((x) => x.id === args.p_tournament_id);
        if (!t?.team_mode || !visible('tournaments', t)) return { data: [], error: null };
        if (t.leaderboard_hidden && Date.now() < new Date(t.ends_at) && t.organizer_id !== uid() && !isAdmin()) return { data: [], error: null };
        const { computeLeaderboard } = await import(window.__appBase + 'src/lib/scoring.js');
        const board = computeLeaderboard({
          tournament: t,
          speciesIds: db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => x.species_id),
          entries: db.entries.filter((e) => e.tournament_id === t.id && !bannedId(e.user_id)),
          catches: db.catches,
          profiles: Object.fromEntries(db.profiles.map((p) => [p.id, p]))
        });
        const byClub = new Map();
        for (const r of board) {
          const clubId = db.entries.find((e) => e.tournament_id === t.id && e.user_id === r.user_id)?.club_id;
          if (!clubId) continue;
          if (!byClub.has(clubId)) byClub.set(clubId, []);
          byClub.get(clubId).push(r.score_mm);
        }
        const rows = [...byClub].map(([club_id, scores]) => {
          const top = scores.sort((a, b) => b - a).slice(0, 3);
          return { club_id, name: db.clubs.find((c) => c.id === club_id)?.name ?? '', score_mm: top.reduce((a, b) => a + b, 0),
            counted: top.length, members: db.entries.filter((e) => e.tournament_id === t.id && e.club_id === club_id).length };
        }).sort((a, b) => b.score_mm - a.score_mm || a.name.localeCompare(b.name));
        rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1].score_mm === r.score_mm ? rows[i - 1].rank : i + 1; });
        return { data: rows, error: null };
      }
      if (name === 'touch_presence') {
        if (!uid()) return { data: null, error: err('42501', 'permission denied for function touch_presence') };
        db.user_presence ||= [];
        db.user_devices ||= [];
        const pr = db.user_presence.find((x) => x.user_id === uid());
        if (pr) pr.last_seen_at = new Date().toISOString(); else db.user_presence.push({ user_id: uid(), last_seen_at: new Date().toISOString() });
        const model = String(args.p_model || 'Nežinomas').replace(/[^A-Za-z0-9 ._()+/-]/g, '').slice(0, 60) || 'Nežinomas';
        const platform = ['Android', 'iOS', 'Windows', 'macOS', 'Linux'].includes(args.p_platform) ? args.p_platform : 'Kita';
        const browser = String(args.p_browser || 'Kita').replace(/[^A-Za-z0-9 ._-]/g, '').slice(0, 30) || 'Kita';
        const row = db.user_devices.find((x) => x.user_id === uid() && x.model === model && x.platform === platform && x.browser === browser);
        if (row) Object.assign(row, { last_seen: new Date().toISOString(), installed: row.installed || !!args.p_installed });
        else if (db.user_devices.filter((x) => x.user_id === uid()).length < 10) {
          db.user_devices.push({ user_id: uid(), model, platform, os_version: args.p_os || null, browser, installed: !!args.p_installed, first_seen: new Date().toISOString(), last_seen: new Date().toISOString() });
        }
        save();
        return { data: null, error: null };
      }
      if (name === 'admin_stats') {
        if (!hasPerm('roles')) return { data: null, error: err('P0001', 'not allowed') };
        const now = Date.now();
        const day0 = new Date(); day0.setHours(0, 0, 0, 0);
        const pres = db.user_presence || [];
        const devs = (db.user_devices || []).filter((d) => now - Date.parse(d.last_seen) < 90 * 864e5);
        const grp = (key, mk) => Object.values(devs.reduce((m, d) => { const k = key(d); (m[k] ||= { d, u: new Set() }).u.add(d.user_id); return m; }, {}))
          .map(({ d, u }) => ({ ...mk(d), users: u.size })).sort((a, b) => b.users - a.users);
        return { data: {
          users: db.profiles.length,
          new_today: db.profiles.filter((p) => Date.parse(p.created_at) >= day0.getTime()).length,
          new_7d: db.profiles.filter((p) => now - Date.parse(p.created_at) < 7 * 864e5).length,
          new_30d: db.profiles.filter((p) => now - Date.parse(p.created_at) < 30 * 864e5).length,
          online_now: pres.filter((p) => now - Date.parse(p.last_seen_at) < 5 * 60e3).length,
          active_today: pres.filter((p) => Date.parse(p.last_seen_at) >= day0.getTime()).length,
          active_7d: pres.filter((p) => now - Date.parse(p.last_seen_at) < 7 * 864e5).length,
          active_30d: pres.filter((p) => now - Date.parse(p.last_seen_at) < 30 * 864e5).length,
          catches_today: db.catches.filter((c) => Date.parse(c.received_at) >= day0.getTime()).length,
          pending: db.catches.filter((c) => c.status === 'pending').length,
          live_tournaments: db.tournaments.filter((t) => now >= Date.parse(t.starts_at) && now < Date.parse(t.ends_at)).length,
          signups: Array.from({ length: 30 }, (_, i) => {
            const d = day0.getTime() - (29 - i) * 864e5;
            return { day: new Date(d).toISOString().slice(0, 10), count: db.profiles.filter((p) => Date.parse(p.created_at) >= d && Date.parse(p.created_at) < d + 864e5).length };
          }),
          models: grp((d) => d.model + '|' + d.platform, (d) => ({ model: d.model, platform: d.platform })).slice(0, 20),
          platforms: grp((d) => d.platform, (d) => ({ platform: d.platform })),
          browsers: grp((d) => d.browser, (d) => ({ browser: d.browser })),
          installed: new Set(devs.filter((d) => d.installed).map((d) => d.user_id)).size,
          with_device: new Set(devs.map((d) => d.user_id)).size
        }, error: null };
      }
      if (name === 'server_now') return { data: new Date(Date.now() + (window.__serverOffsetMs || 0)).toISOString(), error: null };
      if (name === 'set_entry_division') {
        const t = db.tournaments.find((x) => x.id === args.p_tournament);
        const e = db.entries.find((x) => x.tournament_id === args.p_tournament && x.user_id === uid());
        if (!t || !e) return { data: null, error: err('P0001', 'not allowed') };
        if (!regOrSoon(t)) return { data: null, error: err('P0001', 'division_closed') };
        if (args.p_division && !db.tournament_divisions.some((d) => d.id === args.p_division && d.tournament_id === t.id)) return { data: null, error: err('P0001', 'division_invalid') };
        e.division_id = args.p_division || null;
        save();
        return { data: null, error: null };
      }
      if (name === 'duel_bracket') {
        const t = db.tournaments.find((x) => x.id === args.p_tournament_id);
        if (!t || t.format !== 'duels' || !visible('tournaments', t)) return { data: [], error: null };
        const { duelBracket } = await import(window.__appBase + 'src/lib/duels.js');
        const rows = await duelBracket({
          tournament: t,
          speciesIds: db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => x.species_id),
          entries: db.entries.filter((e) => e.tournament_id === t.id),
          catches: db.catches,
          profiles: Object.fromEntries(db.profiles.map((p) => [p.id, p])),
          banned: bannedId
        });
        return { data: rows, error: null };
      }
      if (name === 'league_standings') {
        const { computeLeaderboard, leagueStandings } = await import(window.__appBase + 'src/lib/scoring.js');
        const list = db.tournaments.filter((t) => t.league_id === args.p_league && t.visibility === 'public'
          && Date.now() >= new Date(t.starts_at) && !(t.leaderboard_hidden && Date.now() < new Date(t.ends_at)));
        const boards = list.map((t) => computeLeaderboard({
          tournament: t,
          speciesIds: db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => x.species_id),
          speciesPct: speciesPctOf(t.id),
          entries: db.entries.filter((e) => e.tournament_id === t.id && !bannedId(e.user_id)),
          catches: db.catches,
          profiles: Object.fromEntries(db.profiles.map((p) => [p.id, p]))
        }));
        return { data: leagueStandings(boards), error: null };
      }
      if (name === 'leaderboard') {
        const { computeLeaderboard } = await import(window.__appBase + 'src/lib/scoring.js');
        const t = db.tournaments.find((x) => x.id === args.p_tournament_id);
        if (!t) return { data: [], error: null };
        const profiles = Object.fromEntries(db.profiles.map((p) => [p.id, p]));
        const rows = computeLeaderboard({
          tournament: t,
          speciesIds: db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => x.species_id),
          speciesPct: speciesPctOf(t.id),
          entries: db.entries.filter((e) => e.tournament_id === t.id && !bannedId(e.user_id)),
          catches: db.catches,
          profiles
        });
        const hidden = t.leaderboard_hidden && Date.now() < new Date(t.ends_at) && t.organizer_id !== uid() && !isAdmin();
        return { data: hidden ? rows.filter((r) => r.user_id === uid()).map((r) => ({ ...r, rank: null })) : rows, error: null };
      }
      return { data: null, error: err('42883', `function ${name} does not exist`) };
    },
    storage: {
      from(bucket) {
        return {
          async upload(path, blob, opts) {
            log('upload', { bucket, path, type: blob?.type, size: blob?.size, upsert: opts?.upsert });
            if (failNext.upload) { failNext.upload--; return { data: null, error: { name: 'StorageUnknownError', message: 'Failed to fetch' } }; }
            if (!uid() || path.split('/')[0] !== uid()) return { data: null, error: { statusCode: '403', message: 'new row violates row-level security policy' } };
            if (blobs.has(path) && !opts?.upsert) return { data: null, error: { statusCode: '409', message: 'The resource already exists' } };
            blobs.set(path, blob);
            return { data: { path }, error: null };
          },
          async list(prefix, opts = {}) {
            log('list', { bucket, prefix });
            const names = [...blobs.keys()].filter((k) => k.startsWith(prefix + '/')).map((k) => k.slice(prefix.length + 1));
            return { data: names.slice(0, opts.limit || 100).map((name) => ({ name })), error: null };
          },
          async remove(paths) {
            log('remove', { bucket, paths });
            const prof = db.profiles.find((x) => x.id === uid());
            if (!prof?.deleting_at) return { data: [], error: null }; // RLS: be leidimo niekas neištrinama
            paths.filter((x) => x.split('/')[0] === uid()).forEach((x) => blobs.delete(x));
            return { data: paths.map((name) => ({ name })), error: null };
          },
          async createSignedUrl(path) {
            const b = blobs.get(path);
            if (!b) return { data: null, error: { message: 'Object not found' } };
            return { data: { signedUrl: URL.createObjectURL(b) }, error: null };
          }
        };
      }
    }
  };
}
