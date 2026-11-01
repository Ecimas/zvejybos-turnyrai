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
