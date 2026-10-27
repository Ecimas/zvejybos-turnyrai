-- Našumas: auth.uid() ir is_admin() vertinami vieną kartą užklausai, ne kiekvienai eilutei
-- ((select ...) forma), indeksai užsienio raktams. Taisyklės keičiamos vietoje (ALTER POLICY),
-- nieko netrinant. Logika nesikeičia, išskyrus: turnyro rūšis galima priskirti iškart po sukūrimo.

create index if not exists catches_reviewed_by_idx on public.catches (reviewed_by);
create index if not exists catches_species_idx on public.catches (species_id);
create index if not exists entries_user_idx on public.entries (user_id);
create index if not exists tournament_species_species_idx on public.tournament_species (species_id);
create index if not exists tournaments_organizer_idx on public.tournaments (organizer_id);

alter policy profiles_update on public.profiles
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter policy tournaments_select on public.tournaments using (
  visibility = 'public'
  or organizer_id = (select auth.uid())
  or exists (select 1 from public.entries e where e.tournament_id = id and e.user_id = (select auth.uid()))
);
alter policy tournaments_insert on public.tournaments
  with check (organizer_id = (select auth.uid()));
alter policy tournaments_update on public.tournaments
  using (organizer_id = (select auth.uid()) and now() < starts_at)
  with check (organizer_id = (select auth.uid()));
alter policy tournaments_delete on public.tournaments
  using (organizer_id = (select auth.uid()) and now() < starts_at);

alter policy tournament_species_write on public.tournament_species
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id and t.organizer_id = (select auth.uid())
                    and (now() < t.starts_at or t.created_at > now() - interval '10 minutes')))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id and t.organizer_id = (select auth.uid())
                         and (now() < t.starts_at or t.created_at > now() - interval '10 minutes')));

alter policy entries_insert on public.entries
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.tournaments t
                 where t.id = tournament_id and now() < t.ends_at
                   and (t.visibility = 'public' or t.organizer_id = (select auth.uid())))
  );
alter policy entries_delete on public.entries
  using (user_id = (select auth.uid())
         and exists (select 1 from public.tournaments t where t.id = tournament_id and now() < t.starts_at));

alter policy catches_select on public.catches using (
  user_id = (select auth.uid()) or status = 'approved' or (select public.is_admin())
);
alter policy catches_insert on public.catches
  with check (user_id = (select auth.uid()));

alter policy catch_locations_select on public.catch_locations using (
  (select public.is_admin())
  or exists (select 1 from public.catches c where c.id = catch_id and c.user_id = (select auth.uid()))
);
alter policy catch_locations_insert on public.catch_locations
  with check (exists (select 1 from public.catches c where c.id = catch_id and c.user_id = (select auth.uid())));

alter policy catch_photos_insert on storage.objects
  with check (
    bucket_id = 'catch-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
alter policy catch_photos_select on storage.objects
  using (
    bucket_id = 'catch-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
      or exists (select 1 from public.catches c
                  where c.photo_path = storage.objects.name and c.status = 'approved')
    )
  );
