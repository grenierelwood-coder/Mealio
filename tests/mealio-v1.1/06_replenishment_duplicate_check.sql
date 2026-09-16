-- Contrôles lecture seule pour les doublons de suggestions/règles.
-- À exécuter uniquement si vous souhaitez compléter la campagne 6 côté DB.

select ingredient_id, count(*) as nb
from stock_replenishment_thresholds
group by ingredient_id
having count(*) > 1;

select user_id, ingredient_id, count(*) as nb
from recurring_purchase_rules
where active = true
group by user_id, ingredient_id
having count(*) > 1;
