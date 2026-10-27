// Supabase kliento imitacija naršyklės testams (tikras režimas be tinklo).
// Įkeliama vietoj https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm.
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

function seed() {
  const other = '00000000-0000-4000-8000-0000000000aa';
  return {
    species: SPECIES.map((code, i) => ({ id: i + 1, code, name_lt: NAMES[i] })),
    profiles: [{ id: other, nickname: 'Kitas_Zvejys', region: 'Vilniaus r.', trust_score: 50, is_admin: false, created_at: iso(-90 * 24 * H) }],
    tournaments: [{
      id: 'tttttttt-0000-4000-8000-000000000001', organizer_id: other, title: 'Testo lydekų taurė',
      description: null, format: 'top_n_sum', top_n: 3, min_length_mm: 400, visibility: 'public', fee_cents: 0,
      starts_at: iso(-24 * H), ends_at: iso(48 * H), created_at: iso(-48 * H)
    }],
    tournament_species: [{ tournament_id: 'tttttttt-0000-4000-8000-000000000001', species_id: 1 }],
    entries: [{ tournament_id: 'tttttttt-0000-4000-8000-000000000001', user_id: other, joined_at: iso(-20 * H) }],
    catches: [{
      id: 'cccccccc-0000-4000-8000-000000000001', user_id: other, client_id: 'cccccccc-0000-4000-8000-000000000001',
      species_id: 1, length_mm: 700, captured_at_device: iso(-10 * H), received_at: iso(-10 * H),
      photo_path: `${other}/x.jpg`, photo_sha256: 'f'.repeat(64), status: 'approved', reject_reason: null, created_at: iso(-10 * H)
    }],
    catch_locations: []
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
const isAdmin = () => !!db.profiles.find((p) => p.id === uid())?.is_admin;

// Paprastas RLS atitikmuo – kad testai pagautų užklausas, kurios tikroje bazėje grąžintų ne tai.
function visible(table, row) {
  if (table === 'catches') return row.user_id === uid() || row.status === 'approved' || isAdmin();
  if (table === 'catch_locations') return isAdmin() || db.catches.some((c) => c.id === row.catch_id && c.user_id === uid());
  return true;
}

function embed(table, row, spec) {
  const out = {};
  for (const part of spec) {
    if (table === 'tournaments' && part === 'tournament_species(species_id)') {
      out.tournament_species = db.tournament_species.filter((x) => x.tournament_id === row.id).map((x) => ({ species_id: x.species_id }));
    } else if (table === 'tournaments' && part === 'entries(count)') {
      out.entries = [{ count: db.entries.filter((e) => e.tournament_id === row.id).length }];
    } else if (table === 'entries' && part.startsWith('profiles(')) {
      const p = db.profiles.find((x) => x.id === row.user_id);
      out.profiles = p ? { id: p.id, nickname: p.nickname, region: p.region } : null;
    } else if (table === 'catches' && part.startsWith('profiles!catches_user_id_fkey(')) {
      const p = db.profiles.find((x) => x.id === row.user_id);
      out.profiles = p ? { nickname: p.nickname, trust_score: p.trust_score } : null;
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
  order(col, o = {}) { this.sort = [col, o.ascending !== false]; return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }

  matches(row) { return this.filters.every(([c, v]) => row[c] === v); }

  run() {
    log('from', { table: this.table, op: this.op, sel: this.sel, filters: this.filters, rows: this.rows, patch: this.patch });
    const t = db[this.table];
    if (!t) return { data: null, error: err('42P01', `relation ${this.table} does not exist`) };
    let data;
    if (this.op === 'insert') {
      if (!uid()) return { data: null, error: err('42501', 'new row violates row-level security policy') };
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
          row.joined_at = new Date().toISOString();
        }
        if (this.table === 'tournaments') {
          Object.assign(row, { id: uuid(), visibility: 'public', fee_cents: 0, created_at: new Date().toISOString() });
        }
        t.push(row);
        inserted.push(row);
      }
      save();
      data = inserted;
    } else if (this.op === 'update') {
      if (this.table === 'profiles') {
        const allowed = ['nickname', 'region'];
        if (Object.keys(this.patch).some((k) => !allowed.includes(k))) return { data: null, error: err('42501', 'permission denied') };
        if (this.patch.nickname && db.profiles.some((p) => p.id !== uid() && p.nickname === this.patch.nickname)) {
          return { data: null, error: err('23505', 'duplicate nickname') };
        }
      }
      data = t.filter((r) => this.matches(r));
      data.forEach((r) => Object.assign(r, this.patch));
      save();
    } else if (this.op === 'delete') {
      data = t.filter((r) => this.matches(r));
      db[this.table] = t.filter((r) => !this.matches(r));
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
        log('signInWithOtp', { email: opts.email });
        return { data: {}, error: null };
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
        if (!isAdmin()) return { data: null, error: err('P0001', 'not allowed') };
        const c = db.catches.find((x) => x.id === args.p_catch_id);
        if (!c) return { data: null, error: err('P0001', 'catch not found') };
        if (!args.p_approve && !String(args.p_reason || '').trim()) return { data: null, error: err('P0001', 'reject reason is required') };
        c.status = args.p_approve ? 'approved' : 'rejected';
        c.reject_reason = args.p_approve ? null : args.p_reason;
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
          entries: db.entries.filter((e) => e.tournament_id === t.id).map((e) => e.user_id),
          catches: db.catches,
          profiles
        });
        return { data: rows, error: null };
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
