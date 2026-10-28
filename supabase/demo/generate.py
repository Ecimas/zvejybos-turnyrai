#!/usr/bin/env python3
"""Partnerių demonstracinio turnyro generatorius: išveda SQL ir įkėlimo paketus."""
import json, random, math
from datetime import datetime, timedelta, timezone

random.seed(20261028)
OUT = __import__('os').path.dirname(__import__('os').path.abspath(__file__)) + '/out/'
ECIMAS = 'fd96f036-0d90-48d8-89eb-b5e7685c9b83'
TID = 'de300000-0000-4000-8000-00000000d001'
DIV_K = 'de300000-0000-4000-8000-00000000d0a1'
DIV_V = 'de300000-0000-4000-8000-00000000d0a2'
UTC = timezone.utc
# Lietuvoje nuo spalio 25 d. žiemos laikas (UTC+2), iki tol – UTC+3
def lt(y, m, d, h, mi=0):
    off = 3 if (m, d) < (10, 25) else 2
    return datetime(y, m, d, h, mi, tzinfo=UTC) - timedelta(hours=off)

START = lt(2026, 10, 21, 8)
END = lt(2026, 11, 4, 20)
NOW = datetime(2026, 10, 28, 15, 40, tzinfo=UTC)

NICKS = [
 ('Spiningistas_Jonas', 'Vilnius'), ('Ešerių_Karalius', 'Kaunas'), ('Mantas_Žvejys', 'Klaipėda'),
 ('RasaNemune', 'Kaunas'), ('Darius.Lydekininkas', 'Utena'), ('Valtis_Kaunas', 'Kaunas'),
 ('Tadas_Molas', 'Molėtai'), ('Žuvėdra77', 'Klaipėda'), ('Aurimas_Spin', 'Šiauliai'),
 ('Giedrė_Plūdė', 'Panevėžys'), ('Vytas_Ežerai', 'Zarasai'), ('Lukas.Jig', 'Vilnius'),
 ('Paulius_Marios', 'Kaunas'), ('Kęstas_Trolingas', 'Alytus'), ('Rokas_Dzūkas', 'Alytus'),
 ('Ignas_Valtininkas', 'Trakai'), ('Laura.Spiningas', 'Vilnius'), ('Marius_Ešerys', 'Marijampolė'),
 ('Šarūnas_Vobleris', 'Telšiai'), ('Edvinas_Plaštaka', 'Tauragė'), ('Simonas_Krantas', 'Vilnius'),
 ('Andrius_Tauragnai', 'Utena'), ('Evaldas_Ruduo', 'Panevėžys'), ('Gintas_Rytas', 'Šiauliai'),
 ('Algis_Senasis', 'Birštonas'), ('Jurgita.Žvejė', 'Vilnius'), ('Nerijus_Dubysa', 'Raseiniai'),
 ('Karolis_Sartai', 'Rokiškis'), ('Vaidas_Platelė', 'Plungė'),
]
LAKES = {
 'Vilnius': (54.653, 24.933), 'Trakai': (54.646, 24.934), 'Kaunas': (54.873, 24.06), 'Birštonas': (54.62, 24.03),
 'Klaipėda': (55.32, 21.12), 'Utena': (55.45, 25.83), 'Molėtai': (55.17, 25.47), 'Zarasai': (55.62, 26.45),
 'Šiauliai': (55.86, 23.42), 'Panevėžys': (55.52, 25.28), 'Alytus': (54.29, 24.0), 'Marijampolė': (54.43, 22.73),
 'Telšiai': (55.99, 22.24), 'Tauragė': (55.29, 22.33), 'Plungė': (56.04, 21.84), 'Raseiniai': (55.34, 23.2),
 'Rokiškis': (55.79, 25.84),
}

users = []
for i, (nick, region) in enumerate(NICKS, 1):
    uid = f'de30{i:04d}-0000-4000-8000-00000000de30'
    created = lt(2026, random.choice([7, 8, 9, 10]), random.randint(1, 20), random.randint(7, 21), random.randint(0, 59))
    joined = START - timedelta(hours=random.randint(2, 120), minutes=random.randint(0, 59))
    if i in (27, 28):  # du užsiregistravo jau vykstant turnyrui
        joined = START + timedelta(days=random.randint(1, 3), hours=random.randint(1, 8))
    users.append(dict(i=i, id=uid, nick=nick, region=region, created=min(created, joined - timedelta(days=1)), joined=joined,
                      div=DIV_V if i % 3 == 0 or i in (5, 14, 16) else DIV_K))

