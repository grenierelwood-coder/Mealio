-- SUPABASE MEALIO uniquement. Après 1.2.21.
BEGIN;
-- KH suit les herbes en présence. Initialiser aussi confiture et vin de cuisine
-- comme condiments en présence pour KH, conformément au suivi simplifié demandé.
-- Utiliser leur identité
-- officielle exacte, tout en conservant les formats d’achat personnalisés.
INSERT INTO public.household_pantry_products(user_id,ingredient_id,default_quantity,default_unit,enabled)
SELECT 'KH',i.id,COALESCE(p.default_quantity,CASE WHEN i.nom='Confiture d''abricot' THEN 350 WHEN i.nom='Vin blanc (cuisine)' THEN 750 ELSE 1 END),COALESCE(p.default_unit,CASE WHEN i.nom='Confiture d''abricot' THEN 'Gramme' WHEN i.nom='Vin blanc (cuisine)' THEN 'Millilitre' ELSE 'Bouquet' END),true
FROM public.official_ingredients i LEFT JOIN public.pantry_products p ON p.ingredient_id=i.id
WHERE i.nom IN ('Persil','Persil plat','Ciboulette','Confiture d''abricot','Vin blanc (cuisine)')
ON CONFLICT(user_id,ingredient_id) DO UPDATE SET enabled=true,updated_at=now();
-- Le format Bouquet est un format d’achat ; aucune conversion vers g n’est nécessaire en présence.
INSERT INTO public.unit_mappings(unite,abreviation,type_unite,multiplicateur)
SELECT 'Bouquet','bouquet','divers',1 WHERE NOT EXISTS(SELECT 1 FROM public.unit_mappings WHERE unite='Bouquet');

CREATE TABLE IF NOT EXISTS public.household_inventory_reminders(
 user_id text NOT NULL,
 source text NOT NULL CHECK(source IN ('frosti','cellio')),
 location_id uuid NOT NULL,
 interval_weeks integer CHECK(interval_weeks BETWEEN 1 AND 104),
 last_completed_at timestamptz,
 configured_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,source,location_id)
);
ALTER TABLE public.household_inventory_reminders ENABLE ROW LEVEL SECURITY;
-- Les UUID de lieux appartiennent aux DB Frosti/Cellio. La route valide leur
-- appartenance au foyer par username avant toute écriture ; pas de FK inter-DB.
CREATE OR REPLACE FUNCTION public.mealio_set_inventory_reminder(
 p_user_id text,p_source text,p_location_id uuid,p_action text,p_interval_weeks integer DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
BEGIN
 IF p_action IS NULL OR p_source IS NULL OR p_action NOT IN ('configure','complete') OR p_source NOT IN ('frosti','cellio') OR p_user_id IS NULL OR length(trim(p_user_id))=0 OR p_location_id IS NULL
 OR (p_action='configure' AND p_interval_weeks IS NOT NULL AND (p_interval_weeks<1 OR p_interval_weeks>104)) THEN RAISE EXCEPTION 'Paramètres de rappel invalides'; END IF;
 INSERT INTO public.household_inventory_reminders(user_id,source,location_id,interval_weeks,last_completed_at,configured_at)
 VALUES(p_user_id,p_source,p_location_id,CASE WHEN p_action='configure' THEN p_interval_weeks END,CASE WHEN p_action='complete' THEN now() END,CASE WHEN p_action='configure' THEN now() END)
 ON CONFLICT(user_id,source,location_id) DO UPDATE SET
 interval_weeks=CASE WHEN p_action='configure' THEN p_interval_weeks ELSE household_inventory_reminders.interval_weeks END,
 last_completed_at=CASE WHEN p_action='complete' THEN now() ELSE household_inventory_reminders.last_completed_at END,
 configured_at=CASE WHEN p_action='configure' THEN now() ELSE household_inventory_reminders.configured_at END,
 updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.mealio_set_inventory_reminder(text,text,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mealio_set_inventory_reminder(text,text,uuid,text,integer) TO service_role;
COMMIT;
-- Diagnostic : mode réellement chargé pour KH (la ligne foyer prévaut).
SELECT i.id,i.nom,CASE WHEN COALESCE(h.enabled,p.enabled,false) THEN 'Présence' ELSE 'Quantitatif' END AS mode_kh,
 h.enabled AS reglage_foyer,p.enabled AS modele_initial,COALESCE(h.default_quantity,p.default_quantity) AS format_quantite,COALESCE(h.default_unit,p.default_unit) AS format_unite
FROM public.official_ingredients i LEFT JOIN public.household_pantry_products h ON h.ingredient_id=i.id AND h.user_id='KH'
LEFT JOIN public.pantry_products p ON p.ingredient_id=i.id
WHERE i.nom IN ('Persil','Persil plat','Ciboulette','Beurre','Confiture d''abricot','Vin blanc (cuisine)') ORDER BY i.nom;
