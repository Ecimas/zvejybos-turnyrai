-- BŪSENA: produkcijoje dar neįdiegta (Supabase patvirtinimas atšauktas). Programėlė veikia ir be jos.
-- Našumas: auth.uid() ir is_admin() vertinami vieną kartą užklausai, ne kiekvienai eilutei
-- ((select ...) forma), indeksai užsienio raktams. Logika nesikeičia.

create index if not exists catches_reviewed_by_idx on public.catches (reviewed_by);
create index if not exists catches_species_idx on public.catches (species_id);
create index if not exists entries_user_idx on public.entries (user_id);
create index if not exists tournament_species_species_idx on public.tournament_species (species_id);
create index if not exists tournaments_organizer_idx on public.tournaments (organizer_id);

drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy tournaments_select on public.tournaments;
create policy tournaments_select on public.tournaments for select using (
  visibility = 'public'
  or organizer_id = (select auth.uid())
  or exists (select 1 from public.entries e where e.tournament_id = id and e.user_id = (select auth.uid()))
);
drop policy tournaments_insert on public.tournaments;
create policy tournaments_insert on public.tournaments for insert to authenticated
  with check (organizer_id = (select auth.uid()));
drop policy tournaments_update on public.tournaments;
create policy tournaments_update on public.tournaments for update to authenticated
  using (organizer_id = (select auth.uid()) and now() < starts_at)
  with check (organizer_id = (select auth.uid()));
drop policy tournaments_delete on public.tournaments;
create policy tournaments_delete on public.tournaments for delete to authenticated
  using (organizer_id = (select auth.uid()) and now() < starts_at);

-- „for all“ suskaidyta, kad SELECT turėtų tik vieną taisyklę.
drop policy tournament_species_write on public.tournament_species;
create policy tournament_species_insert on public.tournament_species for insert to authenticated
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id and t.organizer_id = (select auth.uid())
                         -- iki starto arba iškart po sukūrimo (jei pradžia „dabar“)
                         and (now() < t.starts_at or t.created_at > now() - interval '10 minutes')));
create policy tournament_species_delete on public.tournament_species for delete to authenticated
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id and t.organizer_id = (select auth.uid()) and now() < t.starts_at));

drop policy entries_insert on public.entries;
create policy entries_insert on public.entries for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tournaments t
                 where t.id = tournament_id and now() < t.ends_at
                   and (t.visibility = 'public' or t.organizer_id = (select auth.uid())))
  );
drop policy entries_delete on public.entries;
create policy entries_delete on public.entries for delete to authenticated
  using (user_id = (select auth.uid())
         and exists (select 1 from public.tournaments t where t.id = tournament_id and now() < t.starts_at));

drop policy catches_select on public.catches;
create policy catches_select on public.catches for select using (
  user_id = (select auth.uid()) or status = 'approved' or (select public.is_admin())
);
drop policy catches_insert on public.catches;
create policy catches_insert on public.catches for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy catch_locations_select on public.catch_locations;
create policy catch_locations_select on public.catch_locations for select using (
  (select public.is_admin())
  or exists (select 1 from public.catches c where c.id = catch_id and c.user_id = (select auth.uid()))
);
drop policy catch_locations_insert on public.catch_locations;
create policy catch_locations_insert on public.catch_locations for insert to authenticated
  with check (exists (select 1 from public.catches c where c.id = catch_id and c.user_id = (select auth.uid())));