TITLES = json.load(open(OUT + '../titles.json'))
PIKE = [t for t in TITLES['pike'] if t not in ('File:Esox Lucius.jpg', 'File:BRO melan Paladru 08 06 25 A.jpg')]
PERCH = TITLES['perch']
ZANDER = TITLES['zander']
photo_pool = {1: [(t, v) for t in PIKE for v in (0, 1, 2, 3)], 2: [(t, v) for t in PERCH for v in (0, 1, 2, 3)], 3: [(t, v) for t in ZANDER for v in (0, 1, 2, 3)]}
for k in photo_pool:
    random.shuffle(photo_pool[k])

# Kiek laimikių kiekvienam: keli aktyvūs, dauguma 2–4, du dar be laimikių
counts = {u['i']: c for u, c in zip(users, [7, 6, 6, 5, 5, 5, 4, 4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 0, 0])}
random_order = list(range(1, 30)); random.shuffle(random_order)
counts = {random_order[k - 1]: v for k, v in counts.items()}
counts[27] = 1; counts[28] = 0  # vėlai prisijungę

BAITS = {1: ['vobleris 12 cm', 'guminukas 10 cm', 'blizgė Nr. 3', 'džerkas', 'svyruoklė 18 g', 'vobleris 9 cm', 'guminukas 12 cm, džigas'],
         2: ['mikro džigas 5 cm', 'sukriukė Nr. 2', 'guminukas 5 cm', 'balansyras', 'drop shot', 'sukriukė Nr. 1', 'mormyška ir kirmėlė'],
         3: ['guminukas 10 cm, džigas', 'vobleris 11 cm']}
NOTES = {1: ['Paleista atgal', 'Kibo prie meldų', 'Ilgai kovojo!', 'Paimta prie povandeninio kalno', None, None, None, None],
         2: ['Būrys stovėjo 4 m gylyje', 'Paleistas atgal', 'Geras kibimas', None, None, None, None, None],
         3: ['Prie tilto, 6 m gylyje', None]}

def length(sp):
    if sp == 1: return int(min(1040, max(460, random.gauss(640, 110)))) // 5 * 5 + random.choice([0, 0, 5])
    if sp == 2: return int(min(445, max(210, random.gauss(300, 50)))) // 5 * 5
    return int(min(760, max(500, random.gauss(600, 70)))) // 5 * 5

def weight(sp, mm):
    inch = mm / 25.4
    lb = inch ** 3 / (3500 if sp == 1 else 1600 if sp == 2 else 2700)
    return int(round(lb * 453.6 / 10) * 10)

def daytime(day0, day1):
    d = random.randint(day0, day1)
    base = START.replace(hour=0, minute=0) + timedelta(days=d)
    h = random.choice([6, 7, 7, 8, 8, 9, 10, 11, 13, 14, 15, 16, 16, 17])
    t = base + timedelta(hours=h - 2, minutes=random.randint(0, 59), seconds=random.randint(0, 59))
    return t

catches = []
n_photo = 0
def add_catch(uid, sp, when, folder_uid=None, status='approved'):
    global n_photo
    used = {c['title'] for c in catches if c['uid'] == uid}
    pool = photo_pool[sp]
    k = next((j for j in range(len(pool) - 1, -1, -1) if pool[j][0] not in used), len(pool) - 1)
    title, v = pool.pop(k)
    n_photo += 1
    mm = length(sp)
    rec = when + timedelta(seconds=random.randint(25, 1500))
    lat, lng = LAKES[next(u['region'] for u in users if u['id'] == uid)] if uid != ECIMAS else LAKES['Kaunas']
    c = dict(id=f'de300000-0000-4000-9000-{n_photo:012d}', uid=uid, sp=sp, mm=mm, captured=when, received=rec,
             path=f'{uid}/demo-{n_photo:03d}.jpg', title=title, variant=v, status=status,
             bait=random.choice(BAITS[sp]), notes=random.choice(NOTES[sp]),
             weight=weight(sp, mm) if random.random() < 0.55 else None,
             clock=random.choice([0, 0, 1, -1, 2, 0, 3]),
             lat=lat + random.uniform(-0.03, 0.03), lng=lng + random.uniform(-0.04, 0.04),
             weather=dict(temp_c=round(random.uniform(3.5, 12.5), 1), wind_ms=round(random.uniform(0.8, 7.5), 1),
                          pressure_hpa=random.randint(998, 1027), code=random.choice([0, 1, 2, 2, 3, 3, 3, 61, 80, 45])))
    catches.append(c)
    return c

