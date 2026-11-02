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
      return (data || []).map((x) => ({ ...x, tournament_title: x.kind === 'support' ? 'Pagalba' : x.tournament_title, unread: Number(x.unread) || 0 }));
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
      // Komandos pusė: organizatorius arba pagalbos pokalbyje – administratorius
      const side = c.organizer_id === me || (c.kind === 'support' && c.participant_id !== me);
      const other = side ? c.participant_id : c.organizer_id;
      let otherNick = null;
      if (other) {
        const { data: p } = await sb.from('profiles').select('nickname').eq('id', other).maybeSingle();
        otherNick = p?.nickname ?? '–';
      }
      return { ...c, tournament_title: c.kind === 'support' ? 'Pagalba' : c.tournaments?.title ?? '–', tournament_format: c.tournaments?.format, i_organize: side,
        other_id: other, other_nick: otherNick, blocked: !!c.blocked_by, blocked_by_me: c.blocked_by === me, messages: msgs || [] };
    },
    async startConversation(tournamentId, userId = null) {
      const { data, error } = await sb.rpc('start_conversation', { p_tournament: tournamentId, p_user: userId });
      if (error) throw fail(error, [], 'Nepavyko pradėti pokalbio');
      return data;
    },
    async startSupport() {
      const { data, error } = await sb.rpc('start_support');
      if (error) throw fail(error, [], 'Nepavyko atidaryti pokalbio su komanda');
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
    // ---- „Svarbu“: pranešimų centras (0037)
    async notices() {
      const { data, error } = await sb.rpc('my_notices');
      if (error) return [];
      return data || [];
    },
    async markNoticesSeen() {
      await sb.rpc('mark_notices_seen');
    },
    // ---- Klubų pokalbiai (0037)
    async clubChats() {
      const { data, error } = await sb.rpc('my_club_chats');
      if (error) return [];
      return (data || []).map((x) => ({ ...x, members: Number(x.members) || 0, unread: Number(x.unread) || 0, logo_url: x.logo_path ? sb.storage.from('club-images').getPublicUrl(x.logo_path).data.publicUrl : null }));
    },
    async clubChat(clubId) {
      const [chats, msgs, pin] = await Promise.all([
        sb.rpc('my_club_chats'),
        sb.rpc('club_chat_messages', { p_club: clubId }),
        sb.from('clubs').select('chat_pin_id').eq('id', clubId).maybeSingle()
      ]);
      if (chats.error) throw fail(chats.error, [], 'Nepavyko įkelti pokalbio');
      const club = (chats.data || []).find((x) => x.club_id === clubId);
      if (!club) return null;
      if (msgs.error) throw fail(msgs.error, [], 'Nepavyko įkelti žinučių');
      return { ...club, members: Number(club.members) || 0, pin_id: pin.data?.chat_pin_id ?? null,
        messages: (msgs.data || []).map((m) => ({ ...m, reactions: m.reactions || {}, mine: m.mine || [] })) };
    },
    async clubChatSend(clubId, body, catchId = null) {
      const { data, error } = await sb.rpc('club_chat_send', { p_club: clubId, p_body: body || null, p_catch: catchId });
      if (error) throw fail(error, [[/muted/, 'Klubo valdytojas laikinai nutildė tave šiame pokalbyje'], [/feature_off/, 'Klubų pokalbiai šiuo metu išjungti'],
        [/catch_invalid/, 'Šio laimikio pasidalinti negalima']], 'Nepavyko išsiųsti');
      return data;
    },
    async clubChatRead(clubId) { await sb.rpc('club_chat_read', { p_club: clubId }); },
    async clubChatReact(messageId, emoji) {
      const { data, error } = await sb.rpc('club_chat_react', { p_message: messageId, p_emoji: emoji });
      if (error) throw fail(error, [], 'Nepavyko');
      return data;
    },
    async clubChatDelete(messageId) {
      const { error } = await sb.rpc('club_chat_delete', { p_message: messageId });
      if (error) throw fail(error, [], 'Nepavyko ištrinti');
    },
    async clubChatPin(clubId, messageId) {
      const { error } = await sb.rpc('club_chat_pin', { p_club: clubId, p_message: messageId });
      if (error) throw fail(error, [], 'Nepavyko prisegti');
    },
    async clubChatMute(clubId, userId, hours) {
      const { error } = await sb.rpc('club_chat_mute', { p_club: clubId, p_user: userId, p_hours: hours });
      if (error) throw fail(error, [], 'Nepavyko nutildyti');
    },
    async clubChatSetPush(clubId, on) {
      const { error } = await sb.rpc('club_chat_set_push', { p_club: clubId, p_on: !!on });
      if (error) throw fail(error, [], 'Nepavyko pakeisti');
    },
    async clubChatReport(messageId, reason) {
      const { error } = await sb.rpc('club_chat_report', { p_message: messageId, p_reason: reason || null });
      if (error) throw fail(error, [], 'Nepavyko pranešti');
    },
    async resolveMessageReport(id) {
      const { error } = await sb.rpc('resolve_message_report', { p_report: id });
      if (error) throw fail(error, [], 'Nepavyko');
    }
  };
}
