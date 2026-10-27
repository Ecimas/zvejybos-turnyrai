// Turnyro lentelės skaičiavimas.
// Ta pati logika kaip SQL funkcijoje public.leaderboard (supabase/migrations/0012_count_after_join.sql).
// Naudojama demonstraciniame režime ir laimikio peržiūrai prieš išsaugant.

export const SKEW_MS = 10 * 60 * 1000;      // telefono laikrodis gali skubėti ne daugiau
export const GRACE_MS = 24 * 60 * 60 * 1000; // offline laimikiai priimami 24 val. po pabaigos

const ts = (d) => new Date(d).getTime();

// Kodėl laimikis (ne)tinka turnyrui – nepriklausomai nuo moderavimo.
// entered: false – nedalyvauja; true – dalyvauja; eilutė – dalyvauja nuo šio laiko (joined_at):
// vėlai prisijungusiam įskaitomi tik po prisijungimo pagauti laimikiai.
// Grąžina 'ok' arba priežasties kodą.
export function fitReason(t, speciesIds, entered, c, now = Date.now()) {
  if (!entered) return 'not_entered';
  if (speciesIds.length > 0 && !speciesIds.includes(c.species_id)) return 'species';
  if (c.length_mm < t.min_length_mm) return 'too_short';
  const cap = ts(c.captured_at_device);
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
export function computeLeaderboard({ tournament: t, speciesIds = [], entries, catches, profiles = {} }) {
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
    list.sort((a, b) => b.length_mm - a.length_mm || ts(a.captured_at_device) - ts(b.captured_at_device));
    const top = list.slice(0, limit);
    rows.push({
      user_id: userId,
      nickname: profiles[userId]?.nickname ?? '',
      region: profiles[userId]?.region ?? null,
      score_mm: top.reduce((s, c) => s + c.length_mm, 0),
      counted: top.length,
      last_counted: new Date(Math.max(...top.map((c) => ts(c.captured_at_device)))).toISOString()
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