for u in users:
    n = counts[u['i']]
    for k in range(n):
        sp = random.choices([1, 2, 3], weights=[len(photo_pool[1]), len(photo_pool[2]), len(photo_pool[3]) * 4])[0]
        if not photo_pool[sp]:
            sp = 1 if photo_pool[1] else 2
        first = max(0, (u['joined'] - START).days + 1)
        for _ in range(50):
            when = daytime(first, 7)
            if when > max(u['joined'], START) and when < NOW - timedelta(minutes=40):
                break
        add_catch(u['id'], sp, when)

# Ecimas – organizatorius ir dalyvis (prisijungė spalio 27 d., po bandomųjų laimikių)
EC_JOIN = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)
ec = [add_catch(ECIMAS, 1, datetime(2026, 10, 27, 14, 22, 10, tzinfo=UTC)),
      add_catch(ECIMAS, 2, datetime(2026, 10, 28, 6, 51, 40, tzinfo=UTC)),
      add_catch(ECIMAS, 2, datetime(2026, 10, 28, 8, 5, 2, tzinfo=UTC))]
ec[0]['mm'] = 785; ec[0]['weight'] = weight(1, 785); ec[1]['mm'] = 340; ec[2]['mm'] = 365

# Moderacijai: 3 naujausi laukia patvirtinimo, vienas atmestas
by_time = sorted([c for c in catches if c['uid'] != ECIMAS], key=lambda c: c['captured'])
recent = [c for c in by_time if c['captured'] > NOW - timedelta(hours=30)]
for c in recent[-3:]:
    c['status'] = 'pending'
