-- Tikslios laimikių vietos saugomos tik tiek, kiek reikia patikrai.
-- Ištrinama, kai laimikis senesnis nei 90 d. ir nepriklauso turnyrui,
-- kuris baigėsi mažiau nei prieš 90 d. (taip žadama prisijungimo ekrane).

create or replace function public.purge_old_locations()
returns integer
language sql
security definer
set search_path = public
as $$
  with del as (
    delete from public.catch_locations cl
     using public.catches c
     where c.id = cl.catch_id
       and c.captured_at_device < now() - interval '90 days'
       and not exists (
         select 1
           from public.entries e
           join public.tournaments t on t.id = e.tournament_id
          where e.user_id = c.user_id
            and c.captured_at_device >= t.starts_at
            and c.captured_at_device <  t.ends_at
            and t.ends_at > now() - interval '90 days')
    returning 1
  )
  select count(*)::integer from del;
$$;

revoke all on function public.purge_old_locations() from public, anon, authenticated;

-- Kasdien 03:15 UTC (Supabase: pg_cron). Vietinėje testų bazėje pg_cron nėra – praleidžiama.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('purge-old-locations', '15 3 * * *', 'select public.purge_old_locations()');
  end if;
end;
$$;
