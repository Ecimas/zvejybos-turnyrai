// Režimas be ryšio: paskutiniai matyti duomenys laikomi telefone ir rodomi, kai serveris nepasiekiamas.
// Laimikių siuntimas be ryšio – atskirai (outbox.js). Čia tik skaitymas ir aiškus pranešimas veiksmams.

const PREFIX = 'zt-cache:';
const MAX_ENTRIES = 120;
const SLOW_MS = 8000; // silpnas ryšys: po tiek laukimo rodom išsaugotus duomenis

// Ką galima rodyti iš telefono atminties.
export const READS = ['myProfile', 'species', 'tournaments', 'tournament', 'leaderboard', 'participants', 'divisionMap', 'duelBracket',
  'leagues', 'league', 'myLeagues', 'myCatches', 'userCatches', 'catchDetail', 'userEntries', 'myDisputes', 'followStats',
  'followingFeed', 'clubs', 'club', 'myClubs', 'userClubs', 'clubCatches', 'teamLeaderboard', 'myChecks', 'myBan',
  'myOrganizerRequest', 'blankTrips', 'announcements', 'profile', 'userTournamentCount', 'myReport',
  'features', 'clubPosts', 'clubTrips', 'catchSocial', 'catchComments', 'clubChallenge', 'clubRecords', 'clubLeague', 'clubPerk',
  'clubJoinRequests', 'myJoinRequest', 'modCounts', 'featureAdmin', 'storageUsage', 'banner', 'myScoringRules', 'myGoals', 'participantsAdmin', 'conversations', 'conversation', 'unreadCount', 'prizeStatus', 'reportedMessages', 'notices', 'clubChats', 'clubChat'];

// Veiksmai, kuriems būtinas ryšys (laimikio siuntimas – ne čia, jis laukia eilėje).
export const WRITES = ['signIn', 'verifyCode', 'signInWithGoogle', 'updateProfile', 'createTournament', 'updateTournament', 'deleteTournament',
  'saveSponsors', 'uploadSponsorLogo', 'adminDeleteTournament', 'joinWithInvite', 'join', 'leave', 'setEntryDivision', 'createLeague',
  'updateLeague', 'deleteLeague', 'updateCatch', 'openDispute', 'resolveDispute', 'requestOrganizer', 'decideOrganizer', 'setRole',
  'setModerator', 'follow', 'unfollow', 'createClub', 'updateClub', 'deleteClub', 'joinClub', 'leaveClub', 'removeClubMember',
  'setEntryClub', 'setKeepSpots', 'answerCheck', 'requestCheck', 'resolveCheck', 'savePushSubscription', 'saveNotificationSettings',
  'sendTestPush', 'banUser', 'unbanUser', 'resetNickname', 'exportData', 'deleteAccount', 'reportCatch', 'resolveReport',
  'addBlankTrip', 'deleteBlankTrip', 'postAnnouncement', 'deleteAnnouncement', 'review',
  'requestJoinClub', 'decideJoinClub', 'setClubAdmin', 'uploadClubImage', 'setClubVerified', 'requestClubVerification', 'setClubShareMap',
  'postClub', 'deleteClubPost', 'likeClubPost', 'createTrip', 'rsvpTrip', 'deleteTrip', 'react', 'addComment', 'deleteComment',
  'reportComment', 'dismissCommentReport', 'saveClubPerk', 'setFeature', 'setBanner', 'saveScoringRule', 'deleteScoringRule', 'addGoal', 'deleteGoal',
  'uploadTournamentCover', 'setTournamentCover', 'removeParticipant', 'setParticipantDivision', 'regenerateInvite', 'notifyRuleChange',
  'startConversation', 'startDirect', 'startSupport', 'sendMessage', 'markRead', 'setPrizeHanded', 'blockConversation', 'reportMessage', 'resolveMessageReport',
  'markNoticesSeen', 'clubChatSend', 'clubChatRead', 'clubChatReact', 'clubChatDelete', 'clubChatPin', 'clubChatMute', 'clubChatSetPush', 'clubChatReport'];

export const OFFLINE_TEXT = 'Reikia interneto ryšio – pabandyk, kai atsiras';

const isOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);

// Ar klaida – dėl ryšio (ne dėl teisių ar duomenų).
export function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'TypeError' || err.name === 'AbortError') return true;
  const m = String(err.message || err);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet|timed? ?out|nėra ryšio/i.test(m);
}

function defineAt(value, at) {
  if (value && typeof value === 'object') {
    try { Object.defineProperty(value, '__cachedAt', { value: at, enumerable: false, configurable: true }); } catch { /* užšaldytas */ }
  }
  return value;
}

