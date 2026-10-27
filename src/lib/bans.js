// Vartotojų blokavimas (0013): trukmės pasirinkimai ir tekstai.
import { dateTime } from './format.js';

export const BAN_DAYS = [
  [1, '1 dieną'],
  [7, '7 dienas'],
  [30, '30 dienų'],
  [null, 'Visam laikui']
];

export const BAN_REASONS = ['Sukčiavimas su laimikiais', 'Netinkamas elgesys', 'Šlamštas ar melagingi pranešimai'];

// Ar blokavimas dar galioja (until null – visam laikui).
export function banActive(b, now = Date.now()) {
  return !!b && (!b.until || Date.parse(b.until) > now);
}

export function banUntilText(b) {
  return b.until ? `iki ${dateTime(b.until)}` : 'visam laikui';
}
