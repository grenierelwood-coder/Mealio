-- SUPABASE MEALIO uniquement. Après les migrations 1.2.12.
-- Moyennes choisies avec l'utilisateur, non des mesures certifiées.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('mealio-v1220'));
CREATE TEMP TABLE v1220_masses(nom text,unite text,grams numeric,note text) ON COMMIT DROP;
INSERT INTO v1220_masses VALUES
('Figue','Pot 250mL',130,'Figues entières/demi-fruits : moyenne initiale 130 g net, hors liquide.'),
('Figue','Sachet',130,'Hypothèse : un sachet équivaut ici à 250 ml de figues. Adapter si nécessaire.'),
('Pomme','Pot 250mL',150,'Pommes en morceaux/quartiers, hors liquide. Ne convient pas à la compote.'),
('Pomme','Pot de 350mL',210,'Pommes en morceaux/quartiers, hors liquide. Ne convient pas à la compote.'),
('Pomme','Pot 350mL',210,'Alias de format : pommes en morceaux/quartiers, hors liquide.'),
('Pomme','Pot 750mL',450,'Pommes en morceaux/quartiers, hors liquide.'),
('Pomme','Pot 1L',600,'Pommes en morceaux/quartiers, hors liquide.'),
('Pomme','Pot 1,5L',900,'Pommes en morceaux/quartiers, hors liquide.'),
('Poire','Pot 250mL',145,'Poires morceaux/demi-fruits, hors liquide.'),
('Pêche','Pot 250mL',145,'Pêches morceaux/demi-fruits, hors liquide.');
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM v1220_masses m WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients i WHERE i.nom=m.nom)) THEN
  RAISE EXCEPTION 'Référentiel incomplet : Figue, Pomme, Poire ou Pêche absent. Vérifier Admin avant de relancer.';
 END IF;
END $$;
-- Un pot est une unité de conditionnement, pas un volume de fruits pleins.
INSERT INTO public.unit_mappings(unite,abreviation,type_unite,multiplicateur)
SELECT DISTINCT m.unite,NULL,'divers',1 FROM v1220_masses m
WHERE NOT EXISTS(SELECT 1 FROM public.unit_mappings u WHERE u.unite=m.unite);
INSERT INTO public.ingredient_densities(ingredient_id,unite,poids_g_approx,source_note)
SELECT i.id,m.unite,m.grams,'Mealio 1.2.20 : '||m.note FROM v1220_masses m JOIN public.official_ingredients i ON i.nom=m.nom
ON CONFLICT(ingredient_id,unite) DO UPDATE SET poids_g_approx=EXCLUDED.poids_g_approx,source_note=EXCLUDED.source_note;

-- Même contexte sémantique : réafficher une proposition en attente ou AUCUN sans Claude.
CREATE TABLE IF NOT EXISTS public.matcher_stock_analysis_cache(
 case_key text PRIMARY KEY,
 matched_label text,
 matched_source text,
 confidence numeric NOT NULL CHECK(confidence>=0 AND confidence<=1),
 reason text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.matcher_stock_analysis_cache ENABLE ROW LEVEL SECURITY;

-- Une composition par recette de base ; la quantité de mayonnaise est remplacée,
-- pas convertie en oeufs. Le nombre de portions applique ensuite son facteur.
CREATE TABLE IF NOT EXISTS public.household_ingredient_preparations(
 user_id text NOT NULL CHECK(length(trim(user_id))>0),
 ingredient_id uuid NOT NULL REFERENCES public.official_ingredients(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT true,
 components jsonb NOT NULL CHECK(jsonb_typeof(components)='array' AND jsonb_array_length(components)>0),
 PRIMARY KEY(user_id,ingredient_id)
);
ALTER TABLE public.household_ingredient_preparations ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Mayonnaise') THEN RAISE EXCEPTION 'Ingrédient Mayonnaise absent.'; END IF;
 IF EXISTS(SELECT name FROM jsonb_to_recordset('[{"name":"Œuf (poule)"},{"name":"Huile d''olive"},{"name":"Sel fin"},{"name":"Poivre noir"}]'::jsonb) AS c(name text)
   WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients i WHERE i.nom=c.name)) THEN RAISE EXCEPTION 'Composant absent : Œuf (poule), Huile d''olive, Sel fin ou Poivre noir.'; END IF;
END $$;
INSERT INTO public.household_ingredient_preparations(user_id,ingredient_id,enabled,components)
SELECT 'KH',id,true,'[{"name":"Œuf (poule)","qty":1,"unit":"Pièce"},{"name":"Huile d''olive","qty":0,"unit":"Millilitre"},{"name":"Sel fin","qty":0,"unit":"Gramme"},{"name":"Poivre noir","qty":0,"unit":"Gramme"}]'::jsonb
FROM public.official_ingredients WHERE nom='Mayonnaise'
ON CONFLICT(user_id,ingredient_id) DO NOTHING;
-- Le besoin de ces trois composants est une présence O/N pour KH.
INSERT INTO public.household_pantry_products(user_id,ingredient_id,default_quantity,default_unit,enabled)
SELECT 'KH',i.id,coalesce(p.default_quantity,CASE WHEN i.nom='Huile d''olive' THEN 1000 ELSE 250 END),coalesce(p.default_unit,i.unite_reference),true
FROM public.official_ingredients i LEFT JOIN public.pantry_products p ON p.ingredient_id=i.id
WHERE i.nom IN ('Huile d''olive','Sel fin','Poivre noir')
ON CONFLICT(user_id,ingredient_id) DO UPDATE SET enabled=true;
COMMIT;
-- Contrôle : poids moyens réellement enregistrés.
SELECT i.nom,d.unite,d.poids_g_approx,d.source_note FROM public.ingredient_densities d JOIN public.official_ingredients i ON i.id=d.ingredient_id
WHERE d.source_note LIKE 'Mealio 1.2.20 :%' ORDER BY i.nom,d.unite;
