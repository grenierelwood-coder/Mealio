-- SUPABASE MEALIO : après 1.2.7. Aucune modification Frosti/Cellio/Cookiwiki.
BEGIN;
CREATE TABLE IF NOT EXISTS public.reference_enrichment_review (
  request_key text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('alias','unit_mass','unit_definition','compound','recipe_quantity')),
  source_label text NOT NULL,
  ingredient_name text,
  unite text,
  value numeric CHECK (value IS NULL OR (value>0 AND value::text NOT IN ('NaN','Infinity','-Infinity'))),
  source_note text,
  measurement_note text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.reference_enrichment_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_densities ADD COLUMN IF NOT EXISTS source_note text;

CREATE TEMP TABLE enrichment_aliases(alias text,ingredient_name text) ON COMMIT DROP;
-- Conservative normalization of the French labels in this export, matching the engine's singularization.
CREATE OR REPLACE FUNCTION pg_temp.mealio_key(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
WITH words AS (
 SELECT word,ord FROM regexp_split_to_table(
   regexp_replace(translate(lower(trim(coalesce(raw,''))),'àâäéèêëîïôöùûüç','aaaeeeeiioouuuc'),'[[:punct:]]',' ','g'),'\s+') WITH ORDINALITY AS t(word,ord)
), singular AS (
 SELECT CASE WHEN length(word)<=3 OR word IN ('riz','mais','pois','jus','os','frais') THEN word
   WHEN word LIKE '%ufs' OR word LIKE '%es' OR (word LIKE '%s' AND word NOT LIKE '%ss' AND length(word)>=5)
   THEN left(word,length(word)-1) ELSE word END AS word,ord FROM words
)
SELECT coalesce(string_agg(word,' ' ORDER BY ord),'') FROM singular
WHERE word<>'' AND word NOT IN ('de','du','des','la','le','les','un','une','et','a','au','aux','en','pour','avec');
$$;

WITH units(unite,abreviation,type_unite,equivalence_reference,multiplicateur) AS (VALUES
  ('Bouteille',NULL,'divers','1 bouteille',1),
  ('Bouquet',NULL,'divers','1 bouquet',1),
  ('Tête',NULL,'divers','1 tête',1),
  ('Grain',NULL,'divers','1 grain',1),
  ('Tour',NULL,'divers','1 tour',1),
  ('Poignée',NULL,'divers','1 poignée',1)
)
INSERT INTO public.unit_mappings(unite,abreviation,type_unite,equivalence_reference,multiplicateur,notes)
SELECT u.unite,u.abreviation,u.type_unite,u.equivalence_reference,u.multiplicateur,
  'Identité de comptage uniquement : aucune masse ni contenance implicite. Campagne Cookiwiki 56 recettes.'
FROM units u WHERE NOT EXISTS(SELECT 1 FROM public.unit_mappings old WHERE pg_temp.mealio_key(old.unite)=pg_temp.mealio_key(u.unite));

INSERT INTO enrichment_aliases VALUES
  ('oeuf','Œuf (poule)'),
  ('oeufs','Œuf (poule)'),
  ('œuf','Œuf (poule)'),
  ('œufs','Œuf (poule)'),
  ('Œufs frais','Œuf (poule)'),
  ('œufs extra-frais','Œuf (poule)'),
  ('œufs frais','Œuf (poule)'),
  ('œufs battus','Œuf (poule)'),
  ('jaunes d''œufs','Jaune d''œuf'),
  ('jaune d''oeuf','Jaune d''œuf'),
  ('jaunes d''oeufs','Jaune d''œuf'),
  ('blancs d''œufs','Blanc d''œuf'),
  ('blanc d''oeuf','Blanc d''œuf'),
  ('blancs d''oeufs','Blanc d''œuf'),
  ('amandes en poudre','Poudre d''amande'),
  ('poudre d''amandes','Poudre d''amande'),
  ('beurre doux','Beurre'),
  ('beurre fondu','Beurre'),
  ('beurre mou','Beurre'),
  ('beurre pommade','Beurre'),
  ('beurre pour le plat','Beurre'),
  ('beurre (pour la mirepoix)','Beurre'),
  ('beurre demi-sel','Beurre demi-sel'),
  ('crème fraîche liquide','Crème liquide'),
  ('crème fraîche épaisse','Crème épaisse'),
  ('figues fraîches','Figue'),
  ('eau froide','Eau'),
  ('eau (pour le caramel)','Eau'),
  ('citrons non traités (jus et zestes)','Citron'),
  ('citrons verts (zeste et jus)','Citron vert'),
  ('jus de citron frais','Jus de citron'),
  ('emmental râpé','Emmental'),
  ('emmenthal râpé','Emmental'),
  ('gruyère râpé','Gruyère'),
  ('fromage gruyère râpé','Gruyère'),
  ('comté râpé','Comté'),
  ('courgettes','Courgette'),
  ('courgettes moyennes','Courgette'),
  ('carottes','Carotte'),
  ('tomates','Tomate'),
  ('tomates bien mûres','Tomate'),
  ('tomates cerises','Tomate cerise'),
  ('échalotes','Échalote'),
  ('poireaux','Poireau'),
  ('navets','Navet'),
  ('gros oignons blancs','Oignon blanc'),
  ('oignons jaunes émincés','Oignon jaune'),
  ('oignons frais','Oignon'),
  ('gros oignon','Oignon'),
  ('poivrons rouges','Poivron rouge'),
  ('pommes de terre','Pomme de terre'),
  ('cuisses de canard confites','Canard (cuisse confite)'),
  ('saumon frais','Saumon'),
  ('graines de sésame','Graine de sésame'),
  ('sucre semoule','Sucre en poudre'),
  ('sucre en poudre (pour la crème)','Sucre en poudre'),
  ('sucre en poudre (pour le sirop)','Sucre en poudre'),
  ('sucre glace (pour le glaçage)','Sucre glace'),
  ('cumin en poudre','Cumin'),
  ('branche de thym','Thym frais'),
  ('branches de thym frais','Thym frais'),
  ('branche de romarin','Romarin frais'),
  ('branche de laurier','Laurier frais'),
  ('feuille de laurier','Laurier frais'),
  ('persil plat frais haché','Persil plat'),
  ('olives noires dénoyautées','Olive noire'),
  ('vin blanc','Vin blanc (cuisine)'),
  ('vin blanc (pour le riz)','Vin blanc (cuisine)'),
  ('vin blanc (pour les champignons)','Vin blanc (cuisine)'),
  ('vin rouge (Mercurey)','Vin rouge (cuisine)'),
  ('vin rouge (type Bourgogne)','Vin rouge (cuisine)'),
  ('bouillon de légumes (cubes)','Bouillon cube (légumes)'),
  ('gousse de vanille','Vanille (gousse)'),
  ('bouquet garni (thym, laurier)','Bouquet garni'),
  ('haricots cocos de Paimpol AOP écossés','Cocos de Paimpol AOP écossés');
-- No conflicting target for a normalized key in this batch.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM enrichment_aliases GROUP BY pg_temp.mealio_key(alias) HAVING count(DISTINCT ingredient_name)>1) THEN
   RAISE EXCEPTION 'Lot de synonymes ambigu';
 END IF;