// Kada šie duomenys buvo įkelti (jei rodomi iš telefono atminties), kitaip null.
export const cachedAt = (value) => (value && typeof value === 'object' && value.__cachedAt) || null;

export function createOfflineCache({ storage = globalThis.localStorage, now = () => Date.now(), user = () => null, slowMs = SLOW_MS } = {}) {
  const listeners = new Set();
  let staleAt = null; // seniausių šiuo metu rodomų duomenų laikas
  const keyOf = (name, args) => `${PREFIX}${user() || 'anon'}:${name}:${JSON.stringify(args)}`;
  const emit = () => listeners.forEach((fn) => { try { fn(); } catch { /* ignoruojam */ } });

  const read = (key) => {
    try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
  };
  const keys = () => {
    const out = [];
    try { for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k && k.startsWith(PREFIX)) out.push(k); } } catch { /* nėra saugyklos */ }
    return out;
  };
  const prune = () => {
    const all = keys().map((k) => [k, read(k)?.at || 0]).sort((a, b) => a[1] - b[1]);
    all.slice(0, Math.max(0, all.length - MAX_ENTRIES + 1)).forEach(([k]) => { try { storage.removeItem(k); } catch { /* */ } });
  };
  const write = (key, data) => {
    const body = JSON.stringify({ at: now(), data });
    try {
      storage.setItem(key, body);
    } catch {
      // Pilna atmintis: išvalom seniausius ir bandom dar kartą.
      try { prune(); keys().slice(0, Math.ceil(keys().length / 2)).forEach((k) => storage.removeItem(k)); storage.setItem(key, body); } catch { /* nepavyko – nieko baisaus */ }
    }
  };

  return {
    get staleAt() { return staleAt; },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // Prieš naują ekraną: laikas skaičiuojamas iš naujo pagal tai, kas bus parodyta.
    reset() { staleAt = null; },
    notify: emit,
    clear() { keys().forEach((k) => { try { storage.removeItem(k); } catch { /* */ } }); staleAt = null; emit(); },

    // Skaitymas: tinklas, o nepavykus (ar per ilgai laukiant) – paskutinis išsaugotas atsakymas.
    async read(name, args, call) {
      const key = keyOf(name, args);
      const saved = read(key);
      const fromCache = () => {
        staleAt = staleAt === null ? saved.at : Math.min(staleAt, saved.at);
        emit();
        return defineAt(saved.data, saved.at);
      };
      if (!isOnline() && saved) return fromCache();
      const net = Promise.resolve().then(call).then((data) => {
        if (data !== undefined) write(key, data);
        return data;
      });
      try {
        if (!saved) return await net;
        let timer;
        const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(SLOW), slowMs); });
        const out = await Promise.race([net, slow]);
        clearTimeout(timer);
        if (out === SLOW) { net.catch(() => {}); return fromCache(); }
        return out;
      } catch (err) {
        if (saved && (isNetworkError(err) || !isOnline())) return fromCache();
        if (isNetworkError(err) || !isOnline()) throw offlineError(err);
        throw err;
      }
    },

    // Rašymas: be ryšio – aiški žinutė, ne techninė klaida.
    async write(call) {
      if (!isOnline()) throw offlineError();
      try {
        return await call();
      } catch (err) {
        if (isNetworkError(err)) throw offlineError(err);
        throw err;
      }
    }
  };
}

const SLOW = Symbol('slow');

function offlineError(cause) {
  const e = new Error(OFFLINE_TEXT);
  e.offline = true;
  if (cause) e.cause = cause;
  return e;
}

// Apgaubia tikrąjį backend: skaitymai su atsargine kopija, rašymai su aiškia žinute.
export function withOffline(backend, opts = {}) {
  const cache = createOfflineCache({ user: () => backend.getUser?.()?.id ?? null, ...opts });
  for (const name of READS) {
    const fn = backend[name];
    if (typeof fn !== 'function') continue;
    backend[name] = (...args) => cache.read(name, args, () => fn.apply(backend, args));
  }
  for (const name of WRITES) {
    const fn = backend[name];
    if (typeof fn !== 'function') continue;
    backend[name] = (...args) => cache.write(() => fn.apply(backend, args));
  }
  // Atsijungus ar ištrynus paskyrą – telefone neliks svetimų akių duomenų.
  for (const name of ['signOut', 'deleteAccount']) {
    const fn = backend[name];
    if (typeof fn !== 'function') continue;
    backend[name] = async (...args) => {
      const out = await fn.apply(backend, args);
      cache.clear();
      return out;
    };
  }
  backend.offline = cache;
  return backend;
}
