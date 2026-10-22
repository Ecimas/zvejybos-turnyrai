-- Dažniausios Lietuvos vidaus vandenų žuvų rūšys.
insert into public.species (code, name_lt, name_lat) values
  ('lydeka',   'Lydeka',   'Esox lucius'),
  ('eserys',   'Ešerys',   'Perca fluviatilis'),
  ('starkis',  'Starkis',  'Sander lucioperca'),
  ('karsis',   'Karšis',   'Abramis brama'),
  ('kuoja',    'Kuoja',    'Rutilus rutilus'),
  ('karpis',   'Karpis',   'Cyprinus carpio'),
  ('lynas',    'Lynas',    'Tinca tinca'),
  ('sapalas',  'Šapalas',  'Squalius cephalus'),
  ('salatis',  'Salatis',  'Leuciscus aspius'),
  ('strepetys','Strepetys','Leuciscus idus'),
  ('plakis',   'Plakis',   'Blicca bjoerkna'),
  ('raude',    'Raudė',    'Scardinius erythrophthalmus'),
  ('karosas',  'Karosas',  'Carassius carassius'),
  ('usorius',  'Ūsorius',  'Barbus barbus'),
  ('vegele',   'Vėgėlė',   'Lota lota'),
  ('samas',    'Šamas',    'Silurus glanis'),
  ('upetakis', 'Upėtakis', 'Salmo trutta'),
  ('kirslys',  'Kiršlys',  'Thymallus thymallus'),
  ('kita',     'Kita',     null)
on conflict (code) do nothing;