END $$;

INSERT INTO public.ingredient_synonyms(mot_recette,ingredient_id)
SELECT DISTINCT ON (pg_temp.mealio_key(a.alias)) a.alias,i.id
FROM enrichment_aliases a JOIN public.official_ingredients i ON i.nom=a.ingredient_name
WHERE NOT EXISTS(SELECT 1 FROM public.ingredient_synonyms old WHERE pg_temp.mealio_key(old.mot_recette)=pg_temp.mealio_key(a.alias))
  AND NOT EXISTS(SELECT 1 FROM public.official_ingredients other WHERE pg_temp.mealio_key(other.nom)=pg_temp.mealio_key(a.alias) AND other.id<>i.id)
ORDER BY pg_temp.mealio_key(a.alias),a.alias;

-- Keep missing targets/conflicts as review items, never overwrite an existing association.
INSERT INTO public.reference_enrichment_review(request_key,kind,source_label,ingredient_name,source_note)
SELECT 'alias:'||a.alias,'alias',a.alias,a.ingredient_name,'Cible absente ou association existante différente ; vérifier avant activation.'
FROM enrichment_aliases a WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients i
  JOIN public.ingredient_synonyms sy ON sy.ingredient_id=i.id
  WHERE i.nom=a.ingredient_name AND pg_temp.mealio_key(sy.mot_recette)=pg_temp.mealio_key(a.alias))
