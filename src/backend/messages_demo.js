import { addBusinessDays } from '../lib/workdays.js';
// Demo: vidinės žinutės ir turnyro pabaigos žinutės (kaip serverio 0036) – viskas šiame telefone.
import { payouts, eur } from '../lib/prizes.js';

const D = 24 * 3600e3;

export { addBusinessDays } from '../lib/workdays.js';

export function messagesDemo({ getDb, save, ME, perms, leaderboard }) {
  const db = new Proxy({}, { get: (_, k) => getDb()[k], set: (_, k, v) => { getDb()[k] = v; return true; } });
  const init = () => {
    const x = getDb();
    x.conversations ||= [];
    x.messages ||= [];
    x.message_reports ||= [];
    x.results_sent ||= {};
  };
  const nick = (id) => db.profiles[id]?.nickname ?? '–';
  const conv = (id) => db.conversations.find((c) => c.id === id);
  // Kaip serveryje (on delete cascade): ištrynus turnyrą, jo pokalbių nebelieka.
  const alive = (c) => c.kind === 'support' || db.tournaments.some((t) => t.id === c.tournament_id);
  const party = (c) => !!c && alive(c) && (c.participant_id === ME || c.organizer_id === ME);
  const banned = () => (db.bans || []).some((b) => b.user_id === ME && (!b.until || new Date(b.until) > new Date()));
  const nowIso = () => new Date().toISOString();
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  let msgSeq = 0;
  const addMessage = (c, sender, body, meta = null) => {
    msgSeq += 1;
    const m = { id: Date.now() * 100 + (msgSeq % 100), conversation_id: c.id, sender_id: sender, body, meta, created_at: nowIso() };
    db.messages.push(m);
    c.last_message_at = m.created_at;
    return m;
  };
  const upsert = (tournamentId, kind, participant, fields = {}) => {
    let c = db.conversations.find((x) => x.tournament_id === tournamentId && x.participant_id === participant && x.kind === kind);
    if (!c) {
      const t = db.tournaments.find((x) => x.id === tournamentId);
      c = { id: newId(), tournament_id: tournamentId, kind, organizer_id: kind === 'org' ? t.organizer_id : null, participant_id: participant,
        prize_place: null, prize_cents: null, deadline_at: null, reminded_at: null, handed_at: null, org_read_at: null, part_read_at: null,
        blocked_by: null, last_message_at: nowIso(), created_at: nowIso() };
      db.conversations.push(c);
    }
    Object.assign(c, fields);
    return c;
  };

  // Pasibaigę turnyrai (ne senesni nei 30 d.): rezultatų žinutės visiems, prizininkams – pokalbis su organizatoriumi.
  async function finishDue() {
    init();
    let changed = false;
    for (const t of db.tournaments) {
      const end = new Date(t.ends_at).getTime();
      if (db.results_sent[t.id] || end > Date.now() || end < Date.now() - 30 * D) continue;
      const board = await leaderboard(t.id);
      const pay = payouts(board, t.prize_fund_cents || 0, t.prize_split);
      const items = !(t.prize_fund_cents > 0) && !!(t.prizes || '').trim();
      const entries = db.entries.filter((e) => e.tournament_id === t.id);
      const deadline = addBusinessDays(Date.now(), 3).toISOString();
      let prizers = 0;
      for (const e of entries) {
        const row = board.find((r) => r.user_id === e.user_id);
        const rank = row?.rank ?? null;
        const cents = pay.get(e.user_id) || 0;
        const prize = cents > 0 || (items && rank !== null && rank <= 3);
        let body = prize ? `Sveikiname! Užėmei ${rank} vietą turnyre „${t.title}“${cents > 0 ? ` – prizas ${eur(cents)}` : ' – laimėjai prizą'}.`
          : rank !== null ? `Turnyras „${t.title}“ baigėsi. Užėmei ${rank} vietą iš ${entries.length}. Ačiū, kad dalyvavai!`
          : `Turnyras „${t.title}“ baigėsi. Šį kartą įskaitytų laimikių neturėjai – sėkmės kitą kartą!`;
        let c;
        if (prize && e.user_id !== t.organizer_id) {
          prizers += 1;
          c = upsert(t.id, 'org', e.user_id, { prize_place: rank, prize_cents: cents || null, deadline_at: deadline });
          body += ' Organizatorius su tavimi susisieks per 3 darbo dienas čia, programėlės žinutėse.';
        } else {
          c = upsert(t.id, 'system', e.user_id, prize ? { prize_place: rank, prize_cents: cents || null } : {});
        }
        addMessage(c, null, body, { event: 'result', place: rank, total: entries.length, score_mm: row ? Number(row.score_mm) : null,
          counted: row ? Number(row.counted) : 0, prize, prize_cents: cents || null });
      }
      db.results_sent[t.id] = nowIso();
      changed = true;
      void prizers;
    }
    if (changed) save();
  }

  const unreadOf = (c) => {
    const mineOrg = c.organizer_id === ME;
    const seen = mineOrg ? c.org_read_at : c.part_read_at;
    return db.messages.filter((m) => m.conversation_id === c.id && m.sender_id !== ME && !(mineOrg && m.sender_id === null)
      && (!seen || m.created_at > seen)).length;
  };
  const listMine = () => db.conversations
    .filter((c) => party(c) && (c.participant_id === ME || c.prize_place !== null || db.messages.some((m) => m.conversation_id === c.id && m.sender_id)))
    .map((c) => {
      const t = db.tournaments.find((x) => x.id === c.tournament_id);
      const msgs = db.messages.filter((m) => m.conversation_id === c.id);
      const last = msgs[msgs.length - 1];
      const other = c.organizer_id === ME ? c.participant_id : c.organizer_id;
      return { id: c.id, tournament_id: c.tournament_id, tournament_title: c.kind === 'support' ? 'Pagalba' : t?.title ?? '–', kind: c.kind, i_organize: c.organizer_id === ME,
        other_id: other, other_nick: other ? nick(other) : null, prize_place: c.prize_place, prize_cents: c.prize_cents, handed_at: c.handed_at,
        deadline_at: c.deadline_at, blocked: !!c.blocked_by, blocked_by_me: c.blocked_by === ME, last_message_at: c.last_message_at,
        last_body: last?.body ?? null, last_mine: last?.sender_id === ME, last_system: !!last && last.sender_id === null, unread: unreadOf(c),
        other_wrote: !!other && msgs.some((m) => m.sender_id === other) };
    })
    .sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));

  // ---- „Svarbu“: pranešimų centras (demo – keli pavyzdiniai pranešimai)
  const notices = () => {
    const x = getDb();
    if (!x.user_notices) {
      const mine = (x.catches || []).filter((c) => c.user_id === ME && c.status === 'approved').slice(0, 1);
      x.user_notices = mine.map((c, i) => ({ id: i + 1, kind: 'review', title: 'Laimikis patvirtintas',
        body: `${c.length_mm / 10} cm – įskaitytas į turnyrus`, url: '#/dienorastis', created_at: new Date(Date.now() - 3 * D).toISOString() }));
      x.notices_seen_at = new Date(Date.now() - 4 * D).toISOString();
    }
    return x.user_notices;
  };
  const noticesUnread = () => notices().filter((n) => n.created_at > (getDb().notices_seen_at || '')).length;

  // ---- Klubų pokalbiai (demo)
  const clubOn = () => getDb().features?.club_chat !== false;
  const memberOf = (clubId, user = ME) => (db.club_members || []).find((m) => m.club_id === clubId && m.user_id === user);
  const isClubAdmin = (clubId) => ['owner', 'admin'].includes(memberOf(clubId)?.role);
  const cstate = (clubId, user = ME) => {
    const x = getDb();
    x.club_chat_state ||= [];
    let st = x.club_chat_state.find((r) => r.club_id === clubId && r.user_id === user);
    if (!st) { st = { club_id: clubId, user_id: user, read_at: null, push: true, muted_until: null }; x.club_chat_state.push(st); }
    return st;
  };
  const cmsgs = (clubId) => {
    const x = getDb();
    x.club_messages ||= [];
    x.club_reactions ||= [];
    // Pirmą kartą – keli kitų narių pranešimai, kad pokalbis nebūtų tuščias
    if (!x.club_chat_seeded?.[clubId]) {
      x.club_chat_seeded = { ...(x.club_chat_seeded || {}), [clubId]: true };
      const others = (db.club_members || []).filter((m) => m.club_id === clubId && m.user_id !== ME);
      const texts = ['Labas visiems! Kas savaitgalį važiuoja prie vandens?', 'Aš šeštadienį 6:00 – slėgis kyla, vėjas silpnas 🎣', 'Galiu paimti du žmones, rašykit.'];
      others.slice(0, 3).forEach((m, i) => x.club_messages.push({ id: Date.now() - 1000 + i, club_id: clubId, sender_id: m.user_id, body: texts[i], catch: null,
        deleted_at: null, created_at: new Date(Date.now() - (5 - i) * 3600e3).toISOString() }));
    }
    return x.club_messages.filter((m) => m.club_id === clubId).sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
  };
  const chatRow = (c) => {
    const m = memberOf(c.id);
    const list = cmsgs(c.id);
    const last = list[list.length - 1];
    const st = cstate(c.id);
    const since = st.read_at && st.read_at > m.joined_at ? st.read_at : m.joined_at;
    const pin = c.chat_pin_id ? list.find((x) => x.id === c.chat_pin_id && !x.deleted_at) : null;
    return { club_id: c.id, name: c.name, logo_path: c.logo_path || null, logo_url: c.logo_path ? (getDb().logos || {})[c.logo_path] || null : null,
      members: (db.club_members || []).filter((x) => x.club_id === c.id).length, my_role: m.role, push: st.push, muted_until: st.muted_until,
      last_at: last?.created_at || m.joined_at, last_body: last ? (last.deleted_at ? 'Žinutė ištrinta' : last.body || '🐟 Pasidalino laimikiu') : null,
      last_nick: last ? nick(last.sender_id) : null, last_mine: last?.sender_id === ME,
      unread: list.filter((x) => !x.deleted_at && x.sender_id !== ME && x.created_at > since).length, pin_body: pin ? pin.body || '🐟 laimikis' : null };
  };
  const myClubChats = () => (db.clubs || []).filter((c) => memberOf(c.id)).map(chatRow).sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
  const findClubMsg = (id) => (getDb().club_messages || []).find((m) => m.id === id);

  return {
    async unreadCount() {
      await finishDue();
      return listMine().reduce((s, x) => s + x.unread, 0) + noticesUnread() + myClubChats().reduce((s, x) => s + x.unread, 0);
    },
    async notices() {
      const seen = getDb().notices_seen_at || '';
      return notices().slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).map((n) => ({ ...n, unread: n.created_at > seen }));
    },
    async markNoticesSeen() { getDb().notices_seen_at = nowIso(); save(); },
    async clubChats() { return myClubChats(); },
    async clubChat(clubId) {
      const c = (db.clubs || []).find((x) => x.id === clubId);
      if (!c || !memberOf(clubId)) return null;
      const reactions = getDb().club_reactions || [];
      const row = chatRow(c);
      const messages = cmsgs(clubId).map((m) => {
        const rs = reactions.filter((r) => r.message_id === m.id);
        return { id: m.id, sender_id: m.sender_id, nickname: nick(m.sender_id), role: memberOf(clubId, m.sender_id)?.role ?? null,
          body: m.deleted_at ? null : m.body, catch: m.deleted_at ? null : m.catch, deleted: !!m.deleted_at, created_at: m.created_at,
          reactions: rs.reduce((o, r) => ({ ...o, [r.emoji]: (o[r.emoji] || 0) + 1 }), {}), mine: rs.filter((r) => r.user_id === ME).map((r) => r.emoji) };
      });
      return { ...row, pin_id: c.chat_pin_id || null, messages };
    },
    async clubChatSend(clubId, body, catchId = null) {
      if (!memberOf(clubId)) throw new Error('Neturi teisės');
      if (!clubOn()) throw new Error('Klubų pokalbiai šiuo metu išjungti');
      if (banned()) throw new Error('Tavo paskyra užblokuota');
      const st = cstate(clubId);
      if (st.muted_until && st.muted_until > nowIso()) throw new Error('Klubo valdytojas laikinai nutildė tave šiame pokalbyje');
      const text = String(body || '').trim() || null;
      if (text && text.length > 2000) throw new Error('Žinutė turi būti 1–2000 simbolių');
      let card = null;
      if (catchId) {
        const c = (getDb().catches || []).find((x) => x.id === catchId && x.user_id === ME && x.status !== 'rejected');
        if (!c) throw new Error('Šio laimikio pasidalinti negalima');
        card = { id: c.id, species_id: c.species_id, length_mm: c.length_mm, weight_g: c.weight_g ?? null, captured_at: c.captured_at_device, status: c.status };
      }
      if (!text && !card) throw new Error('Žinutė turi būti 1–2000 simbolių');
      cmsgs(clubId);
      msgSeq += 1;
      const m = { id: Date.now() * 100 + (msgSeq % 100), club_id: clubId, sender_id: ME, body: text, catch: card, deleted_at: null, created_at: nowIso() };
      getDb().club_messages.push(m);
      st.read_at = m.created_at;
      save();
      return m.id;
    },
    async clubChatRead(clubId) { if (memberOf(clubId)) { cstate(clubId).read_at = nowIso(); save(); } },
    async clubChatReact(messageId, emoji) {
      const m = findClubMsg(messageId);
      if (!m || m.deleted_at || !memberOf(m.club_id)) throw new Error('Neturi teisės');
      if (!['👍', '🔥', '🎣'].includes(emoji)) throw new Error('Netinkama reakcija');
      const x = getDb();
      const i = x.club_reactions.findIndex((r) => r.message_id === messageId && r.user_id === ME && r.emoji === emoji);
      if (i >= 0) { x.club_reactions.splice(i, 1); save(); return false; }
      x.club_reactions.push({ message_id: messageId, user_id: ME, emoji });
      save();
      return true;
    },
    async clubChatDelete(messageId) {
      const m = findClubMsg(messageId);
      if (!m || (m.sender_id !== ME && !isClubAdmin(m.club_id))) throw new Error('Neturi teisės');
      Object.assign(m, { body: null, catch: null, deleted_at: m.deleted_at || nowIso() });
      const c = db.clubs.find((x) => x.id === m.club_id);
      if (c?.chat_pin_id === m.id) c.chat_pin_id = null;
      save();
    },
    async clubChatPin(clubId, messageId) {
      if (!isClubAdmin(clubId)) throw new Error('Neturi teisės');
      db.clubs.find((x) => x.id === clubId).chat_pin_id = messageId || null;
      save();
    },
    async clubChatMute(clubId, userId, hours) {
      if (!isClubAdmin(clubId) || userId === ME || memberOf(clubId, userId)?.role === 'owner') throw new Error('Neturi teisės');
      if (!memberOf(clubId, userId)) throw new Error('Nario nėra');
      cstate(clubId, userId).muted_until = hours > 0 ? new Date(Date.now() + hours * 3600e3).toISOString() : null;
      save();
    },
    async clubChatSetPush(clubId, on) { if (!memberOf(clubId)) throw new Error('Neturi teisės'); cstate(clubId).push = !!on; save(); },
    async clubChatReport(messageId, reason) {
      const m = findClubMsg(messageId);
      if (!m || !memberOf(m.club_id) || m.sender_id === ME || m.deleted_at) throw new Error('Neturi teisės');
      const x = getDb();
      x.club_message_reports ||= [];
      if (!x.club_message_reports.some((r) => r.message_id === messageId && r.reporter_id === ME)) {
        x.club_message_reports.push({ message_id: messageId, reporter_id: ME, reason: reason || null, created_at: nowIso() });
      }
      save();
    },
    async conversations() {
      await finishDue();
      return listMine();
    },
    async conversation(id) {
      init();
      const c = conv(id);
      if (!party(c)) return null;
      const t = db.tournaments.find((x) => x.id === c.tournament_id);
      const other = c.organizer_id === ME ? c.participant_id : c.organizer_id;
      return { ...c, tournament_title: c.kind === 'support' ? 'Pagalba' : t?.title ?? '–', tournament_format: t?.format, i_organize: c.organizer_id === ME, other_id: other,
        other_nick: other ? nick(other) : null, blocked: !!c.blocked_by, blocked_by_me: c.blocked_by === ME,
        messages: db.messages.filter((m) => m.conversation_id === id).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id - b.id)) };
    },
    async startConversation(tournamentId, userId = null) {
      init();
      const t = db.tournaments.find((x) => x.id === tournamentId);
      if (!t) throw new Error('Turnyras nerastas');
      if (banned()) throw new Error('Tavo paskyra užblokuota');
      const entered = (u) => db.entries.some((e) => e.tournament_id === t.id && e.user_id === u);
      let part;
      if (t.organizer_id === ME) {
        if (!userId || userId === ME || !entered(userId)) throw new Error('Rašyti galima tik savo turnyro dalyviams');
        part = userId;
      } else if (entered(ME) && (!userId || userId === t.organizer_id)) {
        part = ME;
      } else {
        throw new Error('Rašyti galima tik turnyro organizatoriui');
      }
      const c = upsert(t.id, 'org', part);
      save();
      return c.id;
    },
    // Pagalba: žvejo pokalbis su komanda (demo – tik žvejo pusė, atsako automatinė žinutė).
    async startSupport() {
      init();
      let c = db.conversations.find((x) => x.kind === 'support' && x.participant_id === ME);
      if (!c) {
        c = { id: newId(), tournament_id: null, kind: 'support', organizer_id: null, participant_id: ME, prize_place: null, prize_cents: null,
          deadline_at: null, reminded_at: null, handed_at: null, org_read_at: null, part_read_at: null, blocked_by: null,
          last_message_at: nowIso(), created_at: nowIso() };
        db.conversations.push(c);
        save();
      }
      return c.id;
    },
    async sendMessage(id, body) {
      init();
      const c = conv(id);
      if (!party(c)) throw new Error('Neturi teisės');
      if (c.kind === 'system') throw new Error('Į automatinę žinutę atsakyti negalima');
      if (c.blocked_by) throw new Error('Pokalbis užblokuotas');
      if (banned()) throw new Error('Tavo paskyra užblokuota');
      const text = String(body || '').trim();
      if (!text || text.length > 2000) throw new Error('Žinutė turi būti 1–2000 simbolių');
      const recent = db.messages.filter((m) => m.sender_id === ME && Date.parse(m.created_at) > Date.now() - 10 * 60e3).length;
      if (recent >= 30) throw new Error('Per daug žinučių – palauk kelias minutes');
      const m = addMessage(c, ME, text);
      if (c.organizer_id === ME) c.org_read_at = m.created_at; else c.part_read_at = m.created_at;
      if (c.kind === 'support' && !db.messages.some((x) => x.conversation_id === c.id && x.meta?.event === 'support_auto')) {
        addMessage(c, null, 'Ačiū! Žinutę gavome – komanda atsakys čia, dažniausiai per 1 darbo dieną. (Demonstraciniame režime atsakymų nėra.)', { event: 'support_auto' });
      }
      save();
      return m.id;
    },
    async markRead(id) {
      init();
      const c = conv(id);
      if (!party(c)) return;
      const now = nowIso();
      if (c.organizer_id === ME) c.org_read_at = now;
      if (c.participant_id === ME) c.part_read_at = now;
      save();
    },
    async setPrizeHanded(id, on) {
      init();
      const c = conv(id);
      if (!c || c.organizer_id !== ME || c.prize_place === null) throw new Error('Neturi teisės');
      if (on && !c.handed_at) {
        c.handed_at = nowIso();
        addMessage(c, null, 'Organizatorius pažymėjo, kad prizas įteiktas.', { event: 'handed' });
      } else if (!on) {
        c.handed_at = null;
      }
      save();
    },
    async prizeStatus(tournamentId) {
      await finishDue();
      const t = db.tournaments.find((x) => x.id === tournamentId);
      if (!t || (t.organizer_id !== ME && !perms().has('tournaments'))) return [];
      return db.conversations.filter((c) => c.tournament_id === tournamentId && c.kind === 'org' && c.prize_place !== null)
        .map((c) => {
          const msgs = db.messages.filter((m) => m.conversation_id === c.id);
          return { participant_id: c.participant_id, nickname: nick(c.participant_id), prize_place: c.prize_place, prize_cents: c.prize_cents,
            conversation_id: c.id, organizer_wrote: msgs.some((m) => m.sender_id === c.organizer_id), replied: msgs.some((m) => m.sender_id === c.participant_id),
            handed_at: c.handed_at, deadline_at: c.deadline_at, reminded_at: c.reminded_at };
        })
        .sort((a, b) => a.prize_place - b.prize_place || a.nickname.localeCompare(b.nickname));
    },
    async blockConversation(id, on) {
      init();
      const c = conv(id);
      if (!party(c) || c.kind !== 'org') throw new Error('Neturi teisės');
      if (on && !c.blocked_by) c.blocked_by = ME;
      else if (!on && c.blocked_by === ME) c.blocked_by = null;
      save();
    },
    async reportMessage(messageId, reason) {
      init();
      const m = db.messages.find((x) => x.id === messageId);
      const c = m && conv(m.conversation_id);
      if (!party(c) || !m.sender_id || m.sender_id === ME) throw new Error('Neturi teisės');
      if (!db.message_reports.some((r) => r.message_id === messageId && r.reporter_id === ME)) {
        db.message_reports.push({ id: Date.now(), message_id: messageId, reporter_id: ME, reason: String(reason || '').trim().slice(0, 300) || null,
          created_at: nowIso(), resolved_at: null });
      }
      save();
    },
    async reportedMessages() {
      init();
      if (!perms().has('ban')) return [];
      return db.message_reports.map((r) => {
        const m = db.messages.find((x) => x.id === r.message_id);
        const c = m && conv(m.conversation_id);
        const t = c && db.tournaments.find((x) => x.id === c.tournament_id);
        return { report_id: r.id, message_id: r.message_id, body: m?.body ?? '', sender_id: m?.sender_id, sender_nick: nick(m?.sender_id),
          reporter_nick: nick(r.reporter_id), reason: r.reason, tournament_title: t?.title ?? '–', created_at: r.created_at, resolved_at: r.resolved_at };
      }).sort((a, b) => (!!a.resolved_at - !!b.resolved_at) || (a.created_at < b.created_at ? 1 : -1));
    },
    async resolveMessageReport(id) {
      init();
      if (!perms().has('ban')) throw new Error('Neturi teisės');
      const r = db.message_reports.find((x) => x.id === id);
      if (r && !r.resolved_at) r.resolved_at = nowIso();
      save();
    }
  };
}
