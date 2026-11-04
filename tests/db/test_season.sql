-- 0041: turnyras iki metų.
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'L1. Sezono turnyras: iki 366 dienų'
set role authenticated;
set request.jwt.claim.sub = 'b4100000-0000-4000-8000-0000000000b1';
insert into public.tournaments (organizer_id, title, format, measure, starts_at, ends_at, visibility)
values (auth.uid(), 'Metų karpis sezonas', 'biggest', 'weight', now() + interval '120 days', now() + interval '334 days', 'private');
do $$ begin
  begin
    insert into public.tournaments (organizer_id, title, format, starts_at, ends_at, visibility)
    values (auth.uid(), 'Per ilgas', 'biggest', now() + interval '1 day', now() + interval '369 days', 'private');
    raise exception 'FAIL: daugiau nei metai';
  exception when check_violation then null;
  end;
end $$;
reset role;
\echo '   ok – sezono trukmė'