ON CONFLICT(request_key) DO NOTHING;

-- Only propagate existing explicit, consistent measures. No generic weights per piece.
WITH ratios AS (
 SELECT d.ingredient_id,d.unite,d.poids_g_approx / CASE
   WHEN u.unite='Cuillère à soupe' AND lower(trim(u.equivalence_reference))='15 ml' THEN 15::numeric
   WHEN u.unite='Cuillère à café' AND lower(trim(u.equivalence_reference))='5 ml' THEN 5::numeric END AS grams_per_ml
 FROM public.ingredient_densities d JOIN public.unit_mappings u ON u.unite=d.unite
 WHERE d.poids_g_approx>0 AND d.poids_g_approx::text NOT IN ('NaN','Infinity','-Infinity') AND u.type_unite='volume'
), consistent AS (
 SELECT ingredient_id,avg(grams_per_ml) AS grams_per_ml FROM ratios WHERE grams_per_ml IS NOT NULL
 GROUP BY ingredient_id HAVING count(DISTINCT unite)>=2 AND max(grams_per_ml)-min(grams_per_ml)<0.000001
)
INSERT INTO public.ingredient_densities(ingredient_id,unite,poids_g_approx,source_note)
SELECT c.ingredient_id,'Millilitre',c.grams_per_ml,'Approximation dérivée des mesures existantes cohérentes : soupe/15 mL et café/5 mL. Pas une nouvelle mesure physique.'
FROM consistent c WHERE EXISTS(SELECT 1 FROM public.unit_mappings WHERE unite='Millilitre')
AND NOT EXISTS(SELECT 1 FROM public.ingredient_densities old WHERE old.ingredient_id=c.ingredient_id AND old.unite='Millilitre');

