// Oras laimikio vietoje (Open-Meteo, be rakto). Neprivaloma: jei nepavyksta per 4 s – be oro.
// Pastaba: nemokamas Open-Meteo planas skirtas nekomercinei veiklai; įjungus mokamus turnyrus
// reikės jų komercinio plano arba kito tiekėjo.

const URL_BASE = 'https://api.open-meteo.com/v1/forecast';

export const WEATHER_LT = {
  0: 'Giedra', 1: 'Beveik giedra', 2: 'Debesuota su pragiedruliais', 3: 'Debesuota',
  45: 'Rūkas', 48: 'Rūkas', 51: 'Dulksna', 53: 'Dulksna', 55: 'Dulksna',
  61: 'Lietus', 63: 'Lietus', 65: 'Smarkus lietus', 66: 'Lijundra', 67: 'Lijundra',
  71: 'Sniegas', 73: 'Sniegas', 75: 'Smarkus sniegas', 77: 'Sniegas',
  80: 'Liūtis', 81: 'Liūtis', 82: 'Smarki liūtis', 85: 'Sniego gūsiai', 86: 'Sniego gūsiai',
  95: 'Perkūnija', 96: 'Perkūnija', 99: 'Perkūnija'
};

export function parseWeather(json) {
  const c = json?.current;
  if (!c || typeof c.temperature_2m !== 'number') return null;
  const num = (v, d = 1) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
  return {
    temp_c: num(c.temperature_2m),
    wind_ms: num(c.wind_speed_10m),
    pressure_hpa: num(c.surface_pressure, 0),
    code: Number.isInteger(c.weather_code) ? c.weather_code : null
  };
}

export async function fetchWeather(lat, lng, { timeoutMs = 4000, fetchImpl = fetch } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const q = `latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
      '&current=temperature_2m,wind_speed_10m,surface_pressure,weather_code&wind_speed_unit=ms&timezone=auto';
    const res = await fetchImpl(`${URL_BASE}?${q}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return parseWeather(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function weatherLine(w) {
  if (!w) return '';
  const parts = [];
  if (w.temp_c !== null && w.temp_c !== undefined) parts.push(`${String(w.temp_c).replace('.', ',')} °C`);
  if (w.code !== null && w.code !== undefined && WEATHER_LT[w.code]) parts.push(WEATHER_LT[w.code].toLowerCase());
  if (w.wind_ms !== null && w.wind_ms !== undefined) parts.push(`vėjas ${String(w.wind_ms).replace('.', ',')} m/s`);
  if (w.pressure_hpa) parts.push(`${w.pressure_hpa} hPa`);
  return parts.join(', ');
}
