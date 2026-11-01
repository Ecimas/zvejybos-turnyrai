// Žemėlapis: Leaflet (įkeliamas tik atidarius žemėlapį) + OpenStreetMap plytelės.
const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/+esm';
const LEAFLET_CSS = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
export const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

let loading = null;
let cssReady = null;
// Žemėlapis piešiamas tik kai jo stilius jau įkeltas – kitaip plytelės išsimėto (buvo „kartais neužsikrauna“).
function loadCss() {
  if (cssReady) return cssReady;
  let link = document.querySelector('link[data-leaflet]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = window.__leafletCssUrl || LEAFLET_CSS;
    link.dataset.leaflet = '';
    document.head.append(link);
  }
  cssReady = new Promise((resolve, reject) => {
    if (link.sheet) { resolve(); return; }
    const t = setTimeout(() => { cssReady = null; link.remove(); reject(new Error('css timeout')); }, 12000);
    link.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
    link.addEventListener('error', () => { clearTimeout(t); cssReady = null; link.remove(); reject(new Error('css failed')); }, { once: true });
  });
  return cssReady;
}

export function loadLeaflet() {
  loading ||= Promise.all([
    import(/* @vite-ignore */ window.__leafletUrl || LEAFLET).then((m) => (m.default && m.default.map ? m.default : m)),
    loadCss()
  ]).then(([L]) => L).catch((e) => { loading = null; throw e; });
  return loading;
}

// Taškų spalva pagal rūšį – kad būtų matyti, kur kas kimba.
const COLORS = ['#FFA62B', '#4FC3F7', '#81C784', '#E57373', '#BA68C8', '#FFD54F', '#4DB6AC', '#F06292'];
export const colorFor = (speciesId) => COLORS[(Number(speciesId) || 0) % COLORS.length];

// Grupavimas: kelios žuvys toje pačioje vietoje (~50 m) – vienas taškas su skaičiumi.
export function groupSpots(points, meters = 50) {
  const groups = [];
  for (const p of points) {
    const g = groups.find((x) => distance(x.lat, x.lng, p.lat, p.lng) <= meters);
    if (g) g.items.push(p);
    else groups.push({ lat: p.lat, lng: p.lng, items: [p] });
  }
  return groups;
}

export function distance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------- Naujas žemėlapis (MapLibre + OpenFreeMap)
// Vektorinis žemėlapis: sklandus artinimas, sukimas, burbulai ir „šilumos“ sluoksnis. Nepavykus – Leaflet (atsarginis).
export const MAPLIBRE_JS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js';
export const MAPLIBRE_CSS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css';
export const STYLE_DARK = 'https://tiles.openfreemap.org/styles/dark';
export const STYLE_LIGHT = 'https://tiles.openfreemap.org/styles/positron';
export const LT_CENTER = [23.9, 55.2];

const loaded = new Map();
function addCss(href) {
  if (loaded.has(href)) return loaded.get(href);
  const p = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    const t = setTimeout(() => { loaded.delete(href); link.remove(); reject(new Error('css timeout')); }, 12000);
    link.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
    link.addEventListener('error', () => { clearTimeout(t); loaded.delete(href); link.remove(); reject(new Error('css failed')); }, { once: true });
    document.head.append(link);
  });
  loaded.set(href, p);
  return p;
}
function addScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    const t = setTimeout(() => { loaded.delete(src); s.remove(); reject(new Error('script timeout')); }, 15000);
    s.addEventListener('load', () => { clearTimeout(t); resolve(); }, { once: true });
    s.addEventListener('error', () => { clearTimeout(t); loaded.delete(src); s.remove(); reject(new Error('script failed')); }, { once: true });
    document.head.append(s);
  });
  loaded.set(src, p);
  return p;
}

// Ar telefonas moka piešti vektorinį žemėlapį (WebGL).
export function webglOk() {
  if (window.__assumeWebgl) return true; // testams (naršyklė be vaizdo plokštės)
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

export async function loadMapLibre() {
  if (!webglOk()) throw new Error('no webgl');
  await Promise.all([addScript(window.__maplibreUrl || MAPLIBRE_JS), addCss(window.__maplibreCssUrl || MAPLIBRE_CSS)]);
  if (!window.maplibregl?.Map) throw new Error('maplibre missing');
  return window.maplibregl;
}

// Paros laikas pagal laimikio laiką (telefono laiku).
export const DAYPARTS = [['morning', 'Rytas', 5, 11], ['day', 'Diena', 11, 17], ['evening', 'Vakaras', 17, 22], ['night', 'Naktis', 22, 5]];
export function daypartOf(iso) {
  const h = new Date(iso).getHours();
  for (const [key, , from, to] of DAYPARTS) {
    if (from < to ? h >= from && h < to : h >= from || h < to) return key;
  }
  return 'night';
}
export const daypartLabel = (key) => DAYPARTS.find((d) => d[0] === key)?.[1] ?? '';
const DAYPART_OFTEN = { morning: 'dažniausiai rytais', day: 'dažniausiai dieną', evening: 'dažniausiai vakarais', night: 'dažniausiai naktį' };

// Laikotarpio filtras: 'all', '30d', 'YYYY'.
export function inPeriod(iso, period, now = Date.now()) {
  if (!period || period === 'all') return true;
  if (period === '30d') return now - new Date(iso).getTime() <= 30 * 864e5;
  return String(new Date(iso).getFullYear()) === String(period);
}

// Geriausios vietos: laimikiai ~300 m spinduliu – viena vieta. Rikiuojama pagal kiekį, paskui pagal didžiausią žuvį.
export function bestSpots(points, meters = 300) {
  return groupSpots(points, meters).map((g) => {
    const best = g.items.reduce((m, c) => (c.length_mm > m.length_mm ? c : m), g.items[0]);
    const parts = new Map();
    g.items.forEach((c) => { const k = daypartOf(c.captured_at_device); parts.set(k, (parts.get(k) || 0) + 1); });
    const top = [...parts].sort((a, b) => b[1] - a[1])[0];
    const often = g.items.length >= 3 && top && top[1] / g.items.length >= 0.5 ? DAYPART_OFTEN[top[0]] : '';
    const lat = g.items.reduce((s, c) => s + c.lat, 0) / g.items.length;
    const lng = g.items.reduce((s, c) => s + c.lng, 0) / g.items.length;
    return { lat, lng, items: g.items, best, often };
  }).sort((a, b) => b.items.length - a.items.length || b.best.length_mm - a.best.length_mm);
}

export function toGeoJSON(points) {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: { id: p.id, color: colorFor(p.species_id), len: p.length_mm }
    }))
  };
}
