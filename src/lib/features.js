// Programėlės funkcijų jungikliai: pavadinimai ir aprašymai administravimo panelei.
// Išjungta funkcija tik nebeleidžia kurti naujo ir paslepia mygtukus – duomenys neištrinami.
import { feat } from './clubs.js';
import { can } from './roles.js';

export const FEATURE_GROUPS = [
  ['Žemėlapiai', [
    ['map_vector', 'Naujas žemėlapis', 'Vektorinis žemėlapis su burbulais ir šiluma. Išjungus – paprastas žemėlapis.'],
    ['club_map', 'Klubo žemėlapis', 'Narių laimikiai klubo žemėlapyje (~1 km tikslumu).']
  ]],
  ['Turnyrai', [
    ['tournament_create', 'Turnyrų kūrimas', 'Naujų turnyrų (ir klubų turnyrų) kūrimas. Išjungus kurti gali tik savininkas; esami turnyrai vyksta toliau.'],
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
    ['club_comments', 'Komentarai', 'Komentarai prie klubo draugų laimikių.'],
    ['club_chat', 'Klubų pokalbiai', 'Bendri klubo narių pokalbiai žinutėse. Išjungus – rašyti nebegalima, senos žinutės lieka.']
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
    ['blank_trips', 'Išvykos', 'Išvykų (ir „Nieko nekibo“) žymėjimas dienoraštyje su vieta ir pastabomis.']
  ]]
];

export const FEATURES = FEATURE_GROUPS.flatMap(([, list]) => list);
export const FEATURE_KEYS = FEATURES.map(([key]) => key);
// Ar šis žmogus dabar gali kurti naują turnyrą (savininkas – visada).
export const canCreateTournament = (state) => feat(state, 'tournament_create') || can(state, 'roles');
export const featureLabel = (key) => (key === 'banner' ? 'Skelbimas visiems' : FEATURES.find(([k]) => k === key)?.[1] ?? key);
