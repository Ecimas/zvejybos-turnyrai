-- Rėmėjų matomumas: logotipai, generalinis rėmėjas, trumpas pasiūlymas ir statistika rėmėjui.
--  * Logotipai – vieša saugykla sponsor-logos/<turnyro id>/<failas>.webp|png|jpg (iki 300 KB, programėlė sumažina).
--  * Rėmėjus organizatorius gali tvarkyti bet kada (ir vykstant turnyrui) – tai ne taisyklės.
--  * Statistika: kiek įrenginių per dieną matė logotipą ir kiek kartų paspaudė nuorodą. Rodoma tik organizatoriui
--    ir administratoriui, kad galėtų atsiskaityti rėmėjui. Skaičiai apytiksliai (skaičiuoja programėlė).
-- Reikalauja 0026 (has_perm('tournaments')).

alter table public.tournament_sponsors
  add column if not exists logo_path text,
  add column if not exists tier      text not null default 'partner',
  add column if not exists blurb     text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tournament_sponsors_logo_path_check') then
    alter table public.tournament_sponsors add constraint tournament_sponsors_logo_path_check
      check (logo_path is null or (logo_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(webp|png|jpg)$'
                                   and split_part(logo_path, '/', 1) = tournament_id::text));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tournament_sponsors_tier_check') then
    alter table public.tournament_sponsors add constraint tournament_sponsors_tier_check check (tier in ('main', 'partner'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tournament_sponsors_blurb_check') then
    alter table public.tournament_sponsors add constraint tournament_sponsors_blurb_check check (blurb is null or char_length(blurb) <= 140);
  end if;
end $$;
-- Generalinis rėmėjas – vienas turnyrui.
create unique index if not exists tournament_sponsors_main_uniq on public.tournament_sponsors (tournament_id) where tier = 'main';

-- Organizatorius tvarko rėmėjus bet kada; administratorius – taip pat.
alter policy tournament_sponsors_write on public.tournament_sponsors
  using (exists (select 1 from public.tournaments t
                  where t.id = tournament_id
                    and (t.organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')))))
  with check (exists (select 1 from public.tournaments t
                       where t.id = tournament_id
                         and (t.organizer_id = (select auth.uid()) or (select public.has_perm('tournaments')))));

-- Logotipų saugykla: skaityti gali visi (viešos nuorodos), rašyti – turnyro organizatorius ar administratorius.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sponsor-logos', 'sponsor-logos', true, 307200, array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_manage_sponsor_logo(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_name ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]{1,64}\.(webp|png|jpg)$'
     and exists (select 1 from public.tournaments t
                  where t.id::text = split_part(p_name, '/', 1)
                    and (t.organizer_id = auth.uid() or public.has_perm('tournaments')));
$$;
revoke all on function public.can_manage_sponsor_logo(text) from public, anon;
grant execute on function public.can_manage_sponsor_logo(text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sponsor_logos_insert') then
    create policy sponsor_logos_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'sponsor-logos' and public.can_manage_sponsor_logo(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sponsor_logos_select') then
    create policy sponsor_logos_select on storage.objects for select
      using (bucket_id = 'sponsor-logos');
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sponsor_logos_update') then
    create policy sponsor_logos_update on storage.objects for update to authenticated
      using (bucket_id = 'sponsor-logos' and public.can_manage_sponsor_logo(name))
      with check (bucket_id = 'sponsor-logos' and public.can_manage_sponsor_logo(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sponsor_logos_remove') then
    create policy sponsor_logos_remove on storage.objects for delete to authenticated
      using (bucket_id = 'sponsor-logos' and public.can_manage_sponsor_logo(name));
  end if;
end $$;

-- Statistika: viena eilutė rėmėjui per dieną.
create table if not exists public.sponsor_stats (
  sponsor_id uuid not null references public.tournament_sponsors (id) on delete cascade,
  day        date not null,
  views      integer not null default 0 check (views >= 0),
  clicks     integer not null default 0 check (clicks >= 0),
  primary key (sponsor_id, day)
);
alter table public.sponsor_stats enable row level security;
revoke all on public.sponsor_stats from anon, authenticated;

-- Programėlė praneša: logotipas parodytas (vienam įrenginiui – kartą per dieną) arba paspausta nuoroda.
create or replace function public.sponsor_track(p_ids uuid[], p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Europe/Vilnius')::date;
  v_ids uuid[];
begin
  if p_kind not in ('view', 'click') or p_ids is null then
    return;
  end if;
  select array_agg(distinct x) into v_ids
    from (select unnest(p_ids) x limit case when p_kind = 'click' then 1 else 20 end) s;
  insert into public.sponsor_stats (sponsor_id, day, views, clicks)
  select s.id, v_day, case when p_kind = 'view' then 1 else 0 end, case when p_kind = 'click' then 1 else 0 end
    from public.tournament_sponsors s
   where s.id = any (v_ids)
  on conflict (sponsor_id, day) do update
    set views  = least(public.sponsor_stats.views + excluded.views, 1000000),
        clicks = least(public.sponsor_stats.clicks + excluded.clicks, 1000000);
end;
$$;
revoke all on function public.sponsor_track(uuid[], text) from public;
grant execute on function public.sponsor_track(uuid[], text) to anon, authenticated;

-- Ataskaita rėmėjams: turnyro aprėptis ir kiekvieno rėmėjo parodymai bei paspaudimai.
create or replace function public.sponsor_report(p_tournament uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t record;
begin
  select * into t from public.tournaments where id = p_tournament;
  if not found or not (t.organizer_id = auth.uid() or public.has_perm('tournaments')) then
    raise exception 'not allowed';
  end if;
  return jsonb_build_object(
    'participants', (select count(*) from public.entries where tournament_id = t.id),
    'catches', (select count(*) from public.catches c join public.entries e on e.user_id = c.user_id and e.tournament_id = t.id
                 where c.status = 'approved' and c.captured_at_device >= t.starts_at and c.captured_at_device < t.ends_at),
    'sponsors', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.name, 'tier', s.tier,
               'views', coalesce((select sum(views) from public.sponsor_stats x where x.sponsor_id = s.id), 0),
               'clicks', coalesce((select sum(clicks) from public.sponsor_stats x where x.sponsor_id = s.id), 0),
               'views_7d', coalesce((select sum(views) from public.sponsor_stats x where x.sponsor_id = s.id
                                      and x.day > (now() at time zone 'Europe/Vilnius')::date - 7), 0),
               'clicks_7d', coalesce((select sum(clicks) from public.sponsor_stats x where x.sponsor_id = s.id
                                       and x.day > (now() at time zone 'Europe/Vilnius')::date - 7), 0))
             order by (s.tier = 'main') desc, s.sort)
        from public.tournament_sponsors s where s.tournament_id = t.id), '[]'::jsonb));
end;
$$;
revoke all on function public.sponsor_report(uuid) from public, anon;
grant execute on function public.sponsor_report(uuid) to authenticated;

notify pgrst, 'reload schema';