INSERT INTO public.reference_enrichment_review(request_key,kind,source_label,ingredient_name,unite,source_note) VALUES
  ('measure:Courgette:Pièce','unit_mass','Courgette','Courgette','Pièce','Besoin conservé : 2 piece de « Courgette ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Aubergine:Pièce','unit_mass','Aubergine','Aubergine','Pièce','Besoin conservé : 1 piece de « Aubergine ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Oignon jaune:Pièce','unit_mass','Oignon jaune','Oignon jaune','Pièce','Besoin conservé : 1 piece de « Oignon jaune ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Feta:morceau','unit_mass','Feta','Feta','morceau','Besoin conservé : 1 morceau de « Feta ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Thym frais:Brin','unit_mass','Thym frais','Thym frais','Brin','Besoin conservé : 2 brin de « Thym frais ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Jus de citron:Pièce','unit_definition','Jus de citron','Jus de citron','Pièce','Besoin conservé : 0.5 piece de « Jus de citron ». Aucune équivalence explicite ne permet de convertir en Millilitre. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Pâte feuilletée:Pièce','unit_mass','Pâte feuilletée','Pâte feuilletée','Pièce','Besoin conservé : 1 piece de « Pâte feuilletée ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Gruyère:parsemer','unit_definition','Gruyère','Gruyère','parsemer','Besoin conservé : 0 parsemer de « Gruyère ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:86599d6b-428d-458d-af49-36784456c09f:Gruyère','recipe_quantity','Gruyère',NULL,NULL,'Recette Tarte fine aux courgettes et Boursin : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:96b805d2-75fe-4f9c-ac6f-a7bd98f21756:Thym','recipe_quantity','Thym',NULL,NULL,'Recette Cake d''été : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Ail:Gousse','unit_definition','Ail','Ail','Gousse','Besoin conservé : 2 gousse de « Ail ». Aucune équivalence explicite ne permet de convertir en Pièce. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:e682d519-3874-4ed7-859b-f68666150282:sel','recipe_quantity','sel',NULL,NULL,'Recette Tendrons de veau à la gardiane : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:e682d519-3874-4ed7-859b-f68666150282:poivre','recipe_quantity','poivre',NULL,NULL,'Recette Tendrons de veau à la gardiane : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Pomme:Pièce','unit_mass','Pomme','Pomme','Pièce','Besoin conservé : 6 piece de « Pomme ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Jus de citron:filet','unit_definition','Jus de citron','Jus de citron','filet','Besoin conservé : 1 filet de « Jus de citron ». Aucune équivalence explicite ne permet de convertir en Millilitre. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:9428614f-76ad-4fc0-a05a-6db45ec14f84:eau (pour le caramel)','recipe_quantity','eau (pour le caramel)',NULL,NULL,'Recette Gâteau aux pêches de Jeanine Laurent : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:c558eff5-c8fc-4200-ada6-3c05febc6991:poivre','recipe_quantity','poivre',NULL,NULL,'Recette Pommes de terre vigneronnes : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:50391f36-35dd-4e4e-b6d8-a5d59b51cffa:thym émietté','recipe_quantity','thym émietté',NULL,NULL,'Recette Gratin de courgettes : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:50391f36-35dd-4e4e-b6d8-a5d59b51cffa:poivre','recipe_quantity','poivre',NULL,NULL,'Recette Gratin de courgettes : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:50391f36-35dd-4e4e-b6d8-a5d59b51cffa:sel','recipe_quantity','sel',NULL,NULL,'Recette Gratin de courgettes : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:50391f36-35dd-4e4e-b6d8-a5d59b51cffa:beurre pour le plat','recipe_quantity','beurre pour le plat',NULL,NULL,'Recette Gratin de courgettes : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Beurre:cuisson','unit_definition','Beurre','Beurre','cuisson','Besoin conservé : 0 cuisson de « Beurre ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:08788652-f0cc-4140-be73-495ee4ebb2ad:huile','recipe_quantity','huile',NULL,NULL,'Recette Barbotton : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:08788652-f0cc-4140-be73-495ee4ebb2ad:Beurre','recipe_quantity','Beurre',NULL,NULL,'Recette Barbotton : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:be542b36-ca36-411c-ba1c-a188a9133296:vin blanc sec','recipe_quantity','vin blanc sec',NULL,NULL,'Recette Rillettes de saumon frais et fumé / recette d''Oma pour nos fiançailles !! : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:be542b36-ca36-411c-ba1c-a188a9133296:sel','recipe_quantity','sel',NULL,NULL,'Recette Rillettes de saumon frais et fumé / recette d''Oma pour nos fiançailles !! : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:be542b36-ca36-411c-ba1c-a188a9133296:poivre','recipe_quantity','poivre',NULL,NULL,'Recette Rillettes de saumon frais et fumé / recette d''Oma pour nos fiançailles !! : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Carotte:Pièce','unit_mass','Carotte','Carotte','Pièce','Besoin conservé : 2 piece de « Carotte ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:452a35a5-0962-4002-8075-2bf57a8ddb2e:persil haché','recipe_quantity','persil haché',NULL,NULL,'Recette Œufs en meurette : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:452a35a5-0962-4002-8075-2bf57a8ddb2e:sel','recipe_quantity','sel',NULL,NULL,'Recette Œufs en meurette : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:452a35a5-0962-4002-8075-2bf57a8ddb2e:poivre du moulin','recipe_quantity','poivre du moulin',NULL,NULL,'Recette Œufs en meurette : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:4e93c746-3b57-4374-90d4-bfec92a8b670:huile ou beurre','recipe_quantity','huile ou beurre',NULL,NULL,'Recette La Tartiflette au Reblochon  : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:4e93c746-3b57-4374-90d4-bfec92a8b670:sel','recipe_quantity','sel',NULL,NULL,'Recette La Tartiflette au Reblochon  : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:4e93c746-3b57-4374-90d4-bfec92a8b670:poivre','recipe_quantity','poivre',NULL,NULL,'Recette La Tartiflette au Reblochon  : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Beurre:noix','unit_definition','Beurre','Beurre','noix','Besoin conservé : 1 noix de « Beurre ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:9b3f1c94-e80d-4894-8953-8e688878750f:sel','recipe_quantity','sel',NULL,NULL,'Recette Risotto aux champignons : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:9b3f1c94-e80d-4894-8953-8e688878750f:poivre','recipe_quantity','poivre',NULL,NULL,'Recette Risotto aux champignons : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:ea5ec85d-c789-45ba-a311-07562c901537:confiture d''abricot','recipe_quantity','confiture d''abricot',NULL,NULL,'Recette Le michon breton : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Échalote:Pièce','unit_mass','Échalote','Échalote','Pièce','Besoin conservé : 3 piece de « Échalote ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:23970d8e-5e26-4c51-a624-71fc1269c94b:sel','recipe_quantity','sel',NULL,NULL,'Recette Œufs en meurette faciles : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:23970d8e-5e26-4c51-a624-71fc1269c94b:poivre','recipe_quantity','poivre',NULL,NULL,'Recette Œufs en meurette faciles : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Filet mignon de porc:Pièce','unit_mass','Filet mignon de porc','Filet mignon de porc','Pièce','Besoin conservé : 1 piece de « Filet mignon de porc ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Ail:c c','unit_definition','Ail','Ail','c c','Besoin conservé : 1 c c de « Ail ». Aucune équivalence explicite ne permet de convertir en Pièce. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Pâte brisée:Pièce','unit_mass','Pâte brisée','Pâte brisée','Pièce','Besoin conservé : 1 piece de « Pâte brisée ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Romarin frais:Brin','unit_mass','Romarin frais','Romarin frais','Brin','Besoin conservé : 2 brin de « Romarin frais ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Pâte sablée:Rouleau','unit_mass','Pâte sablée','Pâte sablée','Rouleau','Besoin conservé : 1 rouleau de « Pâte sablée ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Pain de mie:Tranche','unit_mass','Pain de mie','Pain de mie','Tranche','Besoin conservé : 8 tranche de « Pain de mie ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Pâte feuilletée:Rouleau','unit_mass','Pâte feuilletée','Pâte feuilletée','Rouleau','Besoin conservé : 1 rouleau de « Pâte feuilletée ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Pancetta:Tranche','unit_mass','Pancetta','Pancetta','Tranche','Besoin conservé : 8 tranche de « Pancetta ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Pâte brisée:Rouleau','unit_mass','Pâte brisée','Pâte brisée','Rouleau','Besoin conservé : 1 rouleau de « Pâte brisée ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Poivron rouge:Pièce','unit_mass','Poivron rouge','Poivron rouge','Pièce','Besoin conservé : 2 piece de « Poivron rouge ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:c794f891-2240-41bf-aee2-e32e8df17c6b:poivre du moulin','recipe_quantity','poivre du moulin',NULL,NULL,'Recette Mijoté de cocos de Paimpol au porc et oignons de Roscoff : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Crevette:Pièce','unit_mass','Crevette','Crevette','Pièce','Besoin conservé : 0 piece de « Crevette ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Bacon:Pièce','unit_mass','Bacon','Bacon','Pièce','Besoin conservé : 0 piece de « Bacon ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Mayonnaise:Pièce','unit_mass','Mayonnaise','Mayonnaise','Pièce','Besoin conservé : 0 piece de « Mayonnaise ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:c36b54b2-4f83-488c-b3db-4b465df01e6f:Crevette','recipe_quantity','Crevette',NULL,NULL,'Recette Crevettes au bacon  : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:c36b54b2-4f83-488c-b3db-4b465df01e6f:Ail','recipe_quantity','Ail',NULL,NULL,'Recette Crevettes au bacon  : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:c36b54b2-4f83-488c-b3db-4b465df01e6f:Bacon','recipe_quantity','Bacon',NULL,NULL,'Recette Crevettes au bacon  : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:c36b54b2-4f83-488c-b3db-4b465df01e6f:Mayonnaise','recipe_quantity','Mayonnaise',NULL,NULL,'Recette Crevettes au bacon  : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Prune:Pièce','unit_mass','Prune','Prune','Pièce','Besoin conservé : 8 piece de « Prune ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:a70ca0a7-b231-47b7-bc04-58b83ba8025c:poivre du moulin','recipe_quantity','poivre du moulin',NULL,NULL,'Recette Mijoté de cocos de Paimpol au porc et oignons de Roscoff : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Oignon rouge:Pièce','unit_mass','Oignon rouge','Oignon rouge','Pièce','Besoin conservé : 1 piece de « Oignon rouge ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Pomme de terre:Pièce','unit_mass','Pomme de terre','Pomme de terre','Pièce','Besoin conservé : 3 piece de « Pomme de terre ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Navet:Pièce','unit_mass','Navet','Navet','Pièce','Besoin conservé : 2 piece de « Navet ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('measure:Coriandre fraîche:Bouquet','unit_mass','Coriandre fraîche','Coriandre fraîche','Bouquet','Besoin conservé : 1 bouquet de « Coriandre fraîche ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:83d7443d-30d3-4f51-ad33-a85ef231cd8d:gros sel','recipe_quantity','gros sel',NULL,NULL,'Recette Pot-au-feu : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('recipe:83d7443d-30d3-4f51-ad33-a85ef231cd8d:poivre','recipe_quantity','poivre',NULL,NULL,'Recette Pot-au-feu : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Canard (cuisse confite):Pièce','unit_mass','Canard (cuisse confite)','Canard (cuisse confite)','Pièce','Besoin conservé : 4 piece de « Canard (cuisse confite) ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('recipe:e0a837b2-6012-4f5a-867c-68c17d823c0c:morceaux de pommes, noix ou noisettes (facultatif)','recipe_quantity','morceaux de pommes, noix ou noisettes (facultatif)',NULL,NULL,'Recette Cake à la compote de pommes : quantité à compléter dans Cookiwiki, pas dans une densité globale.'),
  ('measure:Gambas:Pièce','unit_mass','Gambas','Gambas','Pièce','Besoin conservé : 16 piece de « Gambas ». Aucune équivalence explicite ne permet de convertir en Gramme. L''association officielle et le rangement automatique restent en attente. Mesurer le poids/volume ou préciser l’unité de la recette ; ne pas inventer de poids moyen.'),
  ('review:Ail','alias','Ail',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Bacon','alias','Bacon',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Bacon ou jambon','compound','Bacon ou jambon',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Beurre','alias','Beurre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Bouquet garni','alias','Bouquet garni',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Boursin ail et fines herbes','compound','Boursin ail et fines herbes',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Ciboulette et persil frais','compound','Ciboulette et persil frais',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Coco de Paimpol AOP frais à écosser','alias','Coco de Paimpol AOP frais à écosser',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Cocos de Paimpol AOP en gousses','alias','Cocos de Paimpol AOP en gousses',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Cocos de Paimpol AOP écossés','alias','Cocos de Paimpol AOP écossés',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Cognac','alias','Cognac',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Coriandre fraîche','alias','Coriandre fraîche',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Crevette','alias','Crevette',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Crème fraîche','alias','Crème fraîche',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Farine','alias','Farine',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Fromage de chèvre frais (ou bûche)','compound','Fromage de chèvre frais (ou bûche)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Gousses d''ail','alias','Gousses d''ail',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Grappe de raisin (blanc ou noir)','compound','Grappe de raisin (blanc ou noir)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Gruyère','alias','Gruyère',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Lait','alias','Lait',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Mayonnaise','alias','Mayonnaise',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Muffins anglais','alias','Muffins anglais',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Oignon','alias','Oignon',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Poitrine de porc fumée','alias','Poitrine de porc fumée',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Poivre','alias','Poivre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Poivre du moulin','alias','Poivre du moulin',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Poivre en grains','alias','Poivre en grains',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Poivron jaune ou rouge','compound','Poivron jaune ou rouge',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Saucisses bretonnes (ou saucisses fraîches)','compound','Saucisses bretonnes (ou saucisses fraîches)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Sel','alias','Sel',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Sel et poivre','compound','Sel et poivre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Thym','alias','Thym',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:Vinaigre de cidre ou de Xérès','compound','Vinaigre de cidre ou de Xérès',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:amandes effilées','alias','amandes effilées',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:beurre (idéalement demi-sel)','alias','beurre (idéalement demi-sel)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:beurre salé','alias','beurre salé',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:bouillon','alias','bouillon',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:bouillon de bœuf','alias','bouillon de bœuf',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:bouillon de volaille','alias','bouillon de volaille',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:bouillon de volaille ou de viande','compound','bouillon de volaille ou de viande',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:bouquet de basilic petit vert','alias','bouquet de basilic petit vert',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:bouquet garni','alias','bouquet garni',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:bûche de chèvre','alias','bûche de chèvre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:bûche de fromage de chèvre','alias','bûche de fromage de chèvre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:cerneaux de noix','alias','cerneaux de noix',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:champignons','alias','champignons',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:chapelure ou fromage râpé','compound','chapelure ou fromage râpé',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:chocolat','alias','chocolat',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:châtaignes cuites au naturel','alias','châtaignes cuites au naturel',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:compote de pommes (idéalement sans sucres ajoutés)','alias','compote de pommes (idéalement sans sucres ajoutés)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:confiture d''abricot','alias','confiture d''abricot',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:croûtons de pain','alias','croûtons de pain',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:crème fraîche','alias','crème fraîche',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:crème fraîche entière','alias','crème fraîche entière',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:demi-quetsches et demi-reines-claudes congelées','compound','demi-quetsches et demi-reines-claudes congelées',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:farine','alias','farine',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:farine (ou 150g farine + 50g poudre d''amandes, noisette ou pistache)','compound','farine (ou 150g farine + 50g poudre d''amandes, noisette ou pistache)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:farine tout usage','alias','farine tout usage',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:fleur de sel','alias','fleur de sel',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:fromage de chèvre ou fromage bleu','compound','fromage de chèvre ou fromage bleu',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:gousse de vanille ou bâton de cannelle (facultatif)','compound','gousse de vanille ou bâton de cannelle (facultatif)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:gousses d''ail','alias','gousses d''ail',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:gros sel','alias','gros sel',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:gros sel de mer','alias','gros sel de mer',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:gîte à la noix','alias','gîte à la noix',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:huile','alias','huile',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:huile neutre','alias','huile neutre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:huile ou beurre','compound','huile ou beurre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:jambon cru ou blanc','compound','jambon cru ou blanc',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:jambon haché gros ou lardons','compound','jambon haché gros ou lardons',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:lait','alias','lait',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:lambig (ou calvados)','compound','lambig (ou calvados)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:lard gras','alias','lard gras',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:lardons fumés','alias','lardons fumés',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:lardons fumés ou nature','compound','lardons fumés ou nature',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:levure','alias','levure',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:macreuse','alias','macreuse',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:morceaux de pommes, noix ou noisettes (facultatif)','compound','morceaux de pommes, noix ou noisettes (facultatif)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:morceaux de poulet (cuisses ou filets)','compound','morceaux de poulet (cuisses ou filets)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:moutarde de Dijon','alias','moutarde de Dijon',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:moutarde forte de Dijon','alias','moutarde forte de Dijon',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:moutarde à l''ancienne','alias','moutarde à l''ancienne',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:oignon','alias','oignon',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:oignons piqués d''un clou de girofle','alias','oignons piqués d''un clou de girofle',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:oignons rosés de Roscoff AOP','alias','oignons rosés de Roscoff AOP',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:olives dénoyautées (noires et/ou vertes) et/ou tomates séchées','compound','olives dénoyautées (noires et/ou vertes) et/ou tomates séchées',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:olives noires et vertes','compound','olives noires et vertes',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:os à moelle','alias','os à moelle',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:persil','alias','persil',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:persil haché','alias','persil haché',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:petits champignons','alias','petits champignons',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:petits morceaux de céleri','alias','petits morceaux de céleri',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pincée de sel','alias','pincée de sel',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:plat de côte','alias','plat de côte',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:poires fraîches (Conférence ou Comice)','compound','poires fraîches (Conférence ou Comice)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:poitrine de veau en morceaux','alias','poitrine de veau en morceaux',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:poitrine fumée en tranches très minces','alias','poitrine fumée en tranches très minces',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:poitrine salée en tranches très minces','alias','poitrine salée en tranches très minces',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:poivre','alias','poivre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:poivre du moulin','alias','poivre du moulin',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pommes de terre (BF15 ou Charlotte)','compound','pommes de terre (BF15 ou Charlotte)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pommes de terre (chair jaune BF ou charlotte)','compound','pommes de terre (chair jaune BF ou charlotte)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pommes de terre BF15','alias','pommes de terre BF15',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pommes de terre à chair ferme','alias','pommes de terre à chair ferme',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pommes de terre épluchées (type Bintje ou Manon)','compound','pommes de terre épluchées (type Bintje ou Manon)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:poulet découpé','alias','poulet découpé',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pâte brisée ou sablée','compound','pâte brisée ou sablée',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pâte sablée au parmesan','alias','pâte sablée au parmesan',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pêches au sirop','alias','pêches au sirop',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pêches jaunes ou nectarines','compound','pêches jaunes ou nectarines',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:pêches ou nectarines','compound','pêches ou nectarines',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:ras-el-hanout','alias','ras-el-hanout',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:reblochon','alias','reblochon',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:riz arborio spécial risotto','alias','riz arborio spécial risotto',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:saumon fumé','alias','saumon fumé',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:sel','alias','sel',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:semoule fine ou biscuits écrasés','compound','semoule fine ou biscuits écrasés',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:sucre','alias','sucre',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:sucre (ou miel)','compound','sucre (ou miel)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:sucre de canne','alias','sucre de canne',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:sucre en morceaux (pour le caramel)','alias','sucre en morceaux (pour le caramel)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:sucre vanillé','alias','sucre vanillé',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:thym séché ou herbes de Provence','compound','thym séché ou herbes de Provence',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:thym émietté','alias','thym émietté',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:tomates pelées','alias','tomates pelées',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:tranches de baguette grillées','alias','tranches de baguette grillées',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:tranches de pain (mie ou campagne)','compound','tranches de pain (mie ou campagne)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:tête d''ail rose de Lautrec','alias','tête d''ail rose de Lautrec',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:ventrèche ou lard demi-sel séché','compound','ventrèche ou lard demi-sel séché',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:vin blanc sec','alias','vin blanc sec',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:vin blanc sec (type Aligoté)','alias','vin blanc sec (type Aligoté)',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:vin blanc sec ou bouillon de volaille','compound','vin blanc sec ou bouillon de volaille',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:échine de porc','alias','échine de porc',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('review:épinards hachés surgelés','alias','épinards hachés surgelés',NULL,NULL,'Association à valider ; conserver les différences de variété, frais/sec, cru/cuit, fumé/non fumé et les alternatives.'),
  ('identity:Ail:Pièce:Gousse','unit_definition','Ail · Pièce → Gousse','Ail','Pièce','Pièce peut désigner une tête ou une gousse. Compter les gousses en stock ; aucune conversion universelle tête/gousse.'),
  ('identity:Saucisse fraîche:Pièce:Gramme','unit_mass','Saucisse fraîche','Saucisse fraîche','Pièce','Peser le format réellement acheté. Un paquet de 870 g ne donne pas le poids par saucisse sans connaître son nombre.')
ON CONFLICT(request_key) DO NOTHING;
COMMIT;

-- Résumé à conserver après exécution :
SELECT status,kind,count(*) FROM public.reference_enrichment_review GROUP BY status,kind ORDER BY status,kind;
SELECT r.source_label,r.ingredient_name,r.unite,r.source_note FROM public.reference_enrichment_review r WHERE r.status='pending' ORDER BY r.kind,r.source_label;
