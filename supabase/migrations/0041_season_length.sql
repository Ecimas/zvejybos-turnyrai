-- 0041: sezono turnyrai – turnyras gali trukti iki metų (buvo iki 120 dienų).
-- Pvz. „Metų karpis“ visą karpių sezoną nuo kovo iki rugsėjo.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.tournaments'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%120 days%' loop
    execute format('alter table public.tournaments drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.tournaments drop constraint if exists tournaments_duration_ok;
alter table public.tournaments add constraint tournaments_duration_ok check (ends_at - starts_at <= interval '366 days');

notify pgrst, 'reload schema';
