// Ženkliukai skaičiuojami iš patvirtintų laimikių – serveryje nieko papildomai nesaugoma.

const DAY = 24 * 3600e3;

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
}

// Ilgiausia serija kalendorinių dienų iš eilės, kai buvo bent vienas laimikis.
export function longestStreak(dates) {
  const days = [...new Set(dates.map(dayKey))]
    .map((k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m, d).getTime(); })
    .sort((a, b) => a - b);
  let best = 0;
  let cur = 0;
  for (let i = 0; i < days.length; i++) {
    cur = i > 0 && Math.round((days[i] - days[i - 1]) / DAY) === 1 ? cur + 1 : 1;
    best = Math.max(best, cur);
  }
  return best;
}

export function computeBadges(catches, tournamentCount = 0) {
  const ok = catches.filter((c) => c.status === 'approved');
  const species = new Set(ok.map((c) => c.species_id)).size;
  const biggest = ok.reduce((m, c) => Math.max(m, c.length_mm), 0);
  const streak = longestStreak(ok.map((c) => c.captured_at_device));
  const defs = [
    ['first', 'Pirmas laimikis', 'Patvirtintas pirmas laimikis', ok.length, 1],
    ['catches25', '25 laimikiai', 'Patvirtinta 25 laimikiai', ok.length, 25],
    ['catches100', '100 laimikių', 'Patvirtinta 100 laimikių', ok.length, 100],
    ['species5', '5 rūšys', 'Sugautos 5 skirtingos rūšys', species, 5],
    ['species10', '10 rūšių', 'Sugauta 10 skirtingų rūšių', species, 10],
    ['big80', 'Didžiulė', 'Žuvis nuo 80 cm', biggest, 800],
    ['metre', 'Metrinė', 'Žuvis nuo 100 cm', biggest, 1000],
    ['streak3', '3 dienos iš eilės', 'Laimikiai tris dienas iš eilės', streak, 3],
    ['streak7', 'Savaitė be pertraukos', 'Laimikiai septynias dienas iš eilės', streak, 7],
    ['tourn5', '5 turnyrai', 'Dalyvauta 5 turnyruose', tournamentCount, 5]
  ];
  return defs.map(([key, name, desc, value, goal]) => ({
    key, name, desc, earned: value >= goal, progress: Math.min(1, value / goal)
  }));
}
