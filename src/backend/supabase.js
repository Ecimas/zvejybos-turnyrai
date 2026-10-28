// Tikras režimas: Supabase (Postgres + autentifikacija + nuotraukų saugykla).
// Visas saugumas – serveryje (RLS taisyklės ir funkcijos), ne čia.
import { SPECIES } from './species.js';
import { PermanentError, RetryLaterError } from '../lib/outbox.js';
import { banActive } from '../lib/bans.js';

const BUCKET = 'catch-photos';
// Versija prisegta: CDN negali netikėtai pakeisti kodo, kuris tvarko prisijungimą.
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
// Viešai skaitomi laimikio stulpeliai. Masalas ir pastabos – tik savininkui per my_catch_notes() (0008).
export const CATCH_COLS = 'id, user_id, client_id, species_id, length_mm, weight_g, weather, captured_at_device, received_at, ' +
  'photo_path, photo_sha256, status, reject_reason, reviewed_by, reviewed_at, created_at, clock_offset_s, send_offset_s';
const TOURNAMENT_SEL = '*, tournament_species(species_id, points_pct), entries(count), tournament_sponsors(id, name, url, amount_cents, sort), ' +
  'tournament_announcements(created_at), tournament_divisions(id, name, sort), leagues(id, name, season)';
const PERMANENT_CODES = new Set(['42501', '23514', '23503', '22P02', 'P0001', '42883']);

// Funkcijos dar nėra serveryje (migracija neįdiegta).
export function isMissingFunction(err) {
  const code = String(err?.code || '');
  return code === 'PGRST202' || code === '42883' || /could not find the function/i.test(err?.message || '');
}

function friendly(err, map, fallback) {
  const m = String(err?.message || '');
  for (const [re, text] of map) if (re.test(m)) return new Error(text);
  return fallback ? new Error(fallback) : err;
}

function isPermanent(err) {
  if (!err) return false;
  const code = String(err.code || '');
  return PERMANENT_CODES.has(code) || code.startsWith('22');
}

