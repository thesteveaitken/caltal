-- =========================================================
-- CalTal — fluid and alcohol values for standard foods
-- Run AFTER schema.sql (needs the foods.alcohol and foods.fluid_ml columns)
-- and after seed_foods.sql. Safe to re-run.
--
-- fluid_ml = millilitres of fluid per serving. Alcoholic drinks stay at 0.
-- alcohol  = standard drinks per serving (1 = 14g of pure alcohol, US).
-- Values are approximate. REVIEW BEFORE RUNNING — edit freely.
-- Only standard foods (owner_id is null) are touched; your own foods are not.
-- =========================================================

update public.foods f
set fluid_ml = v.fluid_ml, alcohol = v.alcohol
from (values
  -- name,                              fluid_ml, alcohol
  ('1 cup black coffee',                    240, 0),
  ('1 cup unsweetened tea',                 240, 0),
  ('12oz latte (2% milk)',                  355, 0),
  ('1 cup orange juice',                    240, 0),
  ('1 cup apple juice',                     240, 0),
  ('12oz can cola',                         355, 0),
  ('20oz sports drink',                     591, 0),
  ('1 cup whole milk',                      240, 0),
  ('1 cup 2% milk',                         240, 0),
  ('1 cup skim milk',                       240, 0),
  ('1 cup unsweetened almond milk',         240, 0),
  ('1 cup oat milk',                        240, 0),
  ('12oz non-alcoholic beer',               355, 0),
  -- alcohol: no fluid credit
  ('12oz beer',                               0, 1.0),
  ('12oz light beer',                         0, 0.8),
  ('16oz tall can beer',                      0, 1.3),
  ('5oz glass red wine',                      0, 1.0),
  ('5oz glass white wine',                    0, 1.0),
  ('1.5oz shot of spirits',                   0, 1.0)
) as v(name, fluid_ml, alcohol)
where f.owner_id is null and f.name = v.name;

-- Plain water (0 calories). Skipped if a standard food with that name exists.
insert into public.foods (owner_id, name, calories, protein, carbs, fat, fluid_ml)
select null, v.name, 0, 0, 0, 0, v.fluid_ml
from (values
  ('Water (250 ml)', 250),
  ('Water (500 ml)', 500)
) as v(name, fluid_ml)
where not exists (
  select 1 from public.foods f where f.owner_id is null and lower(f.name) = lower(v.name)
);
