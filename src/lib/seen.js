// Kurie organizatoriaus pranešimai jau matyti (tik šiame telefone – tai patogumas, ne duomenys).
const key = (tournamentId) => `zt-ann-seen:${tournamentId}`;

export function lastSeen(tournamentId) {
  try { return localStorage.getItem(key(tournamentId)) || ''; } catch { return ''; }
}

export function markSeen(tournamentId, iso) {
  if (!iso) return;
  try { if (iso > lastSeen(tournamentId)) localStorage.setItem(key(tournamentId), iso); } catch { /* nėra saugyklos */ }
}

export const hasUnseen = (t) => !!(t.joined && t.last_announcement_at && t.last_announcement_at > lastSeen(t.id));
