// Tikras režimas: Supabase (Postgres + autentifikacija + nuotraukų saugykla).
// Visas saugumas – serveryje (RLS taisyklės ir funkcijos), ne čia.
import { SPECIES } from './species.js';
import { PermanentError } from '../lib/outbox.js';

const BUCKET = 'catch-photos';
const PERMANENT_CODES = new Set(['42501', '23514', '23503', '22P02', 'P0001', '42883']);

function isPermanent(err) {
  if (!err) return false;
  const code = String(err.code || '');
  return PERMANENT_CODES.has(code) || code.startsWith('22');
}

export async function createSupabaseBackend(url, anonKey) {
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
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
    participants: t.entries?.[0]?.count ?? 0,
    joined: mine.has(t.id)
  });
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
        sb.from('tournaments').select('*, tournament_species(species_id), entries(count)').order('starts_at'),
        myEntries()
      ]);
      return check(rows).map((t) => decorate(t, mine));
    },
    async tournament(id) {
      const [row, mine] = await Promise.all([
        sb.from('tournaments').select('*, tournament_species(species_id), entries(count)').eq('id', id).maybeSingle(),
        myEntries()
      ]);
      const t = check(row);
      return t ? decorate(t, mine) : null;
    },
    async createTournament(data) {
      const { species_ids, ...rest } = data;
      const t = check(await sb.from('tournaments').insert({ ...rest, organizer_id: uid() }).select('id').single());
      if (species_ids.length) {
        check(await sb.from('tournament_species').insert(species_ids.map((species_id) => ({ tournament_id: t.id, species_id }))));
      }
      check(await sb.from('entries').insert({ tournament_id: t.id, user_id: uid() }));
      return t.id;
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
      return check(await sb.from('catches').select('*').eq('user_id', user.id).order('captured_at_device', { ascending: false }));
    },
    async userCatches(userId) {
      return check(await sb.from('catches').select('*').eq('user_id', userId).order('captured_at_device', { ascending: false }));
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
        photo_sha256: item.sha256
      }).select().single();
      if (ins.error) {
        const msg = `${ins.error.message} ${ins.error.details || ''}`;
        if (ins.error.code === '23505' && /photo_sha256/.test(msg)) {
          throw new PermanentError('Ši nuotrauka jau buvo įkelta', 'duplicate_photo');
        }
        if (ins.error.code === '23505') {
          row = check(await sb.from('catches').select('*').eq('user_id', me).eq('client_id', item.clientId).single());
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

    async pending() {
      const rows = check(await sb.from('catches')
        .select('*, profiles!catches_user_id_fkey(nickname, trust_score), catch_locations(lat, lng, accuracy_m)')
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
