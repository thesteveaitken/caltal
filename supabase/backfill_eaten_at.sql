-- =========================================================
-- CalTal — one-off: fill in eaten_at for older entries
-- Run once in the SQL Editor, after schema.sql. Safe to re-run (only touches nulls).
--
-- Uses created_at (when the entry was logged) as the eaten time, but only when
-- it was logged on the same calendar day (US Eastern) as the entry's date, so
-- back-filled entries don't get a misleading time. Also skips entries stamped
-- exactly 12:00:00, which is the placeholder the sheet import used for rows
-- that had no timestamp.
-- =========================================================

update public.log_entries
set eaten_at = created_at
where eaten_at is null
  and (created_at at time zone 'America/New_York')::date = date
  and (created_at at time zone 'America/New_York')::time <> '12:00:00';

-- Check afterwards: how many entries still have no time?
-- select count(*) filter (where eaten_at is null) as untimed, count(*) as total from public.log_entries;
