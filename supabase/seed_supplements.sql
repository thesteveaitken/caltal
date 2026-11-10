-- =========================================================
-- CalTal — standard supplement foods
-- Run AFTER schema.sql (needs foods.creatine_g). Safe to re-run: skips names
-- that already exist as a standard food.
-- =========================================================

insert into public.foods (owner_id, name, calories, protein, carbs, fat, creatine_g)
select null, v.name, 0, 0, 0, 0, v.creatine_g
from (values
  ('Creatine (10 g)', 10),
  ('Creatine (5 g)',   5)
) as v(name, creatine_g)
where not exists (
  select 1 from public.foods f where f.owner_id is null and lower(f.name) = lower(v.name)
);
