-- 0029 papildymas (Supabase saugumo patarimai): pagalbinės klubų funkcijos – tik prisijungusiems; fiksuotas search_path.
revoke all on function public.is_club_admin(uuid) from public, anon;
revoke all on function public.is_club_member(uuid) from public, anon;
revoke all on function public.shares_club_with(uuid) from public, anon;
grant execute on function public.is_club_admin(uuid) to authenticated;
grant execute on function public.is_club_member(uuid) to authenticated;
grant execute on function public.shares_club_with(uuid) to authenticated;
alter function public.challenge_species(date) set search_path = public;
