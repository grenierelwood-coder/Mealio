-- SUPABASE MEALIO : après 1.2.5, avant le code 1.2.6.
-- user_id est le nom du foyer partagé avec Frosti/Cellio, pas leur UUID.
BEGIN;
CREATE TABLE IF NOT EXISTS public.household_pantry_products (
  user_id text NOT NULL CHECK (length(trim(user_id)) > 0),
  ingredient_id uuid NOT NULL REFERENCES public.official_ingredients(id) ON DELETE CASCADE,
  default_quantity numeric NOT NULL CHECK (default_quantity > 0 AND default_quantity::text NOT IN ('NaN','Infinity','-Infinity')),
  default_unit text NOT NULL CHECK (length(trim(default_unit)) > 0),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ingredient_id)
);
ALTER TABLE public.household_pantry_products ENABLE ROW LEVEL SECURITY;
-- Accès uniquement par les routes serveur authentifiées, filtrées sur le foyer.
-- Figer les réglages actuels pour les foyers déjà connus, sans écraser les choix privés.
WITH households AS (
  SELECT user_id::text FROM public.shopping_lists
  UNION SELECT user_id::text FROM public.recurring_purchase_rules
  UNION SELECT user_id::text FROM public.stock_replenishment_thresholds
  UNION SELECT user_id::text FROM public.favorite_preferences
)
INSERT INTO public.household_pantry_products (user_id, ingredient_id, default_quantity, default_unit, enabled)
SELECT h.user_id, p.ingredient_id, p.default_quantity, p.default_unit, p.enabled
FROM households h CROSS JOIN public.pantry_products p
WHERE h.user_id IS NOT NULL AND length(trim(h.user_id)) > 0
ON CONFLICT (user_id, ingredient_id) DO NOTHING;
-- pantry_products devient le modèle initial. L'interface écrit uniquement dans la table privée.
COMMIT;
