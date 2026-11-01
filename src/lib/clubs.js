// Klubų skaičiavimai (tie patys kaip serveryje, 0029) – demo režimui ir testams.
import { html } from './html.js';

// Iššūkio rūšis pagal mėnesį (0 – bet kuri). Pavasarį ir vasarą – bet kuri (plėšrūnų draudimai).
const CHALLENGE = [2, 2, 0, 0, 0, 0, 0, 0, 3, 1, 2, 1];
export const challengeSpecies = (d = new Date()) => CHALLENGE[new Date(d).getMonth()] || null;

export const MONTHS_GEN = ['sausio', 'vasario', 'kovo', 'balandžio', 'gegužės', 'birželio', 'liepos', 'rugpjūčio', 'rugsėjo', 'spalio', 'lapkričio', 'gruodžio'];
export const MONTHS_NOM = ['Sausio', 'Vasario', 'Kovo', 'Balandžio', 'Gegužės', 'Birželio', 'Liepos', 'Rugpjūčio', 'Rugsėjo', 'Spalio', 'Lapkričio', 'Gruodžio'];

const approved = (catches) => catches.filter((c) => c.status === 'approved');
const yearOf = (iso) => new Date(iso).getFullYear();

// Sezono taškai: 10 didžiausių patvirtintų laimikių ilgių suma centimetrais.
export function seasonPoints(catches, userId, year) {
  const lens = approved(catches).filter((c) => c.user_id === userId && yearOf(c.captured_at_device) === year)
    .map((c) => c.length_mm).sort((a, b) => b - a).slice(0, 10);
  return Math.round(lens.reduce((s, x) => s + x, 0) / 10);
}

export function challengeTop(catches, memberIds, month = new Date()) {
  const m = new Date(month);
  const from = new Date(m.getFullYear(), m.getMonth(), 1).getTime();
  const to = new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime();
  const sp = challengeSpecies(m);
  const best = new Map();
  for (const c of approved(catches)) {
    const t = new Date(c.captured_at_device).getTime();
    if (!memberIds.includes(c.user_id) || t < from || t >= to || (sp && c.species_id !== sp)) continue;
    const cur = best.get(c.user_id);
    if (!cur || c.length_mm > cur.length_mm) best.set(c.user_id, c);
  }
  return {
    month: new Date(from).toISOString().slice(0, 10), species_id: sp, ends_at: new Date(to).toISOString(),
    top: [...best.values()].sort((a, b) => b.length_mm - a.length_mm)
      .map((c) => ({ user_id: c.user_id, len: c.length_mm, catch_id: c.id, species_id: c.species_id }))
  };
}

export function clubRecords(catches, memberIds, year = new Date().getFullYear()) {
  const best = new Map();
  for (const c of approved(catches)) {
    if (!memberIds.includes(c.user_id)) continue;
    const cur = best.get(c.species_id);
    if (!cur || c.length_mm > cur.length_mm || (c.length_mm === cur.length_mm && c.captured_at_device < cur.captured_at_device)) best.set(c.species_id, c);
  }
  return {
    year,
    records: [...best.values()].sort((a, b) => b.length_mm - a.length_mm)
      .map((c) => ({ species_id: c.species_id, len: c.length_mm, catch_id: c.id, user_id: c.user_id, at: c.captured_at_device })),
    season: memberIds.map((id) => ({
      user_id: id,
      points: seasonPoints(catches, id, year),
      catches: approved(catches).filter((c) => c.user_id === id && yearOf(c.captured_at_device) === year).length
    })).filter((s) => s.points > 0).sort((a, b) => b.points - a.points || b.catches - a.catches)
  };
}

// Klubo taškai lygoje: 5 geriausių narių sezono taškų suma.
export function clubLeaguePoints(catches, memberIds, year = new Date().getFullYear()) {
  return memberIds.map((id) => seasonPoints(catches, id, year)).sort((a, b) => b - a).slice(0, 5).reduce((s, x) => s + x, 0);
}

export const REACTIONS = [['like', '👍', 'Patinka'], ['fire', '🔥', 'Įspūdinga'], ['hook', '🎣', 'Gera žvejyba']];

// Funkcijų jungikliai: jei nežinoma – įjungta.
export const feat = (state, key) => (state?.features ? state.features[key] !== false : true);

export const roleLt = (role) => ({ owner: 'Savininkas', admin: 'Administratorius', member: 'Narys' }[role] || 'Narys');

export function clubLogo(c, size = 'md') {
  return c.logo_url
    ? html`<span class="cl-logo cl-logo-${size}"><img src="${c.logo_url}" alt="" loading="lazy"></span>`
    : html`<span class="cl-logo cl-logo-${size} cl-logo-empty" aria-hidden="true">${(c.name || '?').trim().charAt(0).toUpperCase()}</span>`;
}
