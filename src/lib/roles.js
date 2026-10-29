// Rolės ir teisės (0014). Tikrina serveris – čia tik tam, kad rodytume tinkamus meniu.
// Teisės: review – laimikių eilė ir GPS vietos; disputes – ginčai ir pranešimai;
//         ban – blokavimas ir slapyvardžiai; roles – rolių skyrimas; tournaments – bet kurio turnyro taisymas ir pašalinimas (0026);
//         publish – viešų turnyrų kūrimas (0028; organizatorius nėra komandos narys).
export const ROLES = [
  { key: 'owner', label: 'Savininkas', perms: ['review', 'disputes', 'ban', 'roles', 'tournaments', 'publish'],
    desc: 'Viskas, taip pat rolių skyrimas. Programėlėje nekeičiama.' },
  { key: 'admin', label: 'Administratorius', perms: ['review', 'disputes', 'ban', 'tournaments', 'publish'],
    desc: 'Tikrina laimikius, sprendžia ginčus ir pranešimus, blokuoja žvejus, taiso ir šalina bet kurį turnyrą.' },
  { key: 'moderator', label: 'Laimikių tikrintojas', perms: ['review'],
    desc: 'Tvirtina ir atmeta laimikius, mato jų tikslias vietas.' },
  { key: 'judge', label: 'Ginčų teisėjas', perms: ['disputes'],
    desc: 'Sprendžia ginčus ir pranešimus apie įtartinus laimikius.' },
  { key: 'guard', label: 'Bendruomenės prižiūrėtojas', perms: ['ban'],
    desc: 'Blokuoja žvejus ir keičia netinkamus slapyvardžius.' },
  { key: 'organizer', label: 'Organizatorius', perms: ['publish'], staff: false,
    desc: 'Kuria viešus turnyrus, matomus visų sąraše. Komandos teisių neturi. Privačius turnyrus su kvietimu gali kurti visi.' }
];

// Komandos rolės (mato moderavimą ir pan.); organizatorius – ne komanda.
export const STAFF_ROLES = ROLES.filter((r) => r.staff !== false).map((r) => r.key);

export const ASSIGNABLE = ROLES.filter((r) => r.key !== 'owner');

export const roleLabel = (key) => ROLES.find((r) => r.key === key)?.label ?? key;

// Profilio rolės. Senas profilis be „roles“, bet su is_admin – laikomas savininku (kaip buvo iki rolių).
export function rolesOf(profile) {
  if (!profile) return [];
  if (Array.isArray(profile.roles)) return profile.roles;
  return profile.is_admin ? ['owner'] : [];
}

export function permsOf(profile) {
  const out = new Set();
  for (const key of rolesOf(profile)) ROLES.find((r) => r.key === key)?.perms.forEach((p) => out.add(p));
  return out;
}

export const isStaff = (profile) => rolesOf(profile).some((r) => STAFF_ROLES.includes(r));

// Ar prisijungęs vartotojas turi teisę (pagal jo profilį būsenoje).
export const can = (state, perm) => permsOf(state?.profile).has(perm);
