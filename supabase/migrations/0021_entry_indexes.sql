-- Indeksai naujiems ryšiams (Supabase patarimas): klubo ir diviziono trynimas neperžiūri visos entries lentelės.
create index if not exists entries_club_idx on public.entries (club_id) where club_id is not null;
create index if not exists entries_division_idx on public.entries (division_id) where division_id is not null;
