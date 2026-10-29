// Rėmėjų matomumas (0027): logotipai, generalinis rėmėjas, parodymų ir paspaudimų skaičiavimas, ataskaita rėmėjui.
import { html } from './html.js';

export const SAFE_URL = /^https:\/\/[^\s<>"']{3,200}$/;
export const LOGO_MAX_BYTES = 300 * 1024;
export const LOGO_BOX = { w: 480, h: 240 };

// Generalinis rėmėjas – pirmas, toliau – organizatoriaus nurodyta tvarka.
export function sortSponsors(list) {
  return (list || []).slice().sort((a, b) => (b.tier === 'main') - (a.tier === 'main') || (a.sort ?? 0) - (b.sort ?? 0));
}

export const mainSponsor = (list) => (list || []).find((s) => s.tier === 'main') || null;

// Logotipo plytelė: baltas fonas, kad tamsūs logotipai matytųsi tamsioje temoje. Be logotipo – pavadinimas.
export function logoTile(s, cls = '') {
  return s.logo_url
    ? html`<span class="sponsor-logo ${cls}"><img src="${s.logo_url}" alt="${s.name}" loading="lazy" decoding="async"></span>`
    : html`<span class="sponsor-logo sponsor-logo-text ${cls}">${s.name}</span>`;
}

// Nuoroda į rėmėjo svetainę (tik https://). data-sponsor-click – paspaudimo skaičiavimui.
export function sponsorLink(s, inner, cls = '') {
  return SAFE_URL.test(s.url || '')
    ? html`<a class="${cls}" href="${s.url}" target="_blank" rel="noopener noreferrer sponsored" data-sponsor-click="${s.id}">${inner}</a>`
    : html`<span class="${cls}">${inner}</span>`;
}

// --- Skaičiavimas: vienas įrenginys – vienas parodymas rėmėjui per dieną ---
const SEEN_KEY = 'zt-sponsor-seen';
const today = (now = new Date()) => now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Vilnius' });

export function unseenToday(ids, store = globalThis.localStorage, now = new Date()) {
  const day = today(now);
  let seen = { day, ids: [] };
  try {
    const v = JSON.parse(store?.getItem(SEEN_KEY) || 'null');
    if (v && v.day === day && Array.isArray(v.ids)) seen = v;
  } catch { /* nėra saugyklos */ }
  const fresh = [...new Set(ids.filter(Boolean))].filter((id) => !seen.ids.includes(id));
  if (fresh.length) {
    try { store?.setItem(SEEN_KEY, JSON.stringify({ day, ids: seen.ids.concat(fresh).slice(-500) })); } catch { /* pilna */ }
  }
  return fresh;
}

export function trackViews(backend, sponsors) {
  if (!backend?.trackSponsors) return;
  const ids = unseenToday((sponsors || []).map((s) => s.id).filter((id) => typeof id === 'string'));
  for (let i = 0; i < ids.length; i += 20) backend.trackSponsors(ids.slice(i, i + 20), 'view').catch(() => {});
}

// Paspaudimai: klausytojas kiekvienai nuorodai (ekrano šaknis lieka ta pati tarp atnaujinimų – ant jos nededam).
export function bindSponsorClicks(root, backend) {
  if (!backend?.trackSponsors) return;
  root.querySelectorAll('[data-sponsor-click]').forEach((a) => a.addEventListener('click', () => {
    backend.trackSponsors([a.dataset.sponsorClick], 'click').catch(() => {});
  }));
}

// Mažas logotipų blokas turnyro kortelėje sąraše (kortelė pati yra nuoroda – čia tik paveikslėliai).
export function sponsorMini(t, max = 3) {
  const list = sortSponsors(t.sponsors);
  if (!list.length) return '';
  const withLogo = list.filter((s) => s.logo_url).slice(0, max);
  if (!withLogo.length) return html`<span class="small muted t-sponsors">Remia: ${list.slice(0, 2).map((s) => s.name).join(', ')}${list.length > 2 ? ' ir kt.' : ''}</span>`;
  return html`<span class="t-sponsors"><span class="small muted">Remia</span>${withLogo.map((s) => logoTile(s, 'logo-xs'))}${list.length > withLogo.length ? html`<span class="small muted">+${list.length - withLogo.length}</span>` : ''}</span>`;
}

// --- Logotipo paruošimas: telpa į 480×240, permatomas fonas išlieka, iki 300 KB ---
export function fitBox(w, h, box = LOGO_BOX) {
  const k = Math.min(1, box.w / w, box.h / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export async function shrinkLogo(file, { doc = globalThis.document } = {}) {
  if (!file || !/^image\/(png|jpe?g|webp|gif|bmp|avif|heic|heif)$/i.test(file.type || '')) throw new Error('Pasirink paveikslėlį (PNG, JPG arba WebP).');
  if (file.size > 15 * 1024 * 1024) throw new Error('Failas per didelis (daugiau nei 15 MB).');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Nepavyko atidaryti paveikslėlio. Pabandyk PNG arba JPG.');
  }
  const encode = async (box, type, quality) => {
    const { w, h } = fitBox(bitmap.width, bitmap.height, box);
    const canvas = doc.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  };
  // WebP (su permatomumu); jei naršyklė jo nemoka – PNG.
  for (const [box, q] of [[LOGO_BOX, 0.9], [LOGO_BOX, 0.75], [{ w: 360, h: 180 }, 0.7], [{ w: 240, h: 120 }, 0.7]]) {
    let blob = await encode(box, 'image/webp', q);
    if (!blob || blob.type !== 'image/webp') blob = await encode(box, 'image/png');
    if (blob && blob.size <= LOGO_MAX_BYTES) return blob;
  }
  throw new Error('Logotipas per sudėtingas – pabandyk paprastesnį failą.');
}

// --- Ataskaita rėmėjui (tekstas kopijuoti ar siųsti) ---
const num = (n) => Number(n || 0).toLocaleString('lt-LT');

export function reportText({ tournament: t, report, sponsor, url, dateFmt = (d) => d }) {
  const s = (report?.sponsors || []).find((x) => x.id === sponsor.id) || { views: 0, clicks: 0, views_7d: 0, clicks_7d: 0 };
  const lines = [
    `Rėmėjo ataskaita: ${sponsor.name}`,
    `Turnyras „${t.title}“ (${dateFmt(t.starts_at)} – ${dateFmt(t.ends_at)})`,
    `${sponsor.tier === 'main' ? 'Generalinis rėmėjas' : 'Rėmėjas'}${sponsor.logo_path || sponsor.logo_url ? ' · logotipas rodomas' : ''}`,
    '',
    `Dalyvių: ${num(report?.participants)}`,
    `Patvirtintų laimikių: ${num(report?.catches)}`,
    `Logotipo parodymai: ${num(s.views)} (per 7 d.: ${num(s.views_7d)})`,
    `Paspaudimai į svetainę: ${num(s.clicks)} (per 7 d.: ${num(s.clicks_7d)})`,
    '',
    'Kur matomas: turnyro puslapyje, turnyrų sąraše, rezultatų lentelėje ir didžiajame renginio ekrane.',
    'Parodymai – unikalūs įrenginiai per dieną.'
  ];
  if (url) lines.push(`Turnyras: ${url}`);
  return lines.join('\n');
}
