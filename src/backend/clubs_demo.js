// Demo režimas: klubai+ (0029) – tie patys metodai kaip tikrame režime, duomenys šiame telefone.
import { challengeTop, clubRecords, clubLeaguePoints } from '../lib/clubs.js';

const H = 3600e3;
const D = 24 * H;
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const rid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

import { FEATURE_KEYS } from '../lib/features.js';

export { FEATURE_KEYS };

export function seedClubsPlus(db, ME, logos = {}) {
  db.features ||= {};
  FEATURE_KEYS.forEach((k) => { if (!(k in db.features)) db.features[k] = true; });
  db.feature_meta ||= {};
  db.feature_log ||= [];
  db.banner ||= { body: null, tone: 'info', updated_at: null };
  db.club_join_requests ||= [];
  db.catch_reactions ||= [];
  db.catch_comments ||= [];
  db.club_post_likes ||= [];
  db.club_trip_rsvps ||= [];
  db.club_perks ||= [];
  db.club_images ||= {};
  if (db.club_posts) return;
  const kaunas = db.clubs.find((c) => c.id === 'club-kaunas');
  const members = db.club_members.filter((m) => m.club_id === 'club-kaunas').map((m) => m.user_id);
  const [own, a, b] = members;
  db.club_posts = [];
  db.club_trips = [];
  if (!kaunas || !own) return;
  kaunas.verified = true;
  if (logos['demo-s2']) { db.club_images[`${kaunas.id}/logo-demo`] = logos['demo-s2']; kaunas.logo_path = `${kaunas.id}/logo-demo`; }
  const am = db.club_members.find((m) => m.club_id === 'club-kaunas' && m.user_id === a);
  if (am) am.role = 'admin';
  db.club_posts.push(
    { id: 'cp-1', club_id: 'club-kaunas', author_id: own, kind: 'post', body: 'Šeštadienį susitikimas 8:00 prie Pažaislio prieplaukos – atsiveškite kavos ☕', created_at: iso(-5 * H) },
    { id: 'cp-2', club_id: 'club-kaunas', author_id: b || own, kind: 'tip', body: 'Lapkritį ešeriai laikosi 4–6 m gylyje prie aikštelės, geriausia nuo 9 iki 11 val. Mažas twisteris ant 5 g galvutės.', created_at: iso(-3 * D) }
  );
  db.club_post_likes.push({ post_id: 'cp-2', user_id: own }, { post_id: 'cp-2', user_id: a });
  db.club_trips.push({ id: 'ct-1', club_id: 'club-kaunas', author_id: a || own, starts_at: iso(6 * D), place: 'Kauno marios, Pažaislio prieplauka',
    notes: 'Susitinkam prie Akropolio, veža Tomas', seats: 2, created_at: iso(-H) });
  db.club_trip_rsvps.push({ trip_id: 'ct-1', user_id: a || own, status: 'going' }, { trip_id: 'ct-1', user_id: own, status: 'going' }, { trip_id: 'ct-1', user_id: b || own, status: 'maybe' });
  db.club_perks.push({ club_id: 'club-kaunas', sponsor_name: 'Ežero banga', offer: '−15 % nariams visai prekių grupei', code: 'LYD15', url: null });
  const theirs = db.catches.filter((c) => members.includes(c.user_id) && c.status === 'approved').slice(0, 3);
  theirs.forEach((c, i) => {
    db.catch_reactions.push({ catch_id: c.id, user_id: own, emoji: 'like' }, { catch_id: c.id, user_id: a, emoji: i ? 'like' : 'fire' });
    if (!i) db.catch_comments.push({ id: 'cc-1', catch_id: c.id, user_id: own, body: 'Gražuolis! Ant ko?', reported: false, created_at: iso(-2 * H) },
      { id: 'cc-2', catch_id: c.id, user_id: c.user_id, body: 'Mažas twisteris, prie kranto 🙂', reported: false, created_at: iso(-H) });
  });
}

