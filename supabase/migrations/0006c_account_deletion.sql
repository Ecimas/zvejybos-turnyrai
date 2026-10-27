-- BŪSENA: įdiegta produkcijoje 2026-10-27 (savininkas paleido per Supabase SQL redaktorių).

-- ---------------------------------------------------------------
-- Paskyros ištrynimas (BDAR): 1) duomenys, 2) nuotraukos (klientas per Storage API), 3) paskyra
-- ---------------------------------------------------------------
alter table public.profiles add column if not exists deleting_at timestamptz;

create or replace function public.begin_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not allowed';
  end if;
  update public.catches set reviewed_by = null where reviewed_by = v_uid;
  delete from public.tournaments where organizer_id = v_uid;   -- kartu ir jų registracijos bei rūšys
  delete from public.catches where user_id = v_uid;             -- kartu ir vietos bei ginčai
  delete from public.entries where user_id = v_uid;
  update public.profiles set deleting_at = now() where id = v_uid;
end;
$$;

create or replace function public.finish_account_deletion()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and deleting_at is not null) then
    raise exception 'not allowed';
  end if;
  if exists (select 1 from public.catches where user_id = v_uid) then
    raise exception 'not allowed';
  end if;
  delete from auth.users where id = v_uid;                      -- profilis ištrinamas kaskadiškai
end;
$$;

-- Savo nuotraukas galima trinti tik pradėjus paskyros ištrynimą (kai laimikių jau nebėra).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'catch_photos_delete_on_account_deletion') then
    create policy catch_photos_delete_on_account_deletion on storage.objects for delete to authenticated
      using (bucket_id = 'catch-photos'
             and (storage.foldername(name))[1] = (select auth.uid())::text
             and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.deleting_at is not null));
  end if;
end;
$$;

revoke all on function public.begin_account_deletion() from public, anon;
revoke all on function public.finish_account_deletion() from public, anon;
grant execute on function public.begin_account_deletion() to authenticated;
grant execute on function public.finish_account_deletion() to authenticated;
