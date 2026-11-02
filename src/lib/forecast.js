// Šiandienos orų prognozė kibimo kortelei (Open-Meteo, be rakto). Vieta – tik telefone (suapvalinta),
// prognozė laikoma valandą, kad be ryšio būtų ką parodyti.
const URL_BASE = 'https://api.open-meteo.com/v1/forecast';
const LOC_KEY = 'zt-fc-loc';
const CACHE_KEY = 'zt-forecast';
const TTL = 60 * 60e3;

const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* nėra saugyklos */ } };

export const savedLocation = () => {
  const l = read(LOC_KEY);
  return l && Number.isFinite(l.lat) && Number.isFinite(l.lng) ? l : null;
};
export const saveLocation = (lat, lng) => write(LOC_KEY, { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 });
export const forgetLocation = () => { try { localStorage.removeItem(LOC_KEY); localStorage.removeItem(CACHE_KEY); } catch { /* */ } };

export function parseForecast(json) {
  const h = json?.hourly;
  if (!h || !Array.isArray(h.time) || !h.time.length) return null;
  const n = (arr, i) => (Array.isArray(arr) && typeof arr[i] === 'number' ? arr[i] : null);
  const hours = h.time.map((t, i) => ({
    t: t * 1000,
    temp: n(h.temperature_2m, i),
    pressure: n(h.surface_pressure, i),
    wind: n(h.wind_speed_10m, i),
    dir: n(h.wind_direction_10m, i),
    code: n(h.weather_code, i)
  })).filter((x) => x.temp !== null && x.pressure !== null);
  if (!hours.length) return null;
  // Šiandienos saulėtekis ir saulėlydis (daily – dvi dienos: šiandien ir rytoj; imam artimiausią šiandienai).
  const today = new Date().toDateString();
  const d = json.daily || {};
  const pick = (arr) => (Array.isArray(arr) ? arr.map((s) => s * 1000).find((ms) => new Date(ms).toDateString() === today) ?? (arr[0] ? arr[0] * 1000 : null) : null);
  return { hours, sunrise: pick(d.sunrise), sunset: pick(d.sunset) };
}

// Grąžina { data, at, cached } arba null.
export async function getForecast(lat, lng, { fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  const c = read(CACHE_KEY);
  const fresh = c && c.lat === lat && c.lng === lng && Date.now() - c.at < TTL;
  if (fresh) return { data: c.data, at: c.at, cached: true };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const q = `latitude=${lat.toFixed(2)}&longitude=${lng.toFixed(2)}&hourly=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,weather_code`
      + '&daily=sunrise,sunset&wind_speed_unit=ms&timeformat=unixtime&timezone=auto&past_days=1&forecast_days=2';
    const res = await fetchImpl(`${URL_BASE}?${q}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = parseForecast(await res.json());
    if (!data) throw new Error('bad');
    const at = Date.now();
    write(CACHE_KEY, { lat, lng, at, data });
    return { data, at, cached: false };
  } catch {
    // Be ryšio – paskutinė (net ir senesnė) prognozė, jei ta pati vieta ir ne senesnė nei para.
    if (c && c.lat === lat && c.lng === lng && Date.now() - c.at < 24 * TTL) return { data: c.data, at: c.at, cached: true };
    return null;
  } finally {
    clearTimeout(timer);
  }
}
