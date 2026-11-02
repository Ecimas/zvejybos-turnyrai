-- Jungiklis „Turnyrų kūrimas“: išjungus naujus turnyrus (ir klubų) gali kurti tik programėlės savininkas.
-- Esami turnyrai vyksta ir redaguojami kaip anksčiau.
insert into public.app_features (key) values ('tournament_create') on conflict (key) do nothing;

create or replace function public.tournaments_feature_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and not public.feature_on('tournament_create') and not public.has_perm('roles') then
    raise exception 'feature_off';
  end if;
  if new.format = 'duels' and (tg_op = 'INSERT' or old.format is distinct from 'duels') and not public.feature_on('duels') then
    raise exception 'feature_off';
  end if;
  if new.league_id is not null and (tg_op = 'INSERT' or old.league_id is distinct from new.league_id) and not public.feature_on('leagues') then
    raise exception 'feature_off';
  end if;
  return new;
end;
$$;
revoke all on function public.tournaments_feature_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';
