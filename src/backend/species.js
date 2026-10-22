// Tas pats sąrašas ir tvarka kaip supabase/seed.sql (id = eilės numeris).
export const SPECIES = [
  ['lydeka', 'Lydeka'], ['eserys', 'Ešerys'], ['starkis', 'Starkis'], ['karsis', 'Karšis'],
  ['kuoja', 'Kuoja'], ['karpis', 'Karpis'], ['lynas', 'Lynas'], ['sapalas', 'Šapalas'],
  ['salatis', 'Salatis'], ['strepetys', 'Strepetys'], ['plakis', 'Plakis'], ['raude', 'Raudė'],
  ['karosas', 'Karosas'], ['usorius', 'Ūsorius'], ['vegele', 'Vėgėlė'], ['samas', 'Šamas'],
  ['upetakis', 'Upėtakis'], ['kirslys', 'Kiršlys'], ['kita', 'Kita']
].map(([code, name_lt], i) => ({ id: i + 1, code, name_lt }));

export const speciesId = (code) => SPECIES.find((s) => s.code === code)?.id;
