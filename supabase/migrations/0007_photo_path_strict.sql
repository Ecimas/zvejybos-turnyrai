-- Rasta RLS fuzz testu: nuotraukos kelias „<mano_id>/../<kito_id>/x.jpg“ buvo priimamas,
-- nes tikrinta tik pirma kelio dalis. Dabar kelias turi būti tiksliai „<mano_id>/<vardas>.jpg“
-- (be poaplankių, be „..“). Tik create or replace – nieko netrinama.

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
     or new.photo_path !~ ('^' || auth.uid()::text || '/[A-Za-z0-9_-]{1,64}\.jpg$') then
    raise exception 'photo_path must be inside the uploader''s own folder';
  end if;
  if (select count(*) from public.catches c
       where c.user_id = new.user_id and c.received_at > now() - interval '24 hours') >= 50 then
    raise exception 'catch_limit' using hint = 'Ne daugiau kaip 50 laimikių per parą';
  end if;
  return new;
end;
$$;
