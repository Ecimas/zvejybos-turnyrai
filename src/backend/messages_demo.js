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
        last_body: last?.body ?? null, last_mine: last?.sender_id === ME, last_system: !!last && last.sender_id === null, unread: unreadOf(c) };
    })
    .sort((a, b) => (a.last_message_at < b.last_message_at ? 1 : -1));

  return {
    async unreadCount() {
      await finishDue();
      return listMine().reduce((s, x) => s + x.unread, 0);
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
