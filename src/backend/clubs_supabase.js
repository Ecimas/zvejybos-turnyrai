// Tikras režimas: klubai+ (0029). Kol migracija neįdiegta – funkcijos tiesiog nerodomos (klaidos neišmetamos skaitymui).
const IMAGES = 'club-images';
const OLD_COLS = 'id, name, region, description, owner_id, open, created_at';
const NEW_COLS = `${OLD_COLS}, logo_path, cover_path, verified`;

const missing = (error) => {
  const code = String(error?.code || '');
  const m = String(error?.message || '');
  return ['42703', '42P01', 'PGRST200', 'PGRST202', 'PGRST204', 'PGRST205', '42883'].includes(code)
    || /does not exist|could not find|schema cache/i.test(m);
};

export function clubsPlusSupabase({ sb, check, uid, getUser, friendly }) {
  let v2 = null; // ar įdiegta 0029
  const imageUrl = (path) => (path ? sb.storage.from(IMAGES).getPublicUrl(path).data.publicUrl : null);
  const decorate = (c) => ({ ...c, verified: !!c.verified, logo_url: imageUrl(c.logo_path), cover_url: imageUrl(c.cover_path) });
  async function nicks(ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return new Map();
    const { data } = await sb.from('profiles').select('id, nickname').in('id', list);
    return new Map((data || []).map((p) => [p.id, p.nickname]));
  }
  async function trySelect(build) {
    if (v2 !== false) {
      const res = await build(true);
      if (!res.error) { v2 = true; return res; }
      if (!missing(res.error)) throw res.error;
      v2 = false;
    }
    const res = await build(false);
    if (res.error) throw res.error;
    return res;
  }
  const notInstalled = () => new Error('Ši funkcija dar neįdiegta serveryje');
  const errors = [
    [/feature_off/, 'Ši funkcija šiuo metu išjungta'],
    [/post_limit/, 'Per daug įrašų per parą – pabandyk rytoj'],
    [/trip_limit/, 'Per daug išvykų per parą'],
    [/trip_time/, 'Išvykos laikas – nuo dabar iki 4 mėnesių'],
    [/comment_limit/, 'Per daug komentarų – pailsėk valandėlę'],
    [/club_open/, 'Klubas atviras – prisijunk iškart'],
    [/club_member_limit/, 'Žvejys gali būti iki 10 klubų narys'],
    [/request_not_found/, 'Prašymas nerastas'],
    [/row-level security|not allowed|permission denied/i, 'Neturi teisės'],
    [/check constraint|violates check/i, 'Patikrink įvestus duomenis']
  ];
  const fail = (error, fallback) => {
    if (missing(error)) return notInstalled();
    return friendly(error, errors, fallback);
  };
  const rpc = async (name, args, fallback) => {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw fail(error, fallback);
    return data;
  };

  return {
    async features() {
      const { data, error } = await sb.from('app_features').select('key, enabled');
      if (error) return {};
      return Object.fromEntries(data.map((f) => [f.key, f.enabled]));
    },
    async setFeature(key, on) { await rpc('set_feature', { p_key: key, p_on: !!on }, 'Nepavyko pakeisti'); },
    // Administravimo panelei: jungikliai su „kas ir kada“ ir paskutiniai pakeitimai.
    async featureAdmin() {
      const [f, l] = await Promise.all([
        sb.from('app_features').select('key, enabled, updated_at, updated_by'),
        sb.from('app_feature_log').select('key, enabled, changed_at, changed_by').order('changed_at', { ascending: false }).limit(15)
      ]);
      if (f.error) throw fail(f.error, 'Nepavyko įkelti funkcijų');
      const log = l.error ? [] : l.data;
      const names = await nicks([...f.data.map((x) => x.updated_by), ...log.map((x) => x.changed_by)]);
      return {
        features: f.data.map((x) => ({ key: x.key, enabled: x.enabled, updated_at: x.updated_at, by: names.get(x.updated_by) ?? null })),
        log: log.map((x) => ({ key: x.key, enabled: x.enabled, at: x.changed_at, by: names.get(x.changed_by) ?? null }))
      };
    },
    // Vietos skaitiklis: kiek vietos užima failai saugykloje (tik savininkui).
    async storageUsage() {
      const { data, error } = await sb.rpc('storage_usage');
      if (error) throw fail(error, 'Nepavyko įkelti vietos skaitiklio');
      return (data || []).map((r) => ({ bucket: r.bucket, files: Number(r.files) || 0, bytes: Number(r.bytes) || 0,
        thumbs: Number(r.thumbs) || 0, thumb_bytes: Number(r.thumb_bytes) || 0 }));
    },
    async banner() {
      const { data, error } = await sb.from('app_banner').select('body, tone, updated_at').eq('id', 1).maybeSingle();
      if (error || !data?.body) return null;
      return data;
    },
    async setBanner(body, tone = 'info') { await rpc('set_banner', { p_body: body || '', p_tone: tone }, 'Nepavyko išsaugoti skelbimo'); },

    async clubs() {
      const { data } = await trySelect((nw) => sb.from('clubs').select(`${nw ? NEW_COLS : OLD_COLS}, club_members(count)`).order('name'));
      return data.map((c) => ({ ...decorate(c), members: c.club_members?.[0]?.count ?? 0 }));
    },
    async club(id) {
      const { data } = await trySelect((nw) => sb.from('clubs')
        .select(`${nw ? NEW_COLS : OLD_COLS}, club_members(user_id, role, joined_at${nw ? ', share_map' : ''}, profiles(nickname, region))`).eq('id', id).maybeSingle());
      if (!data) return null;
      const order = { owner: 0, admin: 1, member: 2 };
      const raw = data.club_members || [];
      const members = raw.map((m) => ({ user_id: m.user_id, role: m.role, joined_at: m.joined_at, nickname: m.profiles?.nickname ?? '', region: m.profiles?.region ?? null }))
        .sort((a, b) => (order[a.role] ?? 2) - (order[b.role] ?? 2) || a.nickname.localeCompare(b.nickname));
      const meId = getUser()?.id;
      const me = raw.find((m) => m.user_id === meId);
      const { club_members: _drop, ...rest } = data;
      return { ...decorate(rest), members, my: me ? { role: me.role, share_map: !!me.share_map } : null, v2: !!v2 };
    },
    async clubJoinRequests(id) {
      const { data, error } = await sb.from('club_join_requests').select('user_id, message, created_at').eq('club_id', id).order('created_at');
      if (error) return [];
      const n = await nicks(data.map((r) => r.user_id));
      return data.map((r) => ({ ...r, club_id: id, nickname: n.get(r.user_id) ?? '' }));
    },
    async myJoinRequest(id) {
      if (!getUser()) return null;
      const { data, error } = await sb.from('club_join_requests').select('message, created_at').eq('club_id', id).eq('user_id', getUser().id).maybeSingle();
      return error ? null : data;
    },
    async requestJoinClub(id, message) { await rpc('request_join_club', { p_club: id, p_message: message || null }, 'Nepavyko išsiųsti prašymo'); },
    async decideJoinClub(id, userId, approve) { await rpc('decide_join_club', { p_club: id, p_user: userId, p_approve: !!approve }, 'Nepavyko'); },
    async setClubAdmin(id, userId, on) { await rpc('set_club_admin', { p_club: id, p_user: userId, p_on: !!on }, 'Nepavyko pakeisti rolės'); },
    async uploadClubImage(id, kind, blob) {
      const ext = blob.type === 'image/png' && kind === 'logo' ? 'png' : blob.type === 'image/jpeg' ? 'jpg' : 'webp';
      const path = `${id}/${kind}-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}.${ext}`;
      const { error } = await sb.storage.from(IMAGES).upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
      if (error) throw friendly(error, [[/row-level security|403|Unauthorized/i, 'Neturi teisės keisti klubo nuotraukų'], [/size|too large|413/i, 'Nuotrauka per didelė'], [/bucket/i, 'Ši funkcija dar neįdiegta serveryje']], 'Nepavyko įkelti nuotraukos');
      return { path, url: imageUrl(path) };
    },
    async setClubVerified(id, on) { await rpc('set_club_verified', { p_club: id, p_on: !!on }, 'Nepavyko'); },
    async requestClubVerification(id) { await rpc('request_club_verification', { p_club: id }, 'Nepavyko išsiųsti prašymo'); },
    async setClubShareMap(id, on) { await rpc('set_club_share_map', { p_club: id, p_on: !!on }, 'Nepavyko išsaugoti'); },

    async clubPosts(id, kind = 'post') {
      const { data, error } = await sb.from('club_posts').select('id, club_id, author_id, kind, body, created_at, club_post_likes(user_id)')
        .eq('club_id', id).eq('kind', kind).order('created_at', { ascending: false }).limit(30);
      if (error) return [];
      const n = await nicks(data.map((p) => p.author_id));
      const me = getUser()?.id;
      return data.map(({ club_post_likes: likes = [], ...p }) => ({ ...p, nickname: n.get(p.author_id) ?? '', likes: likes.length, liked: likes.some((l) => l.user_id === me) }));
    },
    async postClub(id, kind, body) {
      const { error } = await sb.from('club_posts').insert({ club_id: id, kind, body });
      if (error) throw fail(error, 'Nepavyko paskelbti');
    },
    async deleteClubPost(postId) { check(await sb.from('club_posts').delete().eq('id', postId)); },
    async likeClubPost(postId, on) {
      const { error } = on ? await sb.from('club_post_likes').insert({ post_id: postId })
        : await sb.from('club_post_likes').delete().eq('post_id', postId).eq('user_id', uid());
      if (error && !/duplicate/i.test(error.message || '')) throw fail(error, 'Nepavyko');
    },

    async clubTrips(id) {
      const { data, error } = await sb.from('club_trips').select('id, club_id, author_id, starts_at, place, notes, seats, created_at, club_trip_rsvps(user_id, status)')
        .eq('club_id', id).gte('starts_at', new Date(Date.now() - 6 * 3600e3).toISOString()).order('starts_at');
      if (error) return [];
      const n = await nicks(data.flatMap((t) => [t.author_id, ...(t.club_trip_rsvps || []).map((r) => r.user_id)]));
      const me = getUser()?.id;
      return data.map(({ club_trip_rsvps: r = [], ...t }) => ({
        ...t, nickname: n.get(t.author_id) ?? '',
        going: r.filter((x) => x.status === 'going').map((x) => n.get(x.user_id) ?? ''),
        maybe: r.filter((x) => x.status === 'maybe').map((x) => n.get(x.user_id) ?? ''),
        my: r.find((x) => x.user_id === me)?.status ?? null
      }));
    },
    async createTrip(id, { starts_at, place, notes, seats }) {
      const { data, error } = await sb.from('club_trips').insert({ club_id: id, starts_at, place, notes: notes || null, seats: seats === '' || seats === undefined ? null : seats })
        .select('id').single();
      if (error) throw fail(error, 'Nepavyko sukurti išvykos');
      return data.id;
    },
    async rsvpTrip(tripId, status) { await rpc('rsvp_trip', { p_trip: tripId, p_status: status || null }, 'Nepavyko'); },
    async deleteTrip(tripId) { check(await sb.from('club_trips').delete().eq('id', tripId)); },

    async catchSocial(catchIds) {
      if (!catchIds.length) return {};
      const [r, c] = await Promise.all([
        sb.from('catch_reactions').select('catch_id, user_id, emoji').in('catch_id', catchIds),
        sb.from('catch_comments').select('catch_id').in('catch_id', catchIds)
      ]);
      if (r.error) return {};
      const me = getUser()?.id;
      const out = Object.fromEntries(catchIds.map((id) => [id, { like: 0, fire: 0, hook: 0, mine: [], comments: 0 }]));
      for (const x of r.data) { const o = out[x.catch_id]; if (!o) continue; o[x.emoji] += 1; if (x.user_id === me) o.mine.push(x.emoji); }
      for (const x of c.data || []) if (out[x.catch_id]) out[x.catch_id].comments += 1;
      return out;
    },
    async react(catchId, emoji, on) {
      const { error } = on ? await sb.from('catch_reactions').insert({ catch_id: catchId, emoji })
        : await sb.from('catch_reactions').delete().eq('catch_id', catchId).eq('user_id', uid()).eq('emoji', emoji);
      if (error && !/duplicate/i.test(error.message || '')) throw fail(error, 'Nepavyko');
    },
    async catchComments(catchId) {
      const { data, error } = await sb.from('catch_comments').select('id, catch_id, user_id, body, reported, created_at').eq('catch_id', catchId).order('created_at');
      if (error) return [];
      const n = await nicks(data.map((x) => x.user_id));
      return data.map((x) => ({ ...x, nickname: n.get(x.user_id) ?? '' }));
    },
    async addComment(catchId, body) {
      const { error } = await sb.from('catch_comments').insert({ catch_id: catchId, body });
      if (error) throw fail(error, 'Nepavyko parašyti komentaro');
    },
    async deleteComment(id) { check(await sb.from('catch_comments').delete().eq('id', id)); },
    async reportComment(id) { await rpc('report_comment', { p_comment: id }, 'Nepavyko pranešti'); },
    async reportedComments() {
      const { data, error } = await sb.from('catch_comments').select('id, catch_id, user_id, body, created_at').eq('reported', true).order('created_at').limit(50);
      if (error) return [];
      const n = await nicks(data.map((x) => x.user_id));
      return data.map((x) => ({ ...x, nickname: n.get(x.user_id) ?? '' }));
    },
    async dismissCommentReport(id) { await rpc('dismiss_comment_report', { p_comment: id }, 'Nepavyko'); },

    async clubChallenge(id) { return rpc('club_challenge', { p_club: id }, 'Nepavyko gauti iššūkio'); },
    async clubRecords(id) { return rpc('club_records', { p_club: id }, 'Nepavyko gauti rekordų'); },
    async clubLeague() {
      const data = await rpc('club_league', {}, 'Nepavyko gauti lygos');
      return (data || []).map((c) => ({ ...c, logo_url: imageUrl(c.logo_path) }));
    },
    async clubMap(id) { return (await rpc('club_map', { p_club: id }, 'Nepavyko gauti žemėlapio')) || []; },
    async clubPerk(id) {
      const { data, error } = await sb.from('club_perks').select('sponsor_name, offer, code, url').eq('club_id', id).maybeSingle();
      return error ? null : data;
    },
    async saveClubPerk(id, perk) {
      const { error } = perk
        ? await sb.from('club_perks').upsert({ club_id: id, sponsor_name: perk.sponsor_name, offer: perk.offer, code: perk.code || null, url: perk.url || null, updated_at: new Date().toISOString() })
        : await sb.from('club_perks').delete().eq('club_id', id);
      if (error) throw fail(error, 'Nepavyko išsaugoti nuolaidos');
    }
  };
}
