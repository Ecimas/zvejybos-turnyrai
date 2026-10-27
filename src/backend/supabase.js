// Tikras režimas: Supabase (Postgres + autentifikacija + nuotraukų saugykla).
// Visas saugumas – serveryje (RLS taisyklės ir funkcijos), ne čia.
import { SPECIES } from './species.js';
import { PermanentError, RetryLaterError } from '../lib/outbox.js';

const BUCKET = 'catch-photos';
// Versija prisegta: CDN negali netikėtai pakeisti kodo, kuris tvarko prisijungimą.
export const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
// Viešai skaitomi laimikio stulpeliai. Masalas ir pastabos – tik savininkui per my_catch_notes() (0008).
export const CATCH_COLS = 'id, user_id, client_id, species_id, length_mm, weight_g, weather, captured_at_device, received_at, ' +
  'photo_path, photo_sha256, status, reject_reason, reviewed_by, reviewed_at, created_at';
const TOURNAMENT_SEL = '*, tournament_species(species_id), entries(count), tournament_sponsors(id, name, url, amount_cents, sort), ' +
  'tournament_announcements(created_at)';
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
    sponsors: (t.tournament_sponsors || []).slice().sort((a, b) => a.sort - b.sort),
    last_announcement_at: (t.tournament_announcements || []).reduce((m, a) => (!m || a.created_at > m ? a.created_at : m), null),
    participants: t.entries?.[0]?.count ?? 0,
    joined: mine.has(t.id)
  });
  // Savo masalas ir pastabos. Jei funkcijos dar nėra serveryje – tiesiog be jų.
  const myNotes = async () => {
    if (!user) return new Map();
    const { data, error } = await sb.rpc('my_catch_notes');
    if (error) return new Map();
    return new Map((data || []).map((r) => [r.id, r]));
  };
  const withNotes = (rows, notes) => rows.map((c) => ({ ...c, bait: notes.get(c.id)?.bait ?? null, notes: notes.get(c.id)?.notes ?? null }));
  const myEntries = async () => {
    if (!user) return new Set();
    const rows = check(await sb.from('entries').select('tournament_id').eq('user_id', user.id));
    return new Set(rows.map((r) => r.tournament_id));
  };

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
    async signIn(email) {
      check(await sb.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: location.origin + location.pathname }
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
      const { species_ids, sponsors = [], ...rest } = data;
      const ins = await sb.from('tournaments').insert({ ...rest, organizer_id: uid() }).select('id').single();
      if (ins.error) throw friendly(ins.error, [[/tournament_limit/, 'Per parą galima sukurti ne daugiau kaip 10 turnyrų']]);
      const t = ins.data;
      if (species_ids.length) {
        check(await sb.from('tournament_species').insert(species_ids.map((species_id) => ({ tournament_id: t.id, species_id }))));
      }
      if (sponsors.length) {
        check(await sb.from('tournament_sponsors').insert(sponsors.map((s, i) => ({ ...s, tournament_id: t.id, sort: i }))));
      }
      check(await sb.from('entries').insert({ tournament_id: t.id, user_id: uid() }));
      return t.id;
    },
    async updateTournament(id, data) {
      const { species_ids, sponsors, ...rest } = data;
      const rows = check(await sb.from('tournaments').update(rest).eq('id', id).select('id'));
      if (!rows?.length) throw new Error('Turnyras jau prasidėjo – keisti nebegalima');
      if (species_ids) {
        check(await sb.from('tournament_species').delete().eq('tournament_id', id));
        if (species_ids.length) {
          check(await sb.from('tournament_species').insert(species_ids.map((species_id) => ({ tournament_id: id, species_id }))));
        }
      }
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
      if (error) throw friendly(error, [[/invite_invalid/, 'Kvietimas negalioja arba turnyras jau baigėsi']]);
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
      const rows = check(await sb.from('entries').select('tournament_id').eq('user_id', userId));
      return rows.map((r) => r.tournament_id);
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
        weather: item.weather ?? null
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
    async setModerator(nickname, admin) {
      const { error } = await sb.rpc('set_moderator', { p_nickname: nickname, p_admin: admin });
      if (error) {
        throw friendly(error, [
          [/user not found/, 'Tokio slapyvardžio nėra'],
          [/last_admin/, 'Negalima pašalinti paskutinio moderatoriaus']
        ], 'Nepavyko pakeisti');
      }
    },

    async exportData() {
      const me = uid();
      const [profile, catches, entries, organized, disputes, notes, trips, reports] = await Promise.all([
        sb.from('profiles').select('*').eq('id', me).single(),
        sb.from('catches').select(`${CATCH_COLS}, catch_locations(*)`).eq('user_id', me).order('captured_at_device'),
        sb.from('entries').select('*').eq('user_id', me),
        sb.from('tournaments').select('*').eq('organizer_id', me),
        sb.from('disputes').select('*').eq('user_id', me),
        myNotes(),
        sb.from('blank_trips').select('*').eq('user_id', me),
        sb.from('catch_reports').select('*').eq('reporter_id', me)
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
        catch_reports: reports.error ? [] : reports.data
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
      return check(await sb.from('profiles').select('id, nickname, region, created_at').eq('id', userId).maybeSingle());
    },
    async userTournamentCount(userId) {
      const { count, error } = await sb.from('entries').select('tournament_id', { count: 'exact', head: true }).eq('user_id', userId);
      if (error) throw error;
      return count ?? 0;
    }
  };
}
