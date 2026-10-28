-- Demonstraciniai (pavyzdiniai) žvejai partnerių pristatymui: pažymimi, kad nepatektų į statistiką
-- ir kad juos visus būtų galima lengvai rasti ir ištrinti.
alter table public.profiles add column if not exists is_demo boolean not null default false;

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today timestamptz := (date_trunc('day', now() at time zone 'Europe/Vilnius')) at time zone 'Europe/Vilnius';
  r jsonb;
begin
  if not public.has_perm('roles') then
    raise exception 'not allowed';
  end if;
  select jsonb_build_object(
    'users',        (select count(*) from public.profiles where not is_demo),
    'demo_users',   (select count(*) from public.profiles where is_demo),
    'new_today',    (select count(*) from public.profiles where created_at >= v_today and not is_demo),
    'new_7d',       (select count(*) from public.profiles where created_at >= now() - interval '7 days' and not is_demo),
    'new_30d',      (select count(*) from public.profiles where created_at >= now() - interval '30 days' and not is_demo),
    'online_now',   (select count(*) from public.user_presence where last_seen_at >= now() - interval '5 minutes'),
    'active_today', (select count(*) from public.user_presence where last_seen_at >= v_today),
    'active_7d',    (select count(*) from public.user_presence where last_seen_at >= now() - interval '7 days'),
    'active_30d',   (select count(*) from public.user_presence where last_seen_at >= now() - interval '30 days'),
    'catches_today', (select count(*) from public.catches where received_at >= v_today),
    'pending',      (select count(*) from public.catches where status = 'pending'),
    'live_tournaments', (select count(*) from public.tournaments where now() >= starts_at and now() < ends_at),
    'signups', coalesce((
      select jsonb_agg(jsonb_build_object('day', d::date, 'count', (
               select count(*) from public.profiles p
                where not p.is_demo and (p.created_at at time zone 'Europe/Vilnius')::date = d::date)) order by d)
        from generate_series((now() at time zone 'Europe/Vilnius')::date - 29, (now() at time zone 'Europe/Vilnius')::date, interval '1 day') d), '[]'::jsonb),
    'models', coalesce((
      select jsonb_agg(x order by (x->>'users')::int desc, x->>'model')
        from (select jsonb_build_object('model', model, 'platform', platform, 'users', count(distinct user_id)) as x
                from public.user_devices where last_seen >= now() - interval '90 days'
               group by model, platform
               order by count(distinct user_id) desc, model
               limit 20) m), '[]'::jsonb),
    'platforms', coalesce((
      select jsonb_agg(jsonb_build_object('platform', platform, 'users', n) order by n desc)
        from (select platform, count(distinct user_id) as n from public.user_devices
               where last_seen >= now() - interval '90 days' group by platform) p), '[]'::jsonb),
    'browsers', coalesce((
      select jsonb_agg(jsonb_build_object('browser', browser, 'users', n) order by n desc)
        from (select browser, count(distinct user_id) as n from public.user_devices
               where last_seen >= now() - interval '90 days' group by browser) b), '[]'::jsonb),
    'installed', (select count(distinct user_id) from public.user_devices where installed and last_seen >= now() - interval '90 days'),
    'with_device', (select count(distinct user_id) from public.user_devices where last_seen >= now() - interval '90 days')
  ) into r;
  return r;
end;
$$;


notify pgrst, 'reload schema';
