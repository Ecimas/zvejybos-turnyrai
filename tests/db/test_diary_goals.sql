-- 0034: išvykų vieta ir dienoraščio tikslai (tik savininkui).
\set ON_ERROR_STOP 1
\set QUIET 1
\echo 'G1. Tikslai ir išvykos vieta'

insert into auth.users (id, email) values
  ('9e000000-0000-4000-8000-00000000009e', 'dg-a@test.lt'),
  ('9f000000-0000-4000-8000-00000000009f', 'dg-b@test.lt');

set role authenticated;
set request.jwt.claim.sub = '9e000000-0000-4000-8000-00000000009e';
insert into public.diary_goals (kind, species_id, target, period) values ('length', 1, 80, 'season');
insert into public.diary_goals (kind, target, period) values ('count', 10, 'month'), ('new_species', 1, 'ever');
insert into public.blank_trips (trip_date, hours, place, notes) values (current_date, 4, 'Kauno marios', 'Kibo ryte');
do $$ begin
  assert (select count(*) from public.diary_goals) = 3, 'tikslai';
  assert (select place from public.blank_trips where notes = 'Kibo ryte') = 'Kauno marios', 'vieta';
  begin
    insert into public.diary_goals (kind, target, period) values ('length', 500, 'season');
    raise exception 'FAIL: 500 cm tikslas';
  exception when check_violation then null;
  end;
  begin
    insert into public.diary_goals (kind, target, period) values ('new_species', 2, 'month');
    raise exception 'FAIL: blogas naujos rūšies tikslas';
  exception when check_violation then null;
  end;
  begin
    insert into public.diary_goals (user_id, kind, target, period) values ('9f000000-0000-4000-8000-00000000009f', 'count', 5, 'month');
    raise exception 'FAIL: user_id įrašytas';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.blank_trips (trip_date, place) values (current_date, '');
    raise exception 'FAIL: tuščia vieta';
  exception when check_violation then null;
  end;
end $$;
-- Riba – 12 tikslų
insert into public.diary_goals (kind, target, period) select 'count', g, 'season' from generate_series(1, 9) g;
do $$ begin
  begin
    insert into public.diary_goals (kind, target, period) values ('count', 99, 'season');
    raise exception 'FAIL: 13-as tikslas';
  exception when raise_exception then
    if sqlerrm not like '%goal_limit%' then raise; end if;
  end;
end $$;

set request.jwt.claim.sub = '9f000000-0000-4000-8000-00000000009f';
do $$ begin
  assert (select count(*) from public.diary_goals) = 0, 'mato svetimus tikslus';
  delete from public.diary_goals;
end $$;
set request.jwt.claim.sub = '9e000000-0000-4000-8000-00000000009e';
do $$ begin
  assert (select count(*) from public.diary_goals) = 12, 'svetimas ištrynė tikslus';
end $$;
delete from public.diary_goals where kind = 'count' and period = 'season';
do $$ begin
  assert (select count(*) from public.diary_goals) = 3, 'ištrynimas';
end $$;
reset role;

\echo 'DIENORAŠČIO TIKSLŲ TESTAI PRAĖJO'