export function clubsPlusDemo({ getDb, save, ME, perms }) {
  // Demo „atstatymas“ pakeičia visą duomenų objektą – todėl visada imam dabartinį.
  const db = new Proxy({}, { get: (_, k) => getDb()[k], set: (_, k, v) => { getDb()[k] = v; return true; } });
  const nick = (id) => db.profiles[id]?.nickname ?? '';
  const club = (id) => db.clubs.find((c) => c.id === id);
  const member = (id, user = ME) => db.club_members.find((m) => m.club_id === id && m.user_id === user);
  const isAdmin = (id) => ['owner', 'admin'].includes(member(id)?.role);
  const mustMember = (id) => { if (!member(id)) throw new Error('Tik klubo nariams'); };
  const mustAdmin = (id) => { if (!isAdmin(id)) throw new Error('Tik klubo valdytojams'); };
  const featOn = (k) => db.features?.[k] !== false;
  const mustFeat = (k) => { if (!featOn(k)) throw new Error('Ši funkcija šiuo metu išjungta'); };
  const imageUrl = (path) => (path ? db.club_images?.[path] || null : null);
  const shares = (userId) => userId === ME || db.club_members.some((m) => m.user_id === ME
    && db.club_members.some((x) => x.club_id === m.club_id && x.user_id === userId));
  const memberIds = (id) => db.club_members.filter((m) => m.club_id === id).map((m) => m.user_id);
  const decorate = (c) => {
    const { invite_code, ...rest } = c;
    return { ...rest, verified: !!c.verified, logo_url: imageUrl(c.logo_path), cover_url: imageUrl(c.cover_path) };
  };

  return {
    async features() { return { ...db.features }; },
    async setFeature(key, on) {
      if (!perms().has('roles')) throw new Error('Neturi teisės');
      if (!(key in db.features)) throw new Error('Tokios funkcijos nėra');
      if (db.features[key] === !!on) return;
      db.features[key] = !!on;
      const at = new Date().toISOString();
      db.feature_meta[key] = { updated_at: at, by: ME };
      db.feature_log.unshift({ key, enabled: !!on, at, by: ME });
      db.feature_log.splice(30);
      save();
    },
    async featureAdmin() {
      if (!perms().has('roles')) throw new Error('Neturi teisės');
      return {
        features: Object.entries(db.features).map(([key, enabled]) => ({ key, enabled, updated_at: db.feature_meta[key]?.updated_at ?? null,
          by: db.feature_meta[key] ? nick(db.feature_meta[key].by) : null })),
        log: db.feature_log.slice(0, 15).map((x) => ({ ...x, by: nick(x.by) }))
      };
    },
    async banner() { return db.banner?.body ? { ...db.banner } : null; },
    async setBanner(body, tone = 'info') {
      if (!perms().has('roles')) throw new Error('Neturi teisės');
      if (!['info', 'warn'].includes(tone)) throw new Error('Netinkamas tipas');
      const text = String(body || '').trim();
      if (text && (text.length < 3 || text.length > 240)) throw new Error('Skelbimas – nuo 3 iki 240 simbolių');
      const at = new Date().toISOString();
      db.banner = { body: text || null, tone, updated_at: at };
      db.feature_log.unshift({ key: 'banner', enabled: !!text, at, by: ME });
      db.feature_log.splice(30);
      save();
    },
    async clubs() {
      return db.clubs.map((c) => ({ ...decorate(c), members: db.club_members.filter((m) => m.club_id === c.id).length }))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    async club(id) {
      const c = club(id);
      if (!c) return null;
      const order = { owner: 0, admin: 1, member: 2 };
      const members = db.club_members.filter((m) => m.club_id === id)
        .map((m) => ({ user_id: m.user_id, role: m.role, joined_at: m.joined_at, nickname: nick(m.user_id), region: db.profiles[m.user_id]?.region ?? null }))
        .sort((a, b) => order[a.role] - order[b.role] || a.nickname.localeCompare(b.nickname));
      const me = member(id);
      return { ...decorate(c), members, my: me ? { role: me.role, share_map: !!me.share_map } : null };
    },
    async updateClub(id, patch) {
      mustAdmin(id);
      const c = club(id);
      const allowed = ['name', 'region', 'description', 'open', 'logo_path', 'cover_path'];
      for (const k of allowed) if (k in patch) c[k] = patch[k];
      save();
    },
    async removeClubMember(id, userId) {
      const m = member(id, userId);
      const my = member(id);
      if (!m || m.role === 'owner' || !my) return;
      if (!(my.role === 'owner' || (my.role === 'admin' && m.role === 'member'))) return;
      db.club_members = db.club_members.filter((x) => x !== m);
      save();
    },
    async clubJoinRequests(id) {
      if (!isAdmin(id)) return [];
      return db.club_join_requests.filter((r) => r.club_id === id).map((r) => ({ ...r, nickname: nick(r.user_id) }));
    },
    async myJoinRequest(id) {
      return db.club_join_requests.find((r) => r.club_id === id && r.user_id === ME) || null;
    },
    async requestJoinClub(id, message) {
      const c = club(id);
      if (!c) throw new Error('Klubas nerastas');
      if (c.open) throw new Error('Klubas atviras – prisijunk iškart');
      if (member(id)) return;
      db.club_join_requests = db.club_join_requests.filter((r) => !(r.club_id === id && r.user_id === ME));
      db.club_join_requests.push({ club_id: id, user_id: ME, message: String(message || '').trim().slice(0, 200) || null, created_at: new Date().toISOString() });
      save();
    },
    async decideJoinClub(id, userId, approve) {
      mustAdmin(id);
      const r = db.club_join_requests.find((x) => x.club_id === id && x.user_id === userId);
      if (!r) throw new Error('Prašymas nerastas');
      db.club_join_requests = db.club_join_requests.filter((x) => x !== r);
      if (approve && !member(id, userId)) db.club_members.push({ club_id: id, user_id: userId, role: 'member', joined_at: new Date().toISOString() });
      save();
    },
    async setClubAdmin(id, userId, on) {
      if (member(id)?.role !== 'owner') throw new Error('Administratorius skiria tik savininkas');
      const m = member(id, userId);
      if (!m || m.role === 'owner') throw new Error('Narys nerastas');
      m.role = on ? 'admin' : 'member';
      save();
    },
    async uploadClubImage(id, kind, blob) {
      mustAdmin(id);
      const url = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(new Error('Nepavyko nuskaityti'));
        r.readAsDataURL(blob);
      });
      const path = `${id}/${kind}-${Math.random().toString(36).slice(2, 12)}.webp`;
      db.club_images[path] = url;
      save();
      return { path, url };
    },
    async setClubVerified(id, on) {
      if (!perms().has('roles')) throw new Error('Neturi teisės');
      club(id).verified = !!on;
      save();
    },
    async requestClubVerification(id) {
      if (member(id)?.role !== 'owner') throw new Error('Prašyti gali tik savininkas');
    },
    async setClubShareMap(id, on) {
      const m = member(id);
      if (!m) throw new Error('Tik klubo nariams');
      m.share_map = !!on;
      save();
    },

    // Pranešimai ir patarimai
    async clubPosts(id, kind = 'post') {
      if (!member(id)) return [];
      return db.club_posts.filter((p) => p.club_id === id && p.kind === kind)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30)
        .map((p) => {
          const likes = db.club_post_likes.filter((l) => l.post_id === p.id);
          return { ...p, nickname: nick(p.author_id), likes: likes.length, liked: likes.some((l) => l.user_id === ME) };
        });
    },
    async postClub(id, kind, body) {
      mustFeat(kind === 'tip' ? 'club_tips' : 'club_posts');
      if (kind === 'tip') mustMember(id); else mustAdmin(id);
      const text = String(body || '').trim();
      if (text.length < 2 || text.length > 500) throw new Error('Tekstas: 2–500 simbolių');
      db.club_posts.push({ id: rid('cp'), club_id: id, author_id: ME, kind, body: text, created_at: new Date().toISOString() });
      save();
    },
    async deleteClubPost(postId) {
      const p = db.club_posts.find((x) => x.id === postId);
      if (!p || !(p.author_id === ME || isAdmin(p.club_id))) return;
      db.club_posts = db.club_posts.filter((x) => x !== p);
      save();
    },
    async likeClubPost(postId, on) {
      const p = db.club_posts.find((x) => x.id === postId);
      if (!p) return;
      mustMember(p.club_id);
      db.club_post_likes = db.club_post_likes.filter((l) => !(l.post_id === postId && l.user_id === ME));
      if (on) db.club_post_likes.push({ post_id: postId, user_id: ME });
      save();
    },

    // Išvykos
    async clubTrips(id) {
      if (!member(id)) return [];
      return db.club_trips.filter((t) => t.club_id === id && new Date(t.starts_at).getTime() > Date.now() - 6 * H)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((t) => {
          const r = db.club_trip_rsvps.filter((x) => x.trip_id === t.id);
          return { ...t, nickname: nick(t.author_id), going: r.filter((x) => x.status === 'going').map((x) => nick(x.user_id)),
            maybe: r.filter((x) => x.status === 'maybe').map((x) => nick(x.user_id)), my: r.find((x) => x.user_id === ME)?.status ?? null };
        });
    },
    async createTrip(id, { starts_at, place, notes, seats }) {
      mustFeat('club_trips');
      mustMember(id);
      const t = new Date(starts_at).getTime();
      if (!(t > Date.now() - H && t < Date.now() + 120 * D)) throw new Error('Išvykos laikas – nuo dabar iki 4 mėnesių');
      const p = String(place || '').trim();
      if (p.length < 2 || p.length > 80) throw new Error('Nurodyk vietą (2–80 simbolių)');
      const trip = { id: rid('ct'), club_id: id, author_id: ME, starts_at: new Date(t).toISOString(), place: p,
        notes: String(notes || '').trim().slice(0, 300) || null, seats: seats === null || seats === undefined || seats === '' ? null : Math.max(0, Math.min(8, Number(seats))), created_at: new Date().toISOString() };
      db.club_trips.push(trip);
      db.club_trip_rsvps.push({ trip_id: trip.id, user_id: ME, status: 'going' });
      save();
      return trip.id;
    },
    async rsvpTrip(tripId, status) {
      const t = db.club_trips.find((x) => x.id === tripId);
      if (!t) throw new Error('Išvyka nerasta');
      mustMember(t.club_id);
      db.club_trip_rsvps = db.club_trip_rsvps.filter((x) => !(x.trip_id === tripId && x.user_id === ME));
      if (status) db.club_trip_rsvps.push({ trip_id: tripId, user_id: ME, status });
      save();
    },
    async deleteTrip(tripId) {
      const t = db.club_trips.find((x) => x.id === tripId);
      if (!t || !(t.author_id === ME || isAdmin(t.club_id))) return;
      db.club_trips = db.club_trips.filter((x) => x !== t);
      db.club_trip_rsvps = db.club_trip_rsvps.filter((x) => x.trip_id !== tripId);
      save();
    },

    // Reakcijos ir komentarai
    async catchSocial(catchIds) {
      const out = {};
      for (const id of catchIds) {
        const c = db.catches.find((x) => x.id === id);
        if (!c || !shares(c.user_id)) continue;
        const r = db.catch_reactions.filter((x) => x.catch_id === id);
        out[id] = { like: 0, fire: 0, hook: 0, mine: r.filter((x) => x.user_id === ME).map((x) => x.emoji),
          comments: db.catch_comments.filter((x) => x.catch_id === id).length };
        r.forEach((x) => { out[id][x.emoji] += 1; });
      }
      return out;
    },
    async react(catchId, emoji, on) {
      mustFeat('club_reactions');
      const c = db.catches.find((x) => x.id === catchId);
      if (!c || c.status !== 'approved' || !shares(c.user_id)) throw new Error('Reaguoti gali klubo draugai');
      db.catch_reactions = db.catch_reactions.filter((x) => !(x.catch_id === catchId && x.user_id === ME && x.emoji === emoji));
      if (on) db.catch_reactions.push({ catch_id: catchId, user_id: ME, emoji });
      save();
    },
    async catchComments(catchId) {
      const c = db.catches.find((x) => x.id === catchId);
      if (!c || !(shares(c.user_id) || perms().has('review'))) return [];
      return db.catch_comments.filter((x) => x.catch_id === catchId).sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((x) => ({ ...x, nickname: nick(x.user_id) }));
    },
    async addComment(catchId, body) {
      mustFeat('club_comments');
      const c = db.catches.find((x) => x.id === catchId);
      if (!c || c.status !== 'approved' || !shares(c.user_id)) throw new Error('Komentuoti gali klubo draugai');
      const text = String(body || '').trim();
      if (!text || text.length > 300) throw new Error('Komentaras: iki 300 simbolių');
      db.catch_comments.push({ id: rid('cc'), catch_id: catchId, user_id: ME, body: text, reported: false, created_at: new Date().toISOString() });
      save();
    },
    async deleteComment(id) {
      const x = db.catch_comments.find((y) => y.id === id);
      if (!x) return;
      const owner = db.catches.find((c) => c.id === x.catch_id)?.user_id;
      if (!(x.user_id === ME || owner === ME || perms().has('review'))) return;
      db.catch_comments = db.catch_comments.filter((y) => y !== x);
      save();
    },
    async reportComment(id) {
      const x = db.catch_comments.find((y) => y.id === id);
      if (x) { x.reported = true; save(); }
    },
    async reportedComments() {
      if (!perms().has('review')) return [];
      return db.catch_comments.filter((x) => x.reported).map((x) => ({ ...x, nickname: nick(x.user_id) }));
    },
    async dismissCommentReport(id) {
      if (!perms().has('review')) return;
      const x = db.catch_comments.find((y) => y.id === id);
      if (x) { x.reported = false; save(); }
    },

    // Iššūkis, rekordai, lyga
    async clubChallenge(id) {
      mustMember(id);
      const res = challengeTop(db.catches, memberIds(id));
      return { ...res, top: res.top.map((t) => ({ ...t, nickname: nick(t.user_id) })) };
    },
    async clubRecords(id) {
      const res = clubRecords(db.catches, memberIds(id));
      return {
        ...res,
        records: res.records.map((r) => ({ ...r, nickname: nick(r.user_id) })),
        season: res.season.map((s) => ({ ...s, nickname: nick(s.user_id) }))
      };
    },
    async clubLeague() {
      return db.clubs.map((c) => ({ ...decorate(c), members: memberIds(c.id).length, points: clubLeaguePoints(db.catches, memberIds(c.id)) }))
        .filter((c) => c.points > 0).sort((a, b) => b.points - a.points || b.members - a.members);
    },
    async clubMap(id) {
      mustMember(id);
      const sharing = db.club_members.filter((m) => m.club_id === id && m.share_map).map((m) => m.user_id);
      return db.catches.filter((c) => sharing.includes(c.user_id) && c.status === 'approved' && db.locations?.[c.id])
        .map((c) => ({ catch_id: c.id, user_id: c.user_id, nickname: nick(c.user_id), species_id: c.species_id, length_mm: c.length_mm,
          captured_at: c.captured_at_device, lat: Math.round(db.locations[c.id].lat * 100) / 100, lng: Math.round(db.locations[c.id].lng * 100) / 100 }));
    },
    async clubPerk(id) {
      if (!member(id)) return null;
      return db.club_perks.find((p) => p.club_id === id) || null;
    },
    async saveClubPerk(id, perk) {
      mustAdmin(id);
      db.club_perks = db.club_perks.filter((p) => p.club_id !== id);
      if (perk) {
        mustFeat('club_perks');
        const name = String(perk.sponsor_name || '').trim();
        const offer = String(perk.offer || '').trim();
        if (name.length < 2 || offer.length < 2) throw new Error('Nurodyk rėmėją ir pasiūlymą');
        if (perk.code && !/^[A-Za-z0-9_-]{2,24}$/.test(perk.code)) throw new Error('Kodas: 2–24 raidės ar skaičiai');
        if (perk.url && !/^https:\/\/\S{4,300}$/.test(perk.url)) throw new Error('Nuoroda turi prasidėti https://');
        db.club_perks.push({ club_id: id, sponsor_name: name, offer, code: perk.code || null, url: perk.url || null });
      }
      save();
    }
  };
}
