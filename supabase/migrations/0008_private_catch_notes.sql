-- Masalas ir pastabos – tik savininkui. Patvirtinti laimikiai matomi visiems (RLS leidžia eilutę),
-- todėl stulpelių bait ir notes skaitymą uždarom stulpelių teisėmis, o savininkas juos gauna per my_catch_notes().
-- Nieko netrinama: tik teisių keitimas ir nauja funkcija.

revoke select on public.catches from anon, authenticated;
grant select (id, user_id, client_id, species_id, length_mm, weight_g, weather, captured_at_device, received_at,
              photo_path, photo_sha256, status, reject_reason, reviewed_by, reviewed_at, created_at)
  on public.catches to anon, authenticated;

create or replace function public.my_catch_notes()
returns table (id uuid, bait text, notes text)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.bait, c.notes from public.catches c
   where c.user_id = auth.uid() and (c.bait is not null or c.notes is not null);
$$;
revoke all on function public.my_catch_notes() from public, anon;
grant execute on function public.my_catch_notes() to authenticated;
