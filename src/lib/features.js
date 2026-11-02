// Programėlės funkcijų jungikliai: pavadinimai ir aprašymai administravimo panelei.
// Išjungta funkcija tik nebeleidžia kurti naujo ir paslepia mygtukus – duomenys neištrinami.

export const FEATURE_GROUPS = [
  ['Žemėlapiai', [
    ['map_vector', 'Naujas žemėlapis', 'Vektorinis žemėlapis su burbulais ir šiluma. Išjungus – paprastas žemėlapis.'],
    ['club_map', 'Klubo žemėlapis', 'Narių laimikiai klubo žemėlapyje (~1 km tikslumu).']
  ]],
  ['Turnyrai', [
    ['leagues', 'Sezono lygos', 'Lygų kūrimas ir turnyrų įtraukimas į lygas. Išjungus lygų puslapiai paslepiami.'],
    ['duels', 'Dvikovos', 'Naujų dvikovų turnyrų kūrimas. Jau vykstančios dvikovos tęsiasi.']
  ]],
  ['Bendruomenė', [
    ['social_follow', 'Sekimas ir naujienos', 'Žvejų sekimas ir sekamų žvejų laimikių srautas.']
  ]],
  ['Klubai – bendravimas', [
    ['club_posts', 'Klubo pranešimai', 'Valdytojų pranešimai nariams.'],
    ['club_tips', 'Patarimai', 'Narių patarimai ir „patinka“.'],
    ['club_reactions', 'Reakcijos', '👍 🔥 🎣 prie klubo draugų laimikių.'],
    ['club_comments', 'Komentarai', 'Komentarai prie klubo draugų laimikių.']
  ]],
  ['Klubai – veikla', [
    ['club_trips', 'Išvykos', 'Bendros išvykos ir „važiuoju“.'],
    ['club_challenge', 'Mėnesio iššūkis', 'Didžiausios mėnesio žuvies varžybos klube.'],
    ['club_records', 'Rekordai ir sezonas', 'Klubo rekordai ir sezono taškai.'],
    ['club_league', 'Klubų lyga', 'Klubų reitingas tarpusavyje.'],
    ['club_perks', 'Rėmėjų nuolaidos', 'Nuolaidos klubo nariams.'],
    ['club_tournament', 'Klubo turnyrai', 'Turnyro kūrimas klubo nariams.']
  ]],
  ['Dienoraštis', [
    ['weather', 'Orai', 'Oro duomenys įrašomi registruojant laimikį. Jau įrašyti lieka.'],
    ['blank_trips', '„Nieko nekibo“', 'Tuščių išvykų žymėjimas dienoraštyje.']
  ]]
];

export const FEATURES = FEATURE_GROUPS.flatMap(([, list]) => list);
export const FEATURE_KEYS = FEATURES.map(([key]) => key);
export const featureLabel = (key) => (key === 'banner' ? 'Skelbimas visiems' : FEATURES.find(([k]) => k === key)?.[1] ?? key);
