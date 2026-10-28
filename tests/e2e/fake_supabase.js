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
    if (table === 'tournaments' && part === 'tournament_species(species_id)') {
      out.tournament_species = db.tournament_species.filter((x) => x.tournament_id === row.id).map((x) => ({ species_id: x.species_id }));
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
  if (table === 'entries') return row.user_id === uid() && beforeStart(db.tournaments.find((x) => x.id === row.tournament_id));
  if (table === 'catches') return row.user_id === uid();
  if (table === 'profiles') return row.id === uid();
  if (table === 'blank_trips') return row.user_id === uid();
  if (table === 'tournament_announcements') return row.author_id === uid();
  if (table === 'notification_settings') return row.user_id === uid();
  if (table === 'catch_spots') return row.user_id === uid();
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
      if (BAN_INSERT.includes(this.table) && bannedId(uid())) {
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
          Object.assign(row, { id: uuid(), user_id: uid(), status: 'pending', reject_reason: null, received_at: new Date().toISOString(), created_at: new Date().toISOString() });
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
        }
        if (this.table === 'tournaments') {
          if (db.tournaments.filter((x) => x.organizer_id === uid() && Date.now() - new Date(x.created_at) < 24 * H).length >= 10) {
            return { data: null, error: err('P0001', 'tournament_limit') };
          }
          if (row.sponsor_url && !/^https:\/\/[^\s<>"']{3,200}$/.test(row.sponsor_url)) return { data: null, error: err('23514', 'check constraint sponsor_url') };
          Object.assign(row, { id: uuid(), visibility: row.visibility || 'public', leaderboard_hidden: !!row.leaderboard_hidden,
            fee_cents: 0, created_at: new Date().toISOString(), invite_code: uuid().replace(/-/g, '').slice(0, 10) });
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
      data = t.filter((r) => this.matches(r) && writable(this.table, r));
      data.forEach((r) => Object.assign(r, this.patch));
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
      }
      save();
    } else {
      data = t.filter((r) => this.matches(r) && visible(this.table, r));
      if (this.sort) {
        const [c, asc] = this.sort;
        data = data.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      }
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
        }
        save();
        return { data: null, error: null };
      }
      if (name === 'leaderboard') {
        const { computeLeaderboard } = await import(window.__appBase + 'src/lib/scoring.js');
        const t = db.tournaments.find((x) => x.id === args.p_tournament_id);
        if (!t) return { data: [], error: null };
        const profiles = Object.fromEntries(db.profiles.map((p) => [p.id, p]));
        const rows = computeLeaderboard({
          tournament: t,
          speciesIds: db.tournament_species.filter((x) => x.tournament_id === t.id).map((x) => x.species_id),
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
