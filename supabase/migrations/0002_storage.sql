-- Nuotraukų saugykla.
-- Bucket privatus: nuotraukos rodomos per laikinas (signed) nuorodas.
-- Kelias visada: <vartotojo id>/<laimikio client_id>.jpg

insert into storage.buckets (id, name, public)
values ('catch-photos', 'catch-photos', false)
on conflict (id) do nothing;

-- Įkelti galima tik į savo aplanką.
create policy catch_photos_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'catch-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Matyti: savo nuotraukas, patvirtintų laimikių nuotraukas, o moderatorius – visas.
create policy catch_photos_select on storage.objects for select
  using (
    bucket_id = 'catch-photos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (select 1 from public.catches c
                  where c.photo_path = storage.objects.name and c.status = 'approved')
    )
  );

-- Keisti ar trinti įkeltų nuotraukų negali niekas: tai įrodymas.

-- Tik JPEG iki 5 MB: programėlė siunčia ~0,3–1 MB kadrus.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg']
 where id = 'catch-photos';
