# Demonstracinis turnyras partneriams

„DEMO · Rudens lydekų ir ešerių taurė“ (id `de300000-0000-4000-8000-00000000d001`, privatus, kvietimo kodas – lentelėje `tournaments`).

- 29 pavyzdiniai žvejai: `auth.users` su `demoNN@demo.invalid` (prisijungti neįmanoma), `profiles.is_demo = true`,
  ID `de30NNNN-0000-4000-8000-00000000de30`. Statistikoje (`admin_stats`) jie neskaičiuojami.
- 82 laimikiai (ID `de300000-0000-4000-9000-…`), iš jų 3 Ecimo (`demo-080..082.jpg`), 3 laukia patvirtinimo, 1 atmestas.
- Nuotraukos – Wikimedia Commons (laisvos licencijos), įkeltos per `functions/demo-seed` su variantais
  (veidrodis / apkarpymas); autoriai – `demo-nuotraukos.html`.
- `generate.py` sugeneruoja tuos pačius duomenis (SQL ir įkėlimo paketus) – `random.seed` pastovus.

## Kaip pašalinti (paleisti Supabase SQL redaktoriuje)

```sql
begin;
delete from public.tournaments where id = 'de300000-0000-4000-8000-00000000d001';
delete from public.catches where user_id = 'fd96f036-0d90-48d8-89eb-b5e7685c9b83' and photo_path like '%/demo-%';
delete from auth.users where id in (select id from public.profiles where is_demo);
commit;
```

Po to nuotraukas saugykloje ištrina `demo-seed` veiksmas `cleanup` (žvejų aplankai) – Ecimo trys `demo-08x.jpg` lieka, jei jų neištrinsi rankiniu būdu.
