-- Nuotraukų taupymas: mažos peržiūros kopijos ir WebP formatas.
--  * Laimikio nuotrauka gali būti <uid>/<vardas>.jpg arba .webp (WebP ~2,5 karto lengvesnis,
--    raiška ta pati – 1600 px, liniuotės milimetrai matosi). iPhone naršyklė WebP nesukuria –
--    ten lieka JPEG.
--  * Šalia originalo programėlė įkelia mažą kopiją <uid>/<vardas>.t.<plėtinys> (~400 px, ~15 KB).
--    Ji rodoma sąrašuose; matoma tiems patiems žmonėms kaip ir originalas.
--  * Indeksas catches(photo_path): nuotraukų matomumo taisyklė jį naudoja kiekvienai nuotraukai.
--  * storage_usage(): kiek vietos užima failai (tik savininkui – teisė „roles“).
-- Nieko netrinama.

-- 1. Saugykla priima ir WebP.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/webp']
 where id = 'catch-photos';

-- 2. Laimikio kelias: .jpg arba .webp (be taškų varde – miniatiūra laimikio nuotrauka būti negali).
create or replace function public.catches_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_id       := auth.uid();
  new.status        := 'pending';
  new.reject_reason := null;
  new.reviewed_by   := null;
  new.reviewed_at   := null;
  new.received_at   := now();
  new.created_at    := now();
  if new.photo_path is null
     or new.photo_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]{1,64}\.(jpg|webp)$') then
    raise exception 'photo_path must be inside the uploader''s own folder';
  end if;
  if (select count(*) from public.catches c
       where c.user_id = new.user_id and c.received_at > now() - interval '24 hours') >= 50 then
    raise exception 'catch_limit' using hint = 'Ne daugiau kaip 50 laimikių per parą';
  end if;
  return new;
end;
$$;

-- 3. Greita paieška pagal nuotraukos kelią.
create index if not exists catches_photo_path_idx on public.catches (photo_path);

-- 4. Matomumas: miniatiūra „x.t.webp“ matoma, jei matomas originalas „x.webp“.
alter policy catch_photos_select on storage.objects
  using (
    bucket_id = 'catch-photos'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select public.is_admin())
      or exists (select 1 from public.catches c
                  where c.photo_path = regexp_replace(storage.objects.name, '\.t\.(jpg|webp)$', '.\1')
                    and c.status = 'approved')
    )
  );

-- 5. Kiek vietos užima failai – admin puslapio skaitikliui.
create or replace function public.storage_usage()
returns table (bucket text, files bigint, bytes bigint, thumbs bigint, thumb_bytes bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  return query
    select o.bucket_id::text,
           count(*) filter (where o.name !~ '\.t\.(jpg|webp)$'),
           coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint,
           count(*) filter (where o.name ~ '\.t\.(jpg|webp)$'),
           coalesce(sum((o.metadata->>'size')::bigint) filter (where o.name ~ '\.t\.(jpg|webp)$'), 0)::bigint
      from storage.objects o
     group by o.bucket_id
     order by 3 desc;
end;
$$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated;
