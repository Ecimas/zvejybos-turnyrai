// Vidinės žinutės (0036): pokalbiai organizatorius ↔ dalyvis, turnyro pabaigos žinutės. Rašoma tik per serverio funkcijas.
export function messagesSupabase({ sb, check, uid, friendly }) {
  const NOT_YET = [/does not exist|schema cache|could not find/i, 'Žinutės dar neįdiegtos serveryje (reikia 0036 migracijos)'];
  const fail = (error, more = [], fallback = 'Nepavyko') => friendly(error, [NOT_YET,
    [/not allowed/, 'Neturi teisės'], [/blocked/, 'Pokalbis užblokuotas'], [/banned/, 'Tavo paskyra užblokuota'],
    [/read_only/, 'Į automatinę žinutę atsakyti negalima'], [/body_invalid/, 'Žinutė turi būti 1–2000 simbolių'],
    [/rate_limit/, 'Per daug žinučių – palauk kelias minutes'], ...more], fallback);
  return {
    async unreadCount() {
      const { data, error } = await sb.rpc('my_unread_count');
      if (error) return 0; // dar neįdiegta ar be ryšio – ženkliuko tiesiog nerodom
      return Number(data) || 0;
    },
    async conversations() {
      const { data, error } = await sb.rpc('my_conversations');
      if (error) throw fail(error, [], 'Nepavyko įkelti žinučių');
      return (data || []).map((x) => ({ ...x, unread: Number(x.unread) || 0 }));
    },
    async conversation(id) {
      const [{ data: c, error }, { data: msgs, error: e2 }] = await Promise.all([
        sb.from('conversations').select('*, tournaments(title, format)').eq('id', id).maybeSingle(),
        sb.from('messages').select('id, sender_id, body, meta, created_at').eq('conversation_id', id).order('created_at').order('id').limit(500)
      ]);
      if (error) throw fail(error, [], 'Nepavyko įkelti pokalbio');
      if (!c) return null;
      if (e2) throw fail(e2, [], 'Nepavyko įkelti žinučių');
      const me = uid();
      const other = c.organizer_id === me ? c.participant_id : c.organizer_id;
      let otherNick = null;
      if (other) {
        const { data: p } = await sb.from('profiles').select('nickname').eq('id', other).maybeSingle();
        otherNick = p?.nickname ?? '–';
      }
      return { ...c, tournament_title: c.tournaments?.title ?? '–', tournament_format: c.tournaments?.format, i_organize: c.organizer_id === me,
        other_id: other, other_nick: otherNick, blocked: !!c.blocked_by, blocked_by_me: c.blocked_by === me, messages: msgs || [] };
    },
    async startConversation(tournamentId, userId = null) {
      const { data, error } = await sb.rpc('start_conversation', { p_tournament: tournamentId, p_user: userId });
      if (error) throw fail(error, [], 'Nepavyko pradėti pokalbio');
      return data;
    },
    async sendMessage(id, body) {
      const { data, error } = await sb.rpc('send_message', { p_conversation: id, p_body: body });
      if (error) throw fail(error, [], 'Nepavyko išsiųsti');
      return data;
    },
    async markRead(id) {
      await sb.rpc('mark_conversation_read', { p_conversation: id });
    },
    async setPrizeHanded(id, on) {
      const { error } = await sb.rpc('set_prize_handed', { p_conversation: id, p_on: !!on });
      if (error) throw fail(error, [], 'Nepavyko pažymėti');
    },
    async prizeStatus(tournamentId) {
      const { data, error } = await sb.rpc('tournament_prize_status', { p_tournament: tournamentId });
      if (error) return [];
      return data || [];
    },
    async blockConversation(id, on) {
      const { error } = await sb.rpc('block_conversation', { p_conversation: id, p_on: !!on });
      if (error) throw fail(error, [], 'Nepavyko');
    },
    async reportMessage(messageId, reason) {
      const { error } = await sb.rpc('report_message', { p_message: messageId, p_reason: reason || null });
      if (error) throw fail(error, [], 'Nepavyko pranešti');
    },
    async reportedMessages() {
      const { data, error } = await sb.rpc('reported_messages');
      if (error) throw fail(error, [], 'Nepavyko įkelti');
      return data || [];
    },
    async resolveMessageReport(id) {
      const { error } = await sb.rpc('resolve_message_report', { p_report: id });
      if (error) throw fail(error, [], 'Nepavyko');
    }
  };
}
