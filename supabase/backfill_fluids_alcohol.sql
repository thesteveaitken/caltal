-- =========================================================
-- CalTal — one-off: fluid / alcohol values for your own foods, then
-- copy fluid / alcohol / creatine onto past log entries.
-- Run in the Supabase SQL editor AFTER schema.sql and seed_drinks.sql.
-- Safe to re-run. REVIEW THE VALUES BELOW BEFORE RUNNING — they are estimates.
--
-- fluid_ml = ml per serving (alcoholic drinks stay 0 fluid).
-- alcohol  = US standard drinks per serving (1 = 14 g pure alcohol).
-- Only private foods owned by an admin (you) are touched, matched by exact name.
-- =========================================================

-- 1. Your own foods
update public.foods f
set fluid_ml = v.fluid_ml, alcohol = v.alcohol
from (values
  -- name,                                   fluid_ml, alcohol
  ('Coffee with milk',                          320, 0),
  ('Espresso with sugar',                        30, 0),
  ('12oz non-alcoholic beer',                   355, 0),
  ('Protein shake',                             500, 0),   -- standard shaker bottle filled with water
  ('Beer Bottle (12oz)',                          0, 1.0),
  ('16oz tall can beer',                          0, 1.3),
  ('Glass of Red Wine - Low Sugar (5oz)',         0, 1.0),
  ('Mezcal margarita',                            0, 1.0)  -- 1.5 oz mezcal = 1 standard drink
) as v(name, fluid_ml, alcohol)
where f.owner_id in (select user_id from public.admins)
  and f.name = v.name;

-- 2. Past log entries: copy the food's per-serving values x quantity onto
--    entries that still have zeros (entries you already set are left alone).
--    Covers standard and private foods; entries with no food_id (one-offs)
--    and foods that were deleted are skipped.
update public.log_entries e
set fluid_ml   = case when e.fluid_ml = 0   then f.fluid_ml   * e.quantity else e.fluid_ml   end,
    alcohol    = case when e.alcohol = 0    then f.alcohol    * e.quantity else e.alcohol    end,
    creatine_g = case when e.creatine_g = 0 then f.creatine_g * e.quantity else e.creatine_g end
from public.foods f
where e.food_id = f.id
  and ((e.fluid_ml = 0 and f.fluid_ml > 0)
    or (e.alcohol = 0 and f.alcohol > 0)
    or (e.creatine_g = 0 and f.creatine_g > 0));
