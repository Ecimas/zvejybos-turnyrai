// Asmeniniai rekordai pagal rūšį. Skaičiuojami iš savų laimikių (ir dar neišsiųstų),
// atmesti neįskaitomi – kad rekordu nebūtų laikoma žuvis, kurią moderatorius pripažino netinkama.

const counts = (c) => c.status !== 'rejected';

// Ankstesnis geriausias ilgis (mm) tai rūšiai arba null, jei šios rūšies dar nebuvo.
export function previousBest(catches, speciesId, excludeId = null) {
  let best = null;
  for (const c of catches) {
    if (c.species_id !== speciesId || !counts(c) || (excludeId && (c.id === excludeId || c.client_id === excludeId))) continue;
    if (best === null || c.length_mm > best) best = c.length_mm;
  }
  return best;
}

// { kind: 'first' | 'record' | null, previous }
export function recordFor(catches, speciesId, lengthMm, excludeId = null) {
  const prev = previousBest(catches, speciesId, excludeId);
  if (prev === null) return { kind: 'first', previous: null };
  if (lengthMm > prev) return { kind: 'record', previous: prev };
  return { kind: null, previous: prev };
}

// Kurie laimikiai dabar yra rekordai (po vieną kiekvienai rūšiai; lygių – ankstesnis).
export function recordIds(catches) {
  const best = new Map();
  for (const c of catches) {
    if (!counts(c)) continue;
    const cur = best.get(c.species_id);
    if (!cur || c.length_mm > cur.length_mm
        || (c.length_mm === cur.length_mm && c.captured_at_device < cur.captured_at_device)) best.set(c.species_id, c);
  }
  return new Set([...best.values()].map((c) => c.id));
}

// Laimikiai iš siuntimo eilės paverčiami tokiu pačiu pavidalu kaip serverio.
export const fromQueue = (q) => ({
  id: q.clientId, client_id: q.clientId, species_id: q.speciesId, length_mm: q.lengthMm,
  captured_at_device: q.capturedAt, status: q.state === 'failed' ? 'rejected' : 'pending'
});
