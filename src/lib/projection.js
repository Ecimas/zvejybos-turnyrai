// „Ką tai reiškia“: kurioje vietoje būtum, jei šis laimikis būtų patvirtintas.
// Skaičiuojama telefone iš turnyro lentelės ir savų patvirtintų laimikių (apytiksliai: kitų laimikiai – kaip lentelėje).
import { computeLeaderboard } from './scoring.js';

// board – turnyro lentelė [{ user_id, rank, score_mm }]; draft – { species_id, length_mm, captured_at_device, ... }.
export function projectRank(t, board, me, myCatches, draft) {
  if (!t || t.leaderboard_hidden || t.format === 'duels') return null;
  const mine = board.find((r) => r.user_id === me) || null;
  const approved = myCatches.filter((c) => c.status === 'approved');
  const fish = { ...draft, id: draft.id || 'draft', user_id: me, status: 'approved', received_at: draft.received_at || new Date().toISOString() };
  const rows = computeLeaderboard({
    tournament: t, speciesIds: t.species_ids || [], speciesPct: t.species_pct || {}, entries: [me],
    catches: [...approved.map((c) => ({ ...c, user_id: me })), fish]
  });
  const p = rows.find((r) => r.user_id === me);
  if (!p) return null;
  const others = board.filter((r) => r.user_id !== me);
  const improved = !mine || p.score_mm > Number(mine.score_mm);
  const score = improved ? p.score_mm : Number(mine.score_mm);
  // Lygus rezultatas – aukščiau tas, kas pasiekė anksčiau (t. y. jau esantys lentelėje).
  const rank = 1 + others.filter((r) => Number(r.score_mm) >= score).length;
  const above = others.filter((r) => Number(r.score_mm) >= score).sort((a, b) => Number(a.score_mm) - Number(b.score_mm))[0] || null;
  return { rank, was: mine ? Number(mine.rank) : null, improved, score, gap: above ? Number(above.score_mm) - score : null, total: others.length + 1 };
}

export function projectionText(pr) {
  if (!pr) return '';
  if (!pr.improved) return `Vieta nesikeistų (#${pr.was})`;
  if (pr.was === null) return `Būtum #${pr.rank} iš ${pr.total}`;
  if (pr.rank < pr.was) return `Pakiltum iš #${pr.was} į #${pr.rank}`;
  return `Rezultatas pagerėtų, vieta #${pr.rank}`;
}
