-- Telefono laikrodžio patikra: kiek telefono laikas skyrėsi nuo serverio laiko fotografuojant. (Įdiegta į Supabase 2026-10-28.)
-- Programėlė prieš fotografuodama (kai yra ryšys) pasitikrina serverio laiką ir išsaugo skirtumą sekundėmis.
-- null – nežinoma (fotografuota be ryšio). Moderatoriai mato įspėjimą, jei laikas buvo pakeistas.
alter table public.catches add column if not exists clock_offset_s integer;
alter table public.catches drop constraint if exists catches_clock_offset_s_check;
alter table public.catches add constraint catches_clock_offset_s_check
  check (clock_offset_s is null or clock_offset_s between -31536000 and 31536000);
grant select (clock_offset_s) on public.catches to anon, authenticated;

-- Serverio laikas programėlei (laikrodžio patikrai).
create or replace function public.server_now()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;
revoke all on function public.server_now() from public;
grant execute on function public.server_now() to anon, authenticated;

notify pgrst, 'reload schema';