export async function createSupabaseBackend(url, anonKey) {
  const { createClient } = await import(SUPABASE_JS);
  const sb = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });
  let user = null;
  const signed = new Map();

  const uid = () => {
    if (!user) throw new Error('Reikia prisijungti');
    return user.id;
  };
  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  const decorate = (t, mine) => ({
    ...t,
    species_ids: (t.tournament_species || []).map((x) => x.species_id),
    species_pct: Object.fromEntries((t.tournament_species || []).map((x) => [x.species_id, x.points_pct ?? 100])),
    divisions: (t.tournament_divisions || []).slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    league: t.leagues ?? null,
    sponsors: (t.tournament_sponsors || []).slice().sort((a, b) => a.sort - b.sort),
    last_announcement_at: (t.tournament_announcements || []).reduce((m, a) => (!m || a.created_at > m ? a.created_at : m), null),
    participants: t.entries?.[0]?.count ?? 0,
    joined: mine.has(t.id),
    joined_at: mine.get(t.id)?.joined_at ?? null,
    my_club_id: mine.get(t.id)?.club_id ?? null,
    my_division_id: mine.get(t.id)?.division_id ?? null
  });
  const speciesRows = (id, ids, pct = {}) => ids.map((species_id) => ({ tournament_id: id, species_id, points_pct: pct[species_id] ?? 100 }));
  // Divizionai: esami pervadinami, nauji įterpiami, pašalinti ištrinami (dalyvių pasirinkimai išlieka).
  async function saveDivisions(id, list, existing = []) {
    const keep = new Set(list.filter((d) => d.id).map((d) => d.id));
    const gone = existing.filter((d) => !keep.has(d.id)).map((d) => d.id);
    if (gone.length) check(await sb.from('tournament_divisions').delete().in('id', gone));
    for (const [i, d] of list.entries()) {
      if (d.id) {
        const old = existing.find((x) => x.id === d.id);
        if (old && (old.name !== d.name || old.sort !== i)) check(await sb.from('tournament_divisions').update({ name: d.name, sort: i }).eq('id', d.id));
      }
    }
    const fresh = list.map((d, i) => ({ ...d, sort: i })).filter((d) => !d.id);
    if (fresh.length) {
      const { error } = await sb.from('tournament_divisions').insert(fresh.map((d) => ({ tournament_id: id, name: d.name, sort: d.sort })));
      if (error) throw friendly(error, [[/division_limit/, 'Daugiausia 8 divizionai'], [/duplicate|uniq/, 'Divizionų pavadinimai turi skirtis'], [/check/, 'Diviziono pavadinimas: 2–30 raidžių']]);
    }
  }
  // Savo masalas ir pastabos. Jei funkcijos dar nėra serveryje – tiesiog be jų.
  const myNotes = async () => {
    if (!user) return new Map();
    const { data, error } = await sb.rpc('my_catch_notes');
    if (error) return new Map();
    return new Map((data || []).map((r) => [r.id, r]));
  };
  const withNotes = (rows, notes) => rows.map((c) => ({ ...c, bait: notes.get(c.id)?.bait ?? null, notes: notes.get(c.id)?.notes ?? null }));
  // Mano turnyrai: tournament_id → { joined_at, club_id }.
  const myEntries = async () => {
    if (!user) return new Map();
    const { data, error } = await sb.from('entries').select('tournament_id, joined_at, club_id, division_id').eq('user_id', user.id);
    const rows = error ? check(await sb.from('entries').select('tournament_id, joined_at').eq('user_id', user.id)) : data;
    return new Map(rows.map((r) => [r.tournament_id, { joined_at: r.joined_at, club_id: r.club_id ?? null, division_id: r.division_id ?? null }]));
  };
  const CLUB_COLS = 'id, name, region, description, owner_id, open, created_at';

  return {
    mode: 'supabase',
    async init() {
      const { data } = await sb.auth.getSession();
      user = data.session?.user ?? null;
    },
    getUser: () => user,
    onAuth(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        user = session?.user ?? null;
        cb(user);
      });
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, captchaToken) {
      check(await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname, ...(captchaToken ? { captchaToken } : {}) }
      }));
    },
    // Kokie prisijungimo būdai įjungti Supabase (pvz. Google). Klaidos atveju – tik el. paštas.
    async authProviders() {
      try {
        const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey } });
        if (!res.ok) return { google: false };
        const s = await res.json();
        return { google: !!s?.external?.google };
      } catch {
        return { google: false };
      }
    },
    // Peradresuoja į Google; grįžus adrese būna #access_token – jį apdoroja app.js.
    async signInWithGoogle() {
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: location.origin + location.pathname, queryParams: { prompt: 'select_account' } }
      });
      if (error) throw error;
    },
    async verifyCode(email, token) {
      let r = await sb.auth.verifyOtp({ email, token, type: 'email' });
      // Senesnės Supabase versijos naujam vartotojui laukia tipo „signup“.
      if (r.error) {
        const r2 = await sb.auth.verifyOtp({ email, token, type: 'signup' });
        if (!r2.error) r = r2;
      }
      if (r.error) throw r.error;
      user = r.data?.user ?? r.data?.session?.user ?? user;
    },
    async signOut() {
      await sb.auth.signOut();
      user = null;
    },

    async myProfile() {
      if (!user) return null;
      return check(await sb.from('profiles').select('*').eq('id', user.id).single());
    },
    async updateProfile({ nickname, region }) {
      const { error } = await sb.from('profiles').update({ nickname, region: region || null }).eq('id', uid());
      if (error?.code === '23505') throw new Error('Toks slapyvardis jau užimtas');
      if (error?.code === '23514') throw new Error('Slapyvardis: 3–24 raidės, skaičiai, _ . -');
      if (error) throw error;
    },

    async species() {
      const rows = check(await sb.from('species').select('id, code, name_lt').order('id'));
      return rows.length ? rows : SPECIES;
    },
    async tournaments() {
      const [rows, mine] = await Promise.all([
        sb.from('tournaments').select(TOURNAMENT_SEL).order('starts_at'),
        myEntries()
      ]);
      return check(rows).map((t) => decorate(t, mine));
    },
    async tournament(id) {
      const [row, mine] = await Promise.all([
        sb.from('tournaments').select(TOURNAMENT_SEL).eq('id', id).maybeSingle(),
        myEntries()
      ]);
      const t = check(row);
      return t ? decorate(t, mine) : null;
    },
    async createTournament(data) {
      const { species_ids, species_pct = {}, sponsors = [], divisions = [], ...rest } = data;
      const ins = await sb.from('tournaments').insert({ ...rest, organizer_id: uid() }).select('id').single();
      if (ins.error) throw friendly(ins.error, [[/tournament_limit/, 'Per parą galima sukurti ne daugiau kaip 10 turnyrų'], [/league_owner/, 'Į lygą gali įtraukti tik lygos savininkas']]);
      const t = ins.data;
      if (species_ids.length) {
        check(await sb.from('tournament_species').insert(speciesRows(t.id, species_ids, species_pct)));
      }
      if (divisions.length) await saveDivisions(t.id, divisions);
      if (sponsors.length) {
        check(await sb.from('tournament_sponsors').insert(sponsors.map((s, i) => ({ ...s, tournament_id: t.id, sort: i }))));
      }
      check(await sb.from('entries').insert({ tournament_id: t.id, user_id: uid() }));
      return t.id;
    },
    async updateTournament(id, data) {
      const { species_ids, species_pct = {}, sponsors, divisions, ...rest } = data;
      const before = divisions ? check(await sb.from('tournament_divisions').select('id, name, sort').eq('tournament_id', id)) : [];
      const { data: rows, error } = await sb.from('tournaments').update(rest).eq('id', id).select('id');
      if (error) throw friendly(error, [[/league_owner/, 'Į lygą gali įtraukti tik lygos savininkas']]);
      if (!rows?.length) throw new Error('Turnyras jau prasidėjo – keisti nebegalima');
      if (species_ids) {
        check(await sb.from('tournament_species').delete().eq('tournament_id', id));
        if (species_ids.length) {
          check(await sb.from('tournament_species').insert(speciesRows(id, species_ids, species_pct)));
        }
      }
      if (divisions) await saveDivisions(id, divisions, before);
      if (sponsors) {
        check(await sb.from('tournament_sponsors').delete().eq('tournament_id', id));
        if (sponsors.length) {
          check(await sb.from('tournament_sponsors').insert(sponsors.map((s, i) => ({ ...s, tournament_id: id, sort: i }))));
        }
      }
    },
    async deleteTournament(id) {
      const rows = check(await sb.from('tournaments').delete().eq('id', id).select('id'));
      if (!rows?.length) throw new Error('Prasidėjusio turnyro ištrinti negalima');
    },
    async getInvite(code) {
      const rows = check(await sb.rpc('get_invite', { p_code: code }));
      return rows?.[0] ?? null;
    },
    async joinWithInvite(code) {
      const { data, error } = await sb.rpc('join_with_invite', { p_code: code });
      if (error) throw friendly(error, [[/invite_invalid/, 'Kvietimas negalioja arba turnyras jau baigėsi'], [/registration_closed/, 'Registracija į šį turnyrą jau baigėsi']]);
      return data;
    },
    async join(id) {
      const { error } = await sb.from('entries').insert({ tournament_id: id, user_id: uid() });
      if (error && error.code !== '23505') throw error;
    },
    async leave(id) {
      check(await sb.from('entries').delete().eq('tournament_id', id).eq('user_id', uid()));
    },
    async participants(id) {
      const rows = check(await sb.from('entries').select('profiles(id, nickname, region)').eq('tournament_id', id));
      return rows.map((r) => r.profiles).filter(Boolean);
    },
    async leaderboard(id) {
      return check(await sb.rpc('leaderboard', { p_tournament_id: id }));
    },
    async serverNow() {
      return check(await sb.rpc('server_now'));
    },
    async touchPresence(d) {
      const { error } = await sb.rpc('touch_presence', { p_model: d.model, p_platform: d.platform, p_os: d.os || null, p_browser: d.browser, p_installed: !!d.installed });
      if (error) throw error;
    },
    async adminStats() {
      const { data, error } = await sb.rpc('admin_stats');
      if (error) throw friendly(error, [[/not allowed/, 'Statistiką mato tik savininkas']], 'Nepavyko gauti statistikos');
      return data;
    },
    // Kuriam divizionui priklauso dalyviai: user_id → division_id
    async divisionMap(id) {
      const rows = check(await sb.from('entries').select('user_id, division_id').eq('tournament_id', id));
      return new Map(rows.map((r) => [r.user_id, r.division_id]));
    },
    async setEntryDivision(tournamentId, divisionId) {
      const { error } = await sb.rpc('set_entry_division', { p_tournament: tournamentId, p_division: divisionId || null });
      if (error) throw friendly(error, [[/division_closed/, 'Registracija baigėsi – diviziono keisti nebegalima'], [/division_invalid/, 'Tokio diviziono nėra']], 'Nepavyko išsaugoti');
    },
    async duelBracket(id) {
      return check(await sb.rpc('duel_bracket', { p_tournament_id: id }));
    },

    // Sezono lygos
    async leagues() {
      const rows = check(await sb.from('leagues').select('id, name, season, description, owner_id, created_at, tournaments(count)').order('season', { ascending: false }));
      return rows.map((l) => ({ ...l, events: l.tournaments?.[0]?.count ?? 0 })).sort((a, b) => b.season - a.season || a.name.localeCompare(b.name));
    },
    async league(id) {
      const { data, error } = await sb.from('leagues').select('id, name, season, description, owner_id, created_at').eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const [standings, list, mine] = await Promise.all([
        sb.rpc('league_standings', { p_league: id }),
        sb.from('tournaments').select(TOURNAMENT_SEL).eq('league_id', id).order('starts_at'),
        myEntries()
      ]);
      return { ...data, standings: check(standings), tournaments: check(list).map((t) => decorate(t, mine)) };
    },
    async myLeagues() {
      if (!user) return [];
      return check(await sb.from('leagues').select('id, name, season').eq('owner_id', user.id).order('season', { ascending: false }));
    },
    async createLeague({ name, season, description }) {
      const { data, error } = await sb.from('leagues').insert({ name, season, description: description || null }).select('id').single();
      if (error) {
        throw friendly(error, [
          [/league_limit/, 'Galima sukurti iki 5 lygų'],
          [/leagues_name_uniq|duplicate/, 'Tokia lyga šiam sezonui jau yra'],
          [/check/, 'Pavadinime gali būti raidės, skaičiai, tarpai ir . , - _ ( ) (3–60 simbolių)']
        ], 'Nepavyko sukurti lygos');
      }
      return data.id;
    },
    async updateLeague(id, patch) {
      const { error } = await sb.from('leagues').update(patch).eq('id', id);
      if (error) throw friendly(error, [[/leagues_name_uniq|duplicate/, 'Tokia lyga šiam sezonui jau yra'], [/check/, 'Netinkamas pavadinimas']], 'Nepavyko išsaugoti');
    },
    async deleteLeague(id) {
      check(await sb.from('leagues').delete().eq('id', id));
    },

    async myCatches() {
      if (!user) return [];
      const [rows, notes] = await Promise.all([
        sb.from('catches').select(CATCH_COLS).eq('user_id', user.id).order('captured_at_device', { ascending: false }),
        myNotes()
      ]);
      return withNotes(check(rows), notes);
    },
    async userCatches(userId) {
      return check(await sb.from('catches').select(CATCH_COLS).eq('user_id', userId).order('captured_at_device', { ascending: false }));
    },
    // Vienas laimikis peržiūrai. Vietą RLS grąžina tik savininkui ir moderatoriui.
    async catchDetail(id) {
      const row = check(await sb.from('catches')
        .select(`${CATCH_COLS}, profiles!catches_user_id_fkey(nickname, region), catch_locations(lat, lng, accuracy_m)`)
        .eq('id', id).maybeSingle());
      if (!row) return null;
      const loc = Array.isArray(row.catch_locations) ? row.catch_locations[0] : row.catch_locations;
      const out = { ...row, nickname: row.profiles?.nickname ?? '', region: row.profiles?.region ?? null,
        location: loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy_m } : null };
      if (user && row.user_id === user.id) return withNotes([out], await myNotes())[0];
      return out;
    },
    async userEntries(userId) {
      return check(await sb.from('entries').select('tournament_id, joined_at').eq('user_id', userId));
    },
    async photoUrl(path) {
      if (!path) return null;
      const hit = signed.get(path);
      if (hit && hit.exp > Date.now()) return hit.url;
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      if (error) return null;
      signed.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60e3 });
      return data.signedUrl;
    },

    // Saugus kartoti: kiekvienas žingsnis atpažįsta, kad jau buvo atliktas.
    async submitCatch(item) {
      const me = uid();
      const path = `${me}/${item.clientId}.jpg`;

      const up = await sb.storage.from(BUCKET).upload(path, item.photo, { contentType: 'image/jpeg', upsert: false });
      if (up.error) {
        const status = String(up.error.statusCode || up.error.status || '');
        const exists = status === '409' || /exist/i.test(up.error.message || '');
        if (!exists) {
          if (status === '403' || status === '400') throw new PermanentError('Nepavyko įkelti nuotraukos', 'upload_denied');
          throw new Error(up.error.message || 'upload_failed');
        }
      }

      let row;
      const ins = await sb.from('catches').insert({
        client_id: item.clientId,
        species_id: item.speciesId,
        length_mm: item.lengthMm,
        captured_at_device: item.capturedAt,
        photo_path: path,
        photo_sha256: item.sha256,
        weight_g: item.weightG ?? null,
        bait: item.bait || null,
        notes: item.notes || null,
        weather: item.weather ?? null,
        clock_offset_s: Number.isInteger(item.clockOffsetS) ? item.clockOffsetS : null,
        sent_at_device: new Date().toISOString()
      }).select(CATCH_COLS).single();
      if (ins.error) {
        const msg = `${ins.error.message} ${ins.error.details || ''}`;
        if (/catch_limit/.test(msg)) {
          throw new RetryLaterError('Paros limitas – 50 laimikių. Išsiųsime automatiškai vėliau', 'catch_limit');
        }
        if (ins.error.code === '23505' && /photo_sha256/.test(msg)) {
          throw new PermanentError('Ši nuotrauka jau buvo įkelta', 'duplicate_photo');
        }
        if (ins.error.code === '23505') {
          row = check(await sb.from('catches').select(CATCH_COLS).eq('user_id', me).eq('client_id', item.clientId).single());
        } else if (isPermanent(ins.error)) {
          throw new PermanentError('Laimikis atmestas: ' + ins.error.message, ins.error.code);
        } else {
          throw new Error(ins.error.message);
        }
      } else {
        row = ins.data;
      }

      if (item.location) {
        const loc = await sb.from('catch_locations').insert({
          catch_id: row.id,
          lat: item.location.lat,
          lng: item.location.lng,
          accuracy_m: item.location.accuracy
        });
        if (loc.error && loc.error.code !== '23505') {
          if (isPermanent(loc.error)) throw new PermanentError('Nepavyko išsaugoti vietos', loc.error.code);
          throw new Error(loc.error.message);
        }
      }
      return row;
    },

    async updateCatch(id, { bait, notes }) {
      const rows = check(await sb.from('catches').update({ bait: bait || null, notes: notes || null })
        .eq('id', id).eq('user_id', uid()).select('id'));
      if (!rows?.length) throw new Error('Nepavyko išsaugoti');
    },

    async myDisputes() {
      if (!user) return [];
      return check(await sb.from('disputes').select('*').eq('user_id', user.id));
    },
    async openDispute(catchId, message) {
      const { error } = await sb.from('disputes').insert({ catch_id: catchId, message });
      if (error?.code === '23505') throw new Error('Ginčas dėl šio laimikio jau pateiktas');
      if (error) throw friendly(error, [], 'Nepavyko pateikti');
    },
    async openDisputes() {
      const rows = check(await sb.from('disputes')
        .select(`*, catches(${CATCH_COLS}), profiles!disputes_user_id_fkey(nickname, trust_score)`)
        .eq('status', 'open')
        .order('created_at'));
      return rows.map((d) => ({ ...d, catch: d.catches, nickname: d.profiles?.nickname ?? '', trust_score: d.profiles?.trust_score ?? 50 }));
    },
    async resolveDispute(id, accept, note) {
      check(await sb.rpc('resolve_dispute', { p_id: id, p_accept: accept, p_note: note || null }));
    },
    async moderators() {
      return check(await sb.from('profiles').select('id, nickname, region').eq('is_admin', true).order('nickname'));
    },
    // Komanda: visi, turintys bent vieną rolę (is_admin sinchronizuojamas su roles, 0014).
    async staff() {
      return check(await sb.from('profiles').select('id, nickname, region, roles, is_admin').eq('is_admin', true).order('nickname'));
    },
    async setRole(nickname, role, on) {
      const { error } = await sb.rpc('set_role', { p_nickname: nickname, p_role: role, p_on: on });
      if (error) {
        throw friendly(error, [
          [/user not found/, 'Tokio slapyvardžio nėra'],
          [/role_owner/, 'Savininko rolių keisti negalima'],
          [/role_banned/, 'Užblokuotam žvejui rolės suteikti negalima'],
          [/role_invalid/, 'Tokios rolės nėra'],
          [/not allowed/, 'Roles skirti gali tik savininkas']
        ], 'Nepavyko pakeisti rolės');
      }
    },
    async setModerator(nickname, admin) {
      const { error } = await sb.rpc('set_moderator', { p_nickname: nickname, p_admin: admin });
      if (error) {
        throw friendly(error, [
          [/user not found/, 'Tokio slapyvardžio nėra'],
          [/last_admin/, 'Negalima pašalinti paskutinio moderatoriaus']
        ], 'Nepavyko pakeisti');
      }
    },

    // Sekimas ir klubai (0019).
    async followStats(userId) {
      const { data, error } = await sb.rpc('follow_stats', { p_user: userId });
      return error || !data?.[0] ? { followers: 0, following: 0, i_follow: false } : { ...data[0], followers: Number(data[0].followers), following: Number(data[0].following) };
    },
    async follow(userId) {
      const { error } = await sb.from('follows').insert({ followee_id: userId });
      if (error && error.code !== '23505') throw friendly(error, [[/follow_limit/, 'Galima sekti iki 500 žvejų']], 'Nepavyko');
    },
    async unfollow(userId) {
      check(await sb.from('follows').delete().eq('follower_id', uid()).eq('followee_id', userId));
    },
    async followingFeed() {
      const rows = check(await sb.from('follows').select('followee_id').eq('follower_id', uid()));
      const ids = rows.map((r) => r.followee_id);
      if (!ids.length) return { following: 0, catches: [] };
      const catches = check(await sb.from('catches').select(`${CATCH_COLS}, profiles!catches_user_id_fkey(nickname)`)
        .in('user_id', ids).eq('status', 'approved').order('captured_at_device', { ascending: false }).limit(60));
      return { following: ids.length, catches: catches.map((c) => ({ ...c, nickname: c.profiles?.nickname ?? '' })) };
    },
    async clubs() {
      const rows = check(await sb.from('clubs').select(`${CLUB_COLS}, club_members(count)`).order('name'));
      return rows.map((c) => ({ ...c, members: c.club_members?.[0]?.count ?? 0 }));
    },
    async club(id) {
      const { data, error } = await sb.from('clubs')
        .select(`${CLUB_COLS}, club_members(user_id, role, joined_at, profiles(nickname, region))`).eq('id', id).maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const members = (data.club_members || []).map((m) => ({ user_id: m.user_id, role: m.role, joined_at: m.joined_at, nickname: m.profiles?.nickname ?? '', region: m.profiles?.region ?? null }))
        .sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.nickname.localeCompare(b.nickname)));
      return { ...data, members };
    },
    async myClubs() {
      if (!user) return [];
      const { data, error } = await sb.from('club_members').select(`role, clubs(${CLUB_COLS})`).eq('user_id', user.id);
      return error ? [] : data.filter((m) => m.clubs).map((m) => ({ ...m.clubs, my_role: m.role }));
    },
    async userClubs(userId) {
      const { data, error } = await sb.from('club_members').select('role, clubs(id, name)').eq('user_id', userId);
      return error ? [] : data.filter((m) => m.clubs).map((m) => ({ ...m.clubs, role: m.role }));
    },
    async createClub({ name, region, description, open }) {
      const { data, error } = await sb.from('clubs').insert({ name, region: region || null, description: description || null, open: !!open }).select('id').single();
      if (error) {
        throw friendly(error, [
          [/club_limit/, 'Galima sukurti iki 3 klubų'],
          [/clubs_name_uniq|duplicate/, 'Toks klubo pavadinimas jau užimtas'],
          [/check/, 'Pavadinime gali būti raidės, skaičiai, tarpai ir . , - _ (3–40 simbolių)']
        ], 'Nepavyko sukurti klubo');
      }
      return data.id;
    },
    async updateClub(id, patch) {
      const { error } = await sb.from('clubs').update(patch).eq('id', id);
      if (error) throw friendly(error, [[/clubs_name_uniq|duplicate/, 'Toks klubo pavadinimas jau užimtas']], 'Nepavyko išsaugoti');
    },
    async deleteClub(id) {
      check(await sb.from('clubs').delete().eq('id', id));
    },
    async joinClub(id, code) {
      const { error } = await sb.rpc('join_club', { p_club: id, p_code: code || null });
      if (error) {
        throw friendly(error, [
          [/club_code/, 'Neteisingas kvietimo kodas'],
          [/club_member_limit/, 'Galima būti iki 10 klubų narys'],
          [/not allowed/, 'Užblokuotas žvejys prie klubų jungtis negali']
        ], 'Nepavyko prisijungti prie klubo');
      }
    },
    async leaveClub(id) {
      check(await sb.from('club_members').delete().eq('club_id', id).eq('user_id', uid()));
    },
    async removeClubMember(id, userId) {
      check(await sb.from('club_members').delete().eq('club_id', id).eq('user_id', userId));
    },
    async clubInviteCode(id) {
      const { data, error } = await sb.rpc('club_invite_code', { p_club: id });
      return error ? null : data;
    },
    async clubCatches(memberIds) {
      if (!memberIds.length) return [];
      const rows = check(await sb.from('catches').select(`${CATCH_COLS}, profiles!catches_user_id_fkey(nickname)`)
        .in('user_id', memberIds).eq('status', 'approved').order('captured_at_device', { ascending: false }).limit(30));
      return rows.map((c) => ({ ...c, nickname: c.profiles?.nickname ?? '' }));
    },
    async setEntryClub(tournamentId, clubId) {
      const { error } = await sb.rpc('set_entry_club', { p_tournament: tournamentId, p_club: clubId || null });
      if (error) throw friendly(error, [[/team_not_member/, 'Tu ne šio klubo narys'], [/team_closed/, 'Turnyras jau baigėsi']], 'Nepavyko išsaugoti');
    },
    async teamLeaderboard(tournamentId) {
      const { data, error } = await sb.rpc('team_leaderboard', { p_tournament_id: tournamentId });
      return error ? [] : data;
    },

    // Asmeninis žemėlapis (0018): tikslios vietos (90 d.) ir, jei įjungta, išsaugotos kopijos.
    async myMap() {
      const me = uid();
      const [rows, set] = await Promise.all([
        sb.from('catches').select(`${CATCH_COLS}, catch_locations(lat, lng, accuracy_m), catch_spots(lat, lng, accuracy_m)`)
          .eq('user_id', me).order('captured_at_device', { ascending: false }),
        sb.from('spot_settings').select('keep').eq('user_id', me).maybeSingle()
      ]);
      const one = (x) => (Array.isArray(x) ? x[0] : x) || null;
      const catches = check(rows).map(({ catch_locations: loc0, catch_spots: spot0, ...c }) => {
        const loc = one(loc0) || one(spot0);
        return { ...c, location: loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy_m } : null, kept: !!one(spot0) };
      });
      return { catches, keep: !set.error && !!set.data?.keep };
    },
    async setKeepSpots(on) {
      const n = check(await sb.rpc('set_keep_spots', { p_keep: !!on }));
      if (!on) check(await sb.from('catch_spots').delete().eq('user_id', uid()));
      return n;
    },

    // Atsitiktiniai patikrinimai (0017).
    async myChecks() {
      if (!user) return [];
      const { data, error } = await sb.from('catch_checks').select('id, catch_id, instruction, due_at, status')
        .eq('user_id', user.id).in('status', ['open', 'answered']).order('due_at');
      return error ? [] : data;
    },
    async check(id) {
      const { data, error } = await sb.from('catch_checks')
        .select(`id, catch_id, user_id, instruction, due_at, status, photo_path, note, created_at, answered_at, catches(${CATCH_COLS})`)
        .eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? { ...data, catch: data.catches } : null;
    },
    async catchCheck(catchId) {
      const { data, error } = await sb.from('catch_checks').select('id, instruction, due_at, status')
        .eq('catch_id', catchId).in('status', ['open', 'answered']).maybeSingle();
      return error ? null : data;
    },
    async answerCheck(id, photo, sha256) {
      const path = `${uid()}/check-${id}.jpg`;
      const up = await sb.storage.from(BUCKET).upload(path, photo, { contentType: 'image/jpeg', upsert: false });
      if (up.error) {
        const status = String(up.error.statusCode || up.error.status || '');
        if (!(status === '409' || /exist/i.test(up.error.message || ''))) throw new Error('Nepavyko įkelti nuotraukos – patikrink ryšį');
      }
      const { error } = await sb.rpc('answer_catch_check', { p_id: id, p_photo_path: path, p_sha256: sha256 });
      if (error) {
        throw friendly(error, [
          [/check_late/, 'Terminas jau baigėsi'],
          [/check_closed/, 'Į šią patikrą jau atsakyta'],
          [/check_duplicate/, 'Reikia naujos nuotraukos, ne senos'],
          [/check_no_photo/, 'Nuotrauka neįsikėlė – bandyk dar kartą']
        ], 'Nepavyko išsiųsti');
      }
    },
    async requestCheck(catchId, instruction, hours) {
      const { data, error } = await sb.rpc('request_catch_check', { p_catch: catchId, p_instruction: instruction, p_hours: hours });
      if (error) {
        throw friendly(error, [
          [/check_exists/, 'Šiam laimikiui patikra jau vyksta'],
          [/check_own/, 'Savo laimikio tikrinti negalima'],
          [/check_status/, 'Atmesto laimikio tikrinti nebereikia'],
          [/check_instruction/, 'Įrašyk, ką žvejys turi nufotografuoti'],
          [/not allowed/, 'Neturi teisės tikrinti laimikių']
        ], 'Nepavyko paprašyti patikros');
      }
      return data;
    },
    async randomCheckCandidate() {
      return check(await sb.rpc('random_check_candidate'));
    },
    async moderationChecks() {
      const rows = check(await sb.from('catch_checks')
        .select('id, catch_id, user_id, instruction, due_at, status, photo_path, answered_at, catches(id, species_id, length_mm, photo_path, captured_at_device), profiles!catch_checks_user_id_fkey(nickname)')
        .in('status', ['open', 'answered']).order('due_at'));
      return rows.map((r) => ({ ...r, catch: r.catches, nickname: r.profiles?.nickname ?? '' }));
    },
    async resolveCheck(id, pass, note) {
      const { error } = await sb.rpc('resolve_catch_check', { p_id: id, p_pass: pass, p_note: note || null });
      if (error) throw friendly(error, [[/check_state/, 'Patikra jau išspręsta'], [/check_own/, 'Savo patikros spręsti negalima']], 'Nepavyko');
    },

    // Push pranešimai (0015–0016).
    async pushPublicKey() {
      const { data, error } = await sb.rpc('push_public_key');
      return error ? null : data;
    },
    async savePushSubscription({ endpoint, p256dh, auth }) {
      check(await sb.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth }));
    },
    async removePushSubscription(endpoint) {
      check(await sb.rpc('remove_push_subscription', { p_endpoint: endpoint }));
    },
    async notificationSettings() {
      const def = { review: true, overtaken: true, start: true, announcements: true };
      if (!user) return def;
      const { data, error } = await sb.from('notification_settings').select('review, overtaken, start, announcements').eq('user_id', user.id).maybeSingle();
      return error || !data ? def : data;
    },
    async saveNotificationSettings(s) {
      const row = { review: !!s.review, overtaken: !!s.overtaken, start: !!s.start, announcements: !!s.announcements, updated_at: new Date().toISOString() };
      const rows = check(await sb.from('notification_settings').update(row).eq('user_id', user.id).select('user_id'));
      if (!rows?.length) check(await sb.from('notification_settings').insert(row));
    },
    async sendTestPush() {
      return check(await sb.rpc('send_test_push'));
    },

    // Blokavimai (0013). Jei lentelės serveryje dar nėra – blokavimų tiesiog nėra.
    async myBan() {
      if (!user) return null;
      const { data, error } = await sb.from('user_bans').select('until, reason, created_at').eq('user_id', user.id).maybeSingle();
      return !error && banActive(data) ? data : null;
    },
    async userBan(userId) {
      const { data, error } = await sb.from('user_bans').select('until, reason, created_at').eq('user_id', userId).maybeSingle();
      return !error && banActive(data) ? data : null;
    },
    async bans() {
      const rows = check(await sb.from('user_bans')
        .select('user_id, until, reason, created_at, profiles!user_bans_user_id_fkey(nickname)')
        .order('created_at', { ascending: false }));
      return rows.filter((b) => banActive(b)).map((b) => ({ ...b, nickname: b.profiles?.nickname ?? '' }));
    },
    async banUser(userId, days, reason) {
      const { error } = await sb.rpc('ban_user', { p_user: userId, p_days: days, p_reason: reason });
      if (error) {
        throw friendly(error, [
          [/ban_admin/, 'Komandos nario blokuoti negalima – pirma atimk jo roles'],
          [/ban_self/, 'Savęs blokuoti negalima'],
          [/ban_reason/, 'Įrašyk priežastį (bent 3 simboliai)'],
          [/ban_days/, 'Netinkama trukmė'],
          [/user not found/, 'Žvejys nerastas']
        ], 'Nepavyko užblokuoti');
      }
    },
    async unbanUser(userId) {
      check(await sb.rpc('unban_user', { p_user: userId }));
    },
    async resetNickname(userId) {
      const { data, error } = await sb.rpc('reset_nickname', { p_user: userId });
      if (error) throw friendly(error, [[/duplicate|unique/, 'Automatinis slapyvardis užimtas']], 'Nepavyko pakeisti slapyvardžio');
      return data;
    },

    async exportData() {
      const me = uid();
      const [profile, catches, entries, organized, disputes, notes, trips, reports, follows, clubs, devices] = await Promise.all([
        sb.from('profiles').select('*').eq('id', me).single(),
        sb.from('catches').select(`${CATCH_COLS}, catch_locations(*), catch_spots(*)`).eq('user_id', me).order('captured_at_device'),
        sb.from('entries').select('*').eq('user_id', me),
        sb.from('tournaments').select('*').eq('organizer_id', me),
        sb.from('disputes').select('*').eq('user_id', me),
        myNotes(),
        sb.from('blank_trips').select('*').eq('user_id', me),
        sb.from('catch_reports').select('*').eq('reporter_id', me),
        sb.from('follows').select('followee_id, created_at').eq('follower_id', me),
        sb.from('club_members').select('role, joined_at, clubs(id, name)').eq('user_id', me),
        sb.from('user_devices').select('model, platform, os_version, browser, installed, first_seen, last_seen').eq('user_id', me)
      ]);
      return {
        exported_at: new Date().toISOString(),
        email: user.email ?? null,
        profile: check(profile),
        catches: withNotes(check(catches), notes),
        entries: check(entries),
        tournaments_organized: check(organized),
        disputes: check(disputes),
        blank_trips: trips.error ? [] : trips.data,
        catch_reports: reports.error ? [] : reports.data,
        follows: follows.error ? [] : follows.data,
        clubs: clubs.error ? [] : clubs.data,
        devices: devices.error ? [] : devices.data
      };
    },
    // Paskyros ištrynimas: duomenys -> nuotraukos -> paskyra. Kartoti saugu.
    async deleteAccount(onStep = () => {}) {
      const me = uid();
      onStep('data');
      const begin = await sb.rpc('begin_account_deletion');
      if (begin.error) {
        if (isMissingFunction(begin.error)) {
          const e = new Error('Paskyros ištrynimas laikinai neprieinamas – parašyk mums, ištrinsime rankiniu būdu');
          e.code = 'unavailable';
          throw e;
        }
        throw begin.error;
      }
      onStep('photos');
      const bucket = sb.storage.from(BUCKET);
      for (let guard = 0; guard < 50; guard++) {
        const { data, error } = await bucket.list(me, { limit: 100 });
        if (error) throw error;
        if (!data?.length) break;
        const rm = await bucket.remove(data.map((f) => `${me}/${f.name}`));
        if (rm.error) throw rm.error;
      }
      onStep('account');
      check(await sb.rpc('finish_account_deletion'));
      await sb.auth.signOut().catch(() => {});
      user = null;
    },

    // --- Pranešimai apie įtartinus laimikius ---
    async reportCatch(catchId, reason, message) {
      const { error } = await sb.from('catch_reports').insert({ catch_id: catchId, reason, message: message || null });
      if (error?.code === '23505') throw new Error('Apie šį laimikį jau pranešei');
      if (error) throw friendly(error, [[/report_limit/, 'Per parą galima pranešti ne daugiau kaip 20 kartų']], 'Nepavyko pranešti');
    },
    async myReport(catchId) {
      if (!user) return null;
      return check(await sb.from('catch_reports').select('id, status, reason').eq('catch_id', catchId).eq('reporter_id', user.id).maybeSingle());
    },
    async openReports() {
      const rows = check(await sb.from('catch_reports')
        .select(`*, catches(${CATCH_COLS}), profiles!catch_reports_reporter_id_fkey(nickname)`)
        .eq('status', 'open')
        .order('created_at'));
      return rows.map((r) => ({ ...r, catch: r.catches, reporter: r.profiles?.nickname ?? '' }));
    },
    async resolveReport(id, uphold, reason) {
      check(await sb.rpc('resolve_report', { p_id: id, p_uphold: uphold, p_reason: reason || null }));
    },

    // --- „Nieko nekibo“ ---
    async blankTrips() {
      if (!user) return [];
      return check(await sb.from('blank_trips').select('*').eq('user_id', user.id).order('trip_date', { ascending: false }));
    },
    async addBlankTrip(trip) {
      const { error } = await sb.from('blank_trips').insert(trip);
      if (error) throw friendly(error, [[/trip_limit/, 'Per parą galima įrašyti ne daugiau kaip 10 išvykų'], [/trip_in_future/, 'Data negali būti ateityje']], 'Nepavyko išsaugoti');
    },
    async deleteBlankTrip(id) {
      check(await sb.from('blank_trips').delete().eq('id', id).eq('user_id', uid()));
    },

    // --- Organizatoriaus pranešimai ---
    async announcements(tournamentId) {
      return check(await sb.from('tournament_announcements').select('*').eq('tournament_id', tournamentId).order('created_at', { ascending: false }));
    },
    async postAnnouncement(tournamentId, message) {
      const { error } = await sb.from('tournament_announcements').insert({ tournament_id: tournamentId, message });
      if (error) throw friendly(error, [[/announcement_limit/, 'Per parą – ne daugiau kaip 10 pranešimų']], 'Nepavyko išsiųsti pranešimo');
    },
    async deleteAnnouncement(id) {
      check(await sb.from('tournament_announcements').delete().eq('id', id));
    },

    async pending() {
      const rows = check(await sb.from('catches')
        .select(`${CATCH_COLS}, profiles!catches_user_id_fkey(nickname, trust_score), catch_locations(lat, lng, accuracy_m)`)
        .eq('status', 'pending')
        .order('received_at'));
      return rows.map((r) => {
        const loc = Array.isArray(r.catch_locations) ? r.catch_locations[0] : r.catch_locations;
        return {
          ...r,
          nickname: r.profiles?.nickname ?? '',
          trust_score: r.profiles?.trust_score ?? 50,
          location: loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy_m } : null
        };
      });
    },
    async review(id, approve, reason) {
      check(await sb.rpc('review_catch', { p_catch_id: id, p_approve: approve, p_reason: reason || null }));
    },

    async profile(userId) {
      return check(await sb.from('profiles').select('id, nickname, region, is_admin, roles, created_at').eq('id', userId).maybeSingle());
    },
    async userTournamentCount(userId) {
      const { count, error } = await sb.from('entries').select('tournament_id', { count: 'exact', head: true }).eq('user_id', userId);
      if (error) throw error;
      return count ?? 0;
    }
  };
}
