// Turnyro lentelės skaičiavimas.
// Ta pati logika kaip SQL funkcijoje public.leaderboard_all (supabase/migrations/0020_formats.sql).
// Naudojama demonstraciniame režime ir laimikio peržiūrai prieš išsaugant.

export const SKEW_MS = 10 * 60 * 1000;      // telefono laikrodis gali skubėti ne daugiau
export const GRACE_MS = 24 * 60 * 60 * 1000; // offline laimikiai priimami 24 val. po pabaigos

const ts = (d) => new Date(d).getTime();

// Tikras laimikio laikas (kaip SQL public.catch_time, 0023): telefono laikas + žinomas skirtumas nuo serverio
// (fotografuojant clock_offset_s, kitaip – siunčiant send_offset_s), jei skirtumas ne mažesnis nei 60 s.
export function catchTime(c) {
  const off = c.clock_offset_s ?? c.send_offset_s ?? 0;
  return ts(c.captured_at_device) + (Math.abs(off) >= 60 ? off * 1000 : 0);
}

// Kodėl laimikis (ne)tinka turnyrui – nepriklausomai nuo moderavimo.
// entered: false – nedalyvauja; true – dalyvauja; eilutė – dalyvauja nuo šio laiko (joined_at):
// vėlai prisijungusiam įskaitomi tik po prisijungimo pagauti laimikiai.
// Grąžina 'ok' arba priežasties kodą.
export function fitReason(t, speciesIds, entered, c, now = Date.now()) {
  if (!entered) return 'not_entered';
  if (speciesIds.length > 0 && !speciesIds.includes(c.species_id)) return 'species';
  if (c.length_mm < t.min_length_mm) return 'too_short';
  const cap = catchTime(c);
  if (cap < ts(t.starts_at)) return 'before';
  if (typeof entered === 'string' && cap < ts(entered)) return 'before_join';
  if (cap >= ts(t.ends_at)) return 'after';
  const rec = c.received_at ? ts(c.received_at) : now;
  if (cap > rec + SKEW_MS) return 'clock';
  if (rec > ts(t.ends_at) + GRACE_MS) return 'late';
  return 'ok';
}

export const REASON_LT = {
  ok: 'Įskaitoma',
  not_entered: 'Neužsiregistravai',
  species: 'Neįskaitoma · kita rūšis',
  too_short: 'Neįskaitoma · per trumpa',
  before: 'Neįskaitoma · prieš startą',
  before_join: 'Neįskaitoma · pagauta prieš prisiregistruojant',
  after: 'Neįskaitoma · po pabaigos',
  clock: 'Neįskaitoma · netikslus telefono laikas',
  late: 'Neįskaitoma · išsiųsta per vėlai'
};

export function isCounted(t, speciesIds, entered, c) {
  return c.status === 'approved' && fitReason(t, speciesIds, entered, c) === 'ok';
}

// entries: vartotojų ID arba { user_id, joined_at } masyvas; profiles: { [id]: { nickname, region } }
// Taškai už rūšį: ilgis mm × rūšies koeficientas / 100 (sveikoji dalis, kaip SQL). Kitiems formatams – ilgis.
export function catchPoints(t, c, speciesPct = {}) {
  if (t.format !== 'species_points') return c.length_mm;
  return Math.floor((c.length_mm * (speciesPct[c.species_id] ?? 100)) / 100);
}

// speciesPct: { [species_id]: koeficientas procentais } (tik species_points formatui)
export function computeLeaderboard({ tournament: t, speciesIds = [], speciesPct = {}, entries, catches, profiles = {} }) {
  const entered = new Map([...entries].map((e) => (typeof e === 'string' ? [e, true] : [e.user_id, e.joined_at || true])));
  const perUser = new Map();
  for (const c of catches) {
    if (!isCounted(t, speciesIds, entered.get(c.user_id) ?? false, c)) continue;
    if (!perUser.has(c.user_id)) perUser.set(c.user_id, []);
    perUser.get(c.user_id).push(c);
  }
  const limit = t.format === 'biggest' ? 1 : t.top_n;
  const rows = [];
  for (const [userId, list] of perUser) {
    const pts = (c) => catchPoints(t, c, speciesPct);
    list.sort((a, b) => pts(b) - pts(a) || catchTime(a) - catchTime(b));
    const top = list.slice(0, limit);
    rows.push({
      user_id: userId,
      nickname: profiles[userId]?.nickname ?? '',
      region: profiles[userId]?.region ?? null,
      score_mm: top.reduce((s, c) => s + pts(c), 0),
      counted: top.length,
      last_counted: new Date(Math.max(...top.map((c) => catchTime(c)))).toISOString()
    });
  }
  rows.sort((a, b) => b.score_mm - a.score_mm || ts(a.last_counted) - ts(b.last_counted) || a.nickname.localeCompare(b.nickname));
  // SQL rank(): lygūs rezultatai dalijasi vieta, kita vieta praleidžiama.
  rows.forEach((r, i) => {
    const prev = rows[i - 1];
    r.rank = prev && prev.score_mm === r.score_mm && prev.last_counted === r.last_counted ? prev.rank : i + 1;
  });
  return rows;
}

// Lentelė tik vieno diviziono dalyviams: vietos perskaičiuojamos kaip SQL rank().
export function rerank(rows) {
  const out = rows.map((r) => ({ ...r }));
  out.forEach((r, i) => {
    const prev = out[i - 1];
    r.rank = prev && prev.score_mm === r.score_mm && prev.last_counted === r.last_counted ? prev.rank : i + 1;
  });
  return out;
}

// Sezono lygos taškai už vietą (kaip SQL league_points).
const LEAGUE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const leaguePoints = (rank) => LEAGUE_POINTS[Number(rank) - 1] ?? 0;

// boards: kiekvieno įskaitomo turnyro lentelė [{ user_id, nickname, rank }]
export function leagueStandings(boards) {
  const by = new Map();
  for (const board of boards) {
    for (const r of board) {
      if (r.rank === null) continue;
      const x = by.get(r.user_id) || { user_id: r.user_id, nickname: r.nickname, points: 0, events: 0, wins: 0, best_place: Infinity };
      x.points += leaguePoints(r.rank);
      x.events += 1;
      if (r.rank === 1) x.wins += 1;
      x.best_place = Math.min(x.best_place, r.rank);
      by.set(r.user_id, x);
    }
  }
  const rows = [...by.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.best_place - b.best_place || a.nickname.localeCompare(b.nickname));
  rows.forEach((r, i) => {
    const p = rows[i - 1];
    r.rank = p && p.points === r.points && p.wins === r.wins && p.best_place === r.best_place ? p.rank : i + 1;
  });
  return rows;
}
