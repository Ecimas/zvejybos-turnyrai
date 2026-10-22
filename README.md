# Žvejybos turnyrai

Nuotolinių žvejybos turnyrų platforma: dalyvis pats renkasi vietą ir laiką, laimikį fiksuoja telefonu, sistema jį patikrina ir įskaito į turnyro lentelę.

## Būsena

1 etapas – kuriama.

- [x] Duomenų bazės schema, teisės (RLS) ir lentelės skaičiavimas
- [x] Schemos testai
- [ ] Programėlė (PWA): prisijungimas, laimikio registracija, turnyrai, lentelė
- [ ] Moderavimo eilė
- [ ] Offline režimas

## Struktūra

```
supabase/migrations/   duomenų bazės schema (taikoma Supabase SQL Editor)
supabase/seed.sql      žuvų rūšių sąrašas
tests/db/              schemos testai su vietiniu Postgres
```

## Saugumo principai

- Laimikio po įkėlimo nekeičia niekas, išskyrus moderatorių per `review_catch()`.
- Statusą, gavimo laiką ir savininką nustato serveris, ne telefonas.
- Tikslios koordinatės laikomos atskiroje lentelėje – mato tik savininkas ir moderatorius.
- Ta pati nuotrauka (pagal SHA-256) negali būti įkelta antrą kartą.
- Pakartotinis siuntimas iš offline eilės nesukuria dublio (`client_id`).
- Lentelė skaičiuojama serveryje; klientas jos pakeisti negali.

## Testai

```
tests/db/run.sh
```

Reikia PostgreSQL 16. Skriptas pats sukuria laikiną duomenų bazę ir ją ištrina.

## Paleidimas (bus papildyta)

1. Susikurti nemokamą projektą [supabase.com](https://supabase.com).
2. SQL Editor: paeiliui paleisti `0001_init.sql`, `0002_storage.sql`, `seed.sql`.
3. Savo profiliui įjungti moderatoriaus teises:
   `update profiles set is_admin = true where id = '<tavo vartotojo id>';`
