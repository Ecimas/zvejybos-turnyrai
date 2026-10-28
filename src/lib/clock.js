// Telefono laikrodžio patikra. Kai yra ryšys, programėlė paklausia serverio laiko ir susieja jį su
// performance.now() – monotoniniu laikmačiu, kurio nepakeičia telefono laikrodžio keitimas nustatymuose.
// Fotografuojant apskaičiuojama, kiek telefono laikas skiriasi nuo tikro. Rezultatas – užuomina moderatoriui:
// klientu aklai pasitikėti negalima, bet paprastas „pasuksiu laikrodį atgal“ taip pastebimas.

const FRESH_MS = 15 * 60e3; // senesnis susiejimas nepatikimas (telefonas galėjo užmigti)
let anchor = null; // { server: ms, perf: ms }

export async function syncClock(backend, now = () => performance.now()) {
  if (!backend?.serverNow) return false;
  try {
    const t0 = now();
    const iso = await backend.serverNow();
    const t1 = now();
    const server = Date.parse(iso);
    if (!Number.isFinite(server) || t1 - t0 > 5000) return false; // per lėtas atsakymas – netikslu
    anchor = { server: server + (t1 - t0) / 2, perf: t1 };
    return true;
  } catch {
    return false;
  }
}

// Tikras laikas pagal serverį arba null, jei susiejimo nėra ar jis pasenęs.
export function trustedNow(now = () => performance.now()) {
  if (!anchor) return null;
  const age = now() - anchor.perf;
  if (age < 0 || age > FRESH_MS) return null;
  return anchor.server + age;
}

// Kiek sekundžių tikras laikas lenkia telefono laiką (teigiamas – telefonas atsilieka).
export function clockOffsetS(deviceMs, now) {
  const t = trustedNow(now);
  return t === null ? null : Math.round((t - deviceMs) / 1000);
}

export function resetClock() { anchor = null; }

// Moderatoriui: ar laimikio laikas įtartinas. Grąžina įspėjimų tekstus.
export const OFFSET_WARN_S = 120;
export const DELAY_WARN_MIN = 60;

export function clockWarnings(c, fmt) {
  const out = [];
  const off = c.clock_offset_s;
  const delayMin = Math.round((Date.parse(c.received_at) - Date.parse(c.captured_at_device)) / 60000);
  if (off !== null && off !== undefined && Math.abs(off) >= OFFSET_WARN_S) {
    const real = new Date(Date.parse(c.captured_at_device) + off * 1000);
    const min = Math.round(Math.abs(off) / 60);
    out.push(`Telefono laikas ${off > 0 ? 'atsiliko' : 'skubėjo'} ${min >= 120 ? `${Math.round(min / 60)} val.` : `${min} min.`} – tikras fotografavimo laikas apie ${fmt(real)}`);
  }
  if ((off === null || off === undefined) && delayMin >= DELAY_WARN_MIN) {
    out.push(`Išsiųsta tik po ${delayMin >= 120 ? `${Math.round(delayMin / 60)} val.` : `${delayMin} min.`} ir telefono laikas nepatikrintas (be ryšio) – įsitikink, kad laikas tikras`);
  }
  return out;
}
