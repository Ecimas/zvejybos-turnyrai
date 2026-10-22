// Saugus HTML šablonas: visos įterptos reikšmės ištrūkinamos (escape),
// todėl vartotojų įvestas tekstas (slapyvardžiai, pavadinimai) negali įterpti kodo.

export class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, (c) => MAP[c]);
}

function part(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
}

// Tik programos paties sukurtam, patikimam turiniui (pvz. SVG ikonoms).
export const raw = (s) => new Safe(String(s));
