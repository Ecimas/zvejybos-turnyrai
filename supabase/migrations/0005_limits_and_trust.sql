-- Apsauga nuo piktnaudžiavimo ir automatinis patikimumo reitingas.
--   * ne daugiau kaip 50 laimikių per parą vienam žmogui (saugyklos užtvindymas, šlamštas);
--   * ne daugiau kaip 10 naujų turnyrų per parą vienam žmogui;
--   * patvirtintas laimikis: patikimumas +1, atmestas: −5 (0–100).
-- Visi pakeitimai – create or replace / nauji objektai, nieko netrinama.

create index if not exists catches_user_received_idx on public.catches (user_id, received_at desc);

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
  if new.photo_path is null or split_part(new.photo_path, '/', 1) <> auth.uid()::text then
    raise exception 'photo_path must be inside the uploader''s own folder';
  end if;
  if (select count(*) from public.catches c
       where c.user_id = new.user_id and c.received_at > now() - interval '24 hours') >= 50 then
    raise exception 'catch_limit' using hint = 'Ne daugiau kaip 50 laimikių per parą';
  end if;
  return new;
end;
$$;

create or replace function public.tournaments_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (select count(*) from public.tournaments t
       where t.organizer_id = new.organizer_id and t.created_at > now() - interval '24 hours') >= 10 then
    raise exception 'tournament_limit' using hint = 'Ne daugiau kaip 10 turnyrų per parą';
  end if;
  new.created_at := now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tournaments_before_insert') then
    create trigger tournaments_before_insert
      before insert on public.tournaments
      for each row execute function public.tournaments_before_insert();
  end if;
end;
$$;

create or replace function public.review_catch(p_catch_id uuid, p_approve boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_prev  text;
begin
  if not public.is_admin() then
    raise exception 'not allowed';
  end if;
  if not p_approve and coalesce(trim(p_reason), '') = '' then
    raise exception 'reject reason is required';
  end if;
  select user_id, status into v_owner, v_prev from public.catches where id = p_catch_id for update;
  if not found then
    raise exception 'catch not found';
  end if;
  update public.catches
     set status        = case when p_approve then 'approved' else 'rejected' end,
         reject_reason = case when p_approve then null else trim(p_reason) end,
         reviewed_by   = auth.uid(),
         reviewed_at   = now()
   where id = p_catch_id;
  -- Reitingas keičiamas tik pirmą kartą peržiūrint (ne kiekvieną kartą perpatvirtinant).
  if v_prev = 'pending' then
    update public.profiles
       set trust_score = case when p_approve then least(100, trust_score + 1)
                              else greatest(0, trust_score - 5) end
     where id = v_owner;
  end if;
end;
$$;

-- Sukūrimo laiko ir organizatoriaus pakeisti negalima (nuo jų priklauso limitai ir teisės).
create or replace function public.tournaments_before_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_at   := old.created_at;
  new.organizer_id := old.organizer_id;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'tournaments_before_update') then
    create trigger tournaments_before_update
      before update on public.tournaments
      for each row execute function public.tournaments_before_update();
  end if;
end;
$$;

revoke all on function public.tournaments_before_insert() from public, anon;
revoke all on function public.tournaments_before_update() from public, anon;
