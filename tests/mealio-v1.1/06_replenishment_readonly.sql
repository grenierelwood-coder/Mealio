-- Contrôles SQL en lecture seule pour la campagne 6.
-- À exécuter dans Supabase SQL Editor.
-- Aucun INSERT / UPDATE / DELETE.

-- 1. Seuils : une ligne par ingrédient et unité de référence.
select
  t.id,
  t.ingredient_id,
  oi.nom,
  t.unite as unite_seuil,
  oi.unite_reference,
  t.min_quantity,
  t.target_quantity,
  t.active,
  t.mode
from stock_replenishment_thresholds t
join official_ingredients oi on oi.id = t.ingredient_id
order by oi.nom;

-- 2. Récurrents liés à un ingrédient officiel.
select
  r.id,
  r.ingredient_id,
  r.produit,
  r.unite,
  oi.unite_reference,
  r.quantity,
  r.interval_days,
  r.next_due_date,
  r.active,
  r.mode
from recurring_purchase_rules r
left join official_ingredients oi on oi.id = r.ingredient_id
where r.ingredient_id is not null
order by r.produit;

-- 3. Vérifie les éventuelles incohérences existantes.
select
  count(*) as nb_seuils_unite_incoherente
from stock_replenishment_thresholds t
join official_ingredients oi on oi.id = t.ingredient_id
where lower(trim(t.unite)) <> lower(trim(oi.unite_reference));

select
  count(*) as nb_recurrents_unite_incoherente
from recurring_purchase_rules r
join official_ingredients oi on oi.id = r.ingredient_id
where lower(trim(r.unite)) <> lower(trim(oi.unite_reference));