rej = by_time[len(by_time) // 3]
rej['status'] = 'rejected'; rej['reason'] = 'Nuotraukoje nesimato matavimo liniuotės – įkelk nuotrauką su liniuote.'

sq = lambda s: "'" + str(s).replace("'", "''") + "'" if s is not None else 'null'
ts = lambda d: sq(d.isoformat())

# ---------- 1. Žvejai, turnyras, dalyviai ----------
s = ['begin;']
for u in users:
    email = f"demo{u['i']:02d}@demo.invalid"
    s.append(f"insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous) values ('00000000-0000-0000-0000-000000000000', {sq(u['id'])}, 'authenticated', 'authenticated', {sq(email)}, '', '{{\"provider\":\"email\",\"providers\":[\"email\"]}}', '{{\"demo\":true}}', {ts(u['created'])}, {ts(u['created'])}, false, false);")
    s.append(f"update public.profiles set nickname = {sq(u['nick'])}, region = {sq(u['region'])}, is_demo = true, created_at = {ts(u['created'])} where id = {sq(u['id'])};")
desc = ("DEMONSTRACINIS TURNYRAS partnerių pristatymui: dalyviai ir laimikiai – pavyzdiniai, ne tikri žvejai. "
        "Nuotraukos – tikros žuvų nuotraukos iš Wikimedia Commons (laisvos licencijos, autoriai nurodyti: zvejybos-turnyrai.vercel.app/demo-nuotraukos.html).\n\n"
        "Taisyklės: skaičiuojami 3 vertingiausi laimikiai. Taškai = ilgis (cm) × rūšies koeficientas: lydeka ×1, ešerys ×2, starkis ×1,2. "
        "Mažiausias ilgis – 20 cm. Kiekvienas laimikis fotografuojamas programėlės kamera su liniuote, jį patvirtina teisėjas. "
        "Dvi grupės: „Krantas“ ir „Valtis“ – kiekviena turi savo lentelę.")
s.append(f"""insert into public.tournaments (id, organizer_id, title, description, format, top_n, min_length_mm, starts_at, ends_at, visibility, prizes, sponsor_name, prize_fund_cents, prize_split, late_join_minutes)
values ({sq(TID)}, {sq(ECIMAS)}, 'DEMO · Rudens lydekų ir ešerių taurė', {sq(desc)}, 'species_points', 3, 200, {ts(START)}, {ts(END)}, 'private',
 {sq('1 vieta – 500 €, 2 vieta – 300 €, 3 vieta – 200 €. Papildomi prizai partnerio – didžiausiai lydekai ir didžiausiam ešeriui (pavyzdys).')},
 'Čia – partnerio vardas', 100000, '[50,30,20]', null);""")
s.append(f"insert into public.tournament_species (tournament_id, species_id, points_pct) values ({sq(TID)}, 1, 100), ({sq(TID)}, 2, 200), ({sq(TID)}, 3, 120);")
s.append(f"insert into public.tournament_divisions (id, tournament_id, name, sort) values ({sq(DIV_K)}, {sq(TID)}, 'Krantas', 1), ({sq(DIV_V)}, {sq(TID)}, 'Valtis', 2);")
for u in users:
    s.append(f"insert into public.entries (tournament_id, user_id, joined_at, division_id) values ({sq(TID)}, {sq(u['id'])}, {ts(u['joined'])}, {sq(u['div'])});")
s.append('commit;')
s.append(f"select (select count(*) from public.profiles where is_demo) demo_users, (select count(*) from public.entries where tournament_id = {sq(TID)}) entries;")
open(OUT + 'seed1.sql', 'w').write('\n'.join(s))

# ---------- 2. Įkėlimo paketai: viena nuotrauka (visi jos variantai) – viena užklausa ----------
groups = {}
for c in catches:
    groups.setdefault(c['title'], []).append(dict(title=c['title'], path=c['path'], variant=c['variant']))
batches = list(groups.values())
json.dump(batches, open(OUT + 'batches.json', 'w'), ensure_ascii=False)

# ---------- 3. Laimikiai (sha256 imamas iš įkėlimo atsakymų) ----------
vals = []
for c in catches:
    vals.append('(' + ', '.join([sq(c['id']), sq(c['uid']), str(c['sp']), str(c['mm']), ts(c['captured']), ts(c['received']), sq(c['path']), sq(c['status']),
        sq(c.get('reason')), sq(c['bait']), sq(c['notes']), str(c['weight']) if c['weight'] else 'null', str(c['clock']),
        sq(json.dumps(c['weather'])), f"{c['lat']:.5f}", f"{c['lng']:.5f}"]) + ')')
plan = 'with plan(id, uid, sp, mm, captured, received, path, status, reason, bait, notes, weight, clock, weather, lat, lng) as (values\n' + ',\n'.join(vals) + ')'
json.dump(dict(plan=plan), open(OUT + 'plan.json', 'w'), ensure_ascii=False)
open(OUT + 'plan.sql', 'w').write(plan)

print('users', len(users), 'catches', len(catches), 'batches', len(batches))
print('species', {k: sum(1 for c in catches if c['sp'] == k) for k in (1, 2, 3)})
print('status', {k: sum(1 for c in catches if c['status'] == k) for k in ('approved', 'pending', 'rejected')})
print('per user', sorted(counts.values(), reverse=True))
print('first', min(c['captured'] for c in catches), 'last', max(c['captured'] for c in catches))
print('max uses', max(len(b) for b in batches))

# ---------- 1b. Glaustas variantas ----------
rows = ',\n'.join(f"({u['i']}, {sq(u['nick'])}, {sq(u['region'])}, {ts(u['created'])}::timestamptz, {ts(u['joined'])}::timestamptz, {'2' if u['div'] == DIV_V else '1'})" for u in users)
c = f"""begin;
create temp table du on commit drop as select ('de30' || lpad(i::text, 4, '0') || '-0000-4000-8000-00000000de30')::uuid id, i, nick, region, created, joined, div
  from (values
{rows}) v(i, nick, region, created, joined, div);
insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
select '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', 'demo' || lpad(i::text, 2, '0') || '@demo.invalid', '',
       '{{"provider":"email","providers":["email"]}}', '{{"demo":true}}', created, created, false, false from du;
update public.profiles p set nickname = du.nick, region = du.region, is_demo = true, created_at = du.created from du where p.id = du.id;
""" + '\n'.join(l for l in s if l.startswith('insert into public.tournament')) .replace(';\ninsert', ';\ninsert') + f"""
insert into public.entries (tournament_id, user_id, joined_at, division_id)
select {sq(TID)}, id, joined, case div when 2 then {sq(DIV_V)}::uuid else {sq(DIV_K)}::uuid end from du;
commit;
select (select count(*) from public.profiles where is_demo) demo_users, (select count(*) from public.entries where tournament_id = {sq(TID)}) entries;"""
open(OUT + 'seed1c.sql', 'w').write(c)
