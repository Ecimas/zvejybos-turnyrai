// Dvikovos (atkrintamosios poros). Ta pati logika kaip SQL funkcijoje public.duel_bracket (0020_formats.sql):
// dalyviai – užsiregistravę iki starto, surikiuoti pagal sha256(turnyro ID + žvejo ID) (pastovu, bet atsitiktinė tvarka);
// ratų skaičius ceil(log2(n)), turnyro laikas padalinamas po lygiai; poros (1,2), (3,4)…, nelyginis – praeina be kovos;
// rato rezultatas – top_n ilgiausių to rato laimikių suma; lygiosios – laimi pirmasis poroje (aukštesnis reitingas).

const ts = (d) => new Date(d).getTime();
const SKEW = 10 * 60e3;
const GRACE = 24 * 3600e3;

export async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function roundsFor(n) {
  let r = 0;
  while ((1 << r) < n) r += 1;
  return r;
}

// Vieno žvejo rezultatas rato lange [from, to).
export function duelScore(t, speciesIds, catches, userId, from, to, banned = () => false) {
  if (banned(userId)) return 0;
  const list = catches.filter((c) => c.user_id === userId && c.status === 'approved'
    && c.length_mm >= t.min_length_mm
    && ts(c.captured_at_device) >= from && ts(c.captured_at_device) < to
    && ts(c.captured_at_device) <= ts(c.received_at || c.captured_at_device) + SKEW
    && ts(c.received_at || c.captured_at_device) <= ts(t.ends_at) + GRACE
    && (!speciesIds.length || speciesIds.includes(c.species_id)))
    .map((c) => c.length_mm)
    .sort((a, b) => b - a);
  return list.slice(0, t.top_n).reduce((s, x) => s + x, 0);
}

// entries: [{ user_id, joined_at }]; profiles: { [id]: { nickname } }. Grąžina eilutes kaip SQL.
export async function duelBracket({ tournament: t, speciesIds = [], entries, catches, profiles = {}, banned, now = Date.now() }) {
  if (t.format !== 'duels') return [];
  const start = ts(t.starts_at);
  const end = ts(t.ends_at);
  const keyed = await Promise.all(entries.filter((e) => ts(e.joined_at) <= start)
    .map(async (e) => ({ id: e.user_id, key: await sha256hex(String(t.id) + String(e.user_id)) })));
  let cur = keyed.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((x) => x.id);
  const n = cur.length;
  if (n < 2) return [];
  const rounds = roundsFor(n);
  const dur = (end - start) / rounds;
  const rows = [];
  for (let k = 1; k <= rounds; k += 1) {
    const ws = start + dur * (k - 1);
    const we = k === rounds ? end : start + dur * k;
    const status = now >= we ? 'done' : now >= ws ? 'live' : 'upcoming';
    const next = [];
    for (let i = 0; i < cur.length; i += 2) {
      const a = cur[i];
      const b = cur[i + 1] ?? null;
      const sa = status === 'upcoming' ? 0 : duelScore(t, speciesIds, catches, a, ws, we, banned);
      const sb = !b || status === 'upcoming' ? 0 : duelScore(t, speciesIds, catches, b, ws, we, banned);
      const w = !b || sa >= sb ? a : b;
      rows.push({
        round: k, rounds, slot: i / 2 + 1,
        starts_at: new Date(ws).toISOString(), ends_at: new Date(we).toISOString(), status,
        a_id: a, a_nick: profiles[a]?.nickname ?? '', a_score: sa,
        b_id: b, b_nick: b ? profiles[b]?.nickname ?? '' : null, b_score: b ? sb : null,
        winner_id: status === 'done' || !b ? w : null
      });
      next.push(w);
    }
    if (status !== 'done') break;
    cur = next;
  }
  return rows;
}

// Kaip pavadinti ratą: paskutinis – finalas, prieš jį – pusfinalis, ketvirtfinalis.
export function roundName(round, rounds) {
  const left = rounds - round;
  if (left === 0) return 'Finalas';
  if (left === 1) return 'Pusfinalis';
  if (left === 2) return 'Ketvirtfinalis';
  return `${round} ratas`;
}
