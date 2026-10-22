# Žvejybos turnyrai

Nuotolinių žvejybos turnyrų platforma: dalyvis pats renkasi vietą ir laiką, laimikį fiksuoja telefonu, sistema jį patikrina ir įskaito į turnyro lentelę.

Programėlė veikia telefono naršyklėje ir gali būti „įdiegta“ į pradžios ekraną (PWA). Kol neprijungta Supabase, ji veikia **demonstraciniu režimu** su pavyzdiniais duomenimis, saugomais tik tame telefone.

## Kas jau veikia (1 etapas)

- Turnyrų sąrašas: Mano / Vyksta / Artėja / Baigėsi
- Turnyro puslapis, registracija, taisyklės, lyderiai, laikas iki pabaigos
- Laimikio registracija: tik programėlės kamera, vandens ženklas nuotraukoje, GPS, liniuotė ilgiui, rūšis, taisyklių patikra prieš išsaugant
- Offline eilė: laimikis išsaugomas telefone ir išsiunčiamas grįžus ryšiui
- Dienoraštis su laimikių būsenomis (eilėje, tikrinama, patvirtinta, atmesta su priežastimi)
- Gyva lentelė su podiumu ir tavo vieta
- Žvejo profilis, rekordai, sezono grafikas, viešas profilis be vietų
- Turnyro kūrimas (didžiausia žuvis arba kelių ilgių suma)
- Moderavimo eilė: patvirtinti / atmesti su priežastimi, matomi patikros signalai
- Tamsi ir šviesi (lauko) tema, veikia be interneto

## Paleidimas telefonu

### 1. Svetainė (Vercel) – apie 5 min.

1. Atsidaryk [vercel.com](https://vercel.com) ir prisijunk su GitHub.
2. **Add New → Project**, pasirink `zvejybos-turnyrai`, spausk **Import**.
3. **Framework Preset: Other**. Nieko daugiau nekeisk.
4. **Deploy**. Gausi nuorodą, pvz. `zvejybos-turnyrai.vercel.app` – programėlė jau veikia demonstraciniu režimu.

Kiekvienas naujas kodas GitHub'e Vercel'yje atsinaujina automatiškai.

### 2. Duomenų bazė (Supabase) – apie 15 min.

1. [supabase.com](https://supabase.com) → **New project**. Regionas: **Frankfurt (eu-central-1)** – duomenys lieka ES.
2. **SQL Editor** → paeiliui įklijuok ir paleisk (Run):
   `supabase/migrations/0001_init.sql`, `supabase/migrations/0002_storage.sql`, `supabase/seed.sql`.
3. **Authentication → URL Configuration**: Site URL ir Redirect URLs – tavo Vercel nuoroda.
4. **Project Settings → API**: nukopijuok **Project URL** ir **anon public** raktą ir įrašyk į `src/config.js`.
   Anon raktas skirtas naršyklei ir yra saugus viešai. **Niekada** nedėk `service_role` rakto.
5. Prisijunk programėlėje savo el. paštu, tada SQL Editor'iuje padaryk save moderatoriumi:

   ```sql
   update profiles set is_admin = true
   where id = (select id from auth.users where email = 'tavo@pastas.lt');
   ```

### 3. Prieš kviečiant daugiau žmonių

Supabase nemokamas el. pašto siuntimas leidžia tik kelis laiškus per valandą. Prieš kviečiant daugiau nei kelis žmones, prijunk savo SMTP (pvz. Resend, kuris turi nemokamą planą): **Authentication → Emails → SMTP Settings**.

## Saugumas

- Laimikio po įkėlimo nekeičia niekas, išskyrus moderatorių per `review_catch()`.
- Statusą, gavimo laiką ir savininką nustato serveris, ne telefonas.
- Tikslios koordinatės laikomos atskiroje lentelėje – mato tik savininkas ir moderatorius.
- Ta pati nuotrauka (SHA-256) negali būti įkelta antrą kartą; pakartotinis siuntimas iš eilės nesukuria dublio.
- Nuotraukos – privačioje saugykloje, rodomos per laikinas nuorodas; galerijos įkėlimas neleidžiamas.
- Lentelė skaičiuojama serveryje.
- Visas vartotojų tekstas ištrūkinamas (apsauga nuo XSS); griežta Content-Security-Policy (`vercel.json`).

## Struktūra

```
index.html, styles.css, sw.js, manifest.webmanifest   programėlės apvalkalas
src/app.js                                            maršrutai, eilė, navigacija
src/views/                                            ekranai
src/lib/                                              taškai, eilė, kamera, GPS, liniuotė
src/backend/                                          demo režimas ir Supabase
supabase/                                             duomenų bazės schema ir rūšys
tests/                                                testai
```

Kompiliavimo žingsnio nėra – failai atiduodami tokie, kokie yra.

## Testai

```
node --test tests/unit/*.test.js   # taškų skaičiavimas, eilė, formatavimas, XSS
bash tests/db/run.sh               # schema ir teisės su tikru PostgreSQL 16
python3 tests/e2e/run.py           # visas vartotojo kelias naršyklėje (Playwright)
```
