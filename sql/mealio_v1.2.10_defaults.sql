-- Mealio 1.2.10 : moyennes et choix par défaut autorisés, modifiables dans Admin.
-- Exécuter dans Mealio après la migration 1.2.8. Ne modifie PAS les stocks Frosti/Cellio ni Cookiwiki.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('mealio:reference:1.2.10'));
CREATE TEMP TABLE defaults_1210_marker(dummy boolean) ON COMMIT DROP;
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
ALTER TABLE public.ingredient_densities ADD COLUMN IF NOT EXISTS source_note text;
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Oignon','Légumes frais','Fruits & légumes','cellio',true,'Pièce' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Oignon');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Saucisse fraîche','Viandes','Boucherie','frosti',true,'Pièce' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Saucisse fraîche');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Poitrine de porc fumée','Charcuterie','Charcuterie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Poitrine de porc fumée');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Bouquet garni','Herbes fraîches','Fruits & légumes','frosti',true,'Pièce' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Bouquet garni');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Cocos de Paimpol AOP écossés','Légumes','Fruits & légumes','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Cocos de Paimpol AOP écossés');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Cocos de Paimpol AOP à écosser','Légumes','Fruits & légumes','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Cocos de Paimpol AOP à écosser');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Ail en poudre','Épices','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Ail en poudre');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Cognac','Boissons','Boissons','cellio',true,'Millilitre' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Cognac');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Calvados','Boissons','Boissons','cellio',true,'Millilitre' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Calvados');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Boursin ail et fines herbes','Fromages','Crèmerie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Boursin ail et fines herbes');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Chèvre frais','Fromages','Crèmerie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Chèvre frais');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Compote de pommes','Épicerie','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Compote de pommes');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Confiture d''abricot','Épicerie','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Confiture d''abricot');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Croûtons de pain','Boulangerie','Boulangerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Croûtons de pain');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Châtaigne cuite','Légumes','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Châtaigne cuite');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Riz arborio','Céréales','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Riz arborio');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Saumon fumé','Poissons','Poissonnerie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Saumon fumé');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Lardons fumés','Charcuterie','Charcuterie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Lardons fumés');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Lard gras','Charcuterie','Charcuterie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Lard gras');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Poitrine de porc salée','Charcuterie','Charcuterie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Poitrine de porc salée');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Échine de porc','Viandes','Boucherie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Échine de porc');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Poitrine de veau','Viandes','Boucherie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Poitrine de veau');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Bœuf (gîte)','Viandes','Boucherie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Bœuf (gîte)');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Bœuf (macreuse)','Viandes','Boucherie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Bœuf (macreuse)');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Bœuf (plat de côte)','Viandes','Boucherie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Bœuf (plat de côte)');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Os à moelle','Viandes','Boucherie','frosti',true,'Pièce' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Os à moelle');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Épinard haché surgelé','Légumes','Surgelés','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Épinard haché surgelé');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Pois chiche cuit','Légumineuses','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Pois chiche cuit');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Pêche au sirop','Fruits','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Pêche au sirop');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Muffin anglais','Boulangerie','Boulangerie','cellio',true,'Pièce' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Muffin anglais');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Reblochon','Fromages','Crèmerie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Reblochon');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Sucre vanillé','Épicerie','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Sucre vanillé');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Sucre en morceaux','Épicerie','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Sucre en morceaux');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Ras-el-hanout','Épices','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Ras-el-hanout');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Bouillon de bœuf liquide','Bouillons','Épicerie','cellio',true,'Millilitre' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Bouillon de bœuf liquide');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Bouillon de volaille liquide','Bouillons','Épicerie','cellio',true,'Millilitre' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Bouillon de volaille liquide');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Moutarde de Dijon','Condiments','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Moutarde de Dijon');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Moutarde à l''ancienne','Condiments','Épicerie','cellio',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Moutarde à l''ancienne');
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference) SELECT 'Pâte sablée au parmesan','Boulangerie','Boulangerie','frosti',true,'Gramme' WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE nom='Pâte sablée au parmesan');
INSERT INTO public.unit_mappings(unite,abreviation,type_unite,multiplicateur) SELECT 'Tête','tete','divers',1 WHERE NOT EXISTS(SELECT 1 FROM public.unit_mappings WHERE unite='Tête');
CREATE TEMP TABLE defaults_1210_mass(nom text,unite text,grams numeric) ON COMMIT DROP;
INSERT INTO defaults_1210_mass VALUES
('Ail','Gousse',5),
('Ail','Tête',50),
('Ail','Cuillère à café',3),
('Ail','Cuillère à soupe',9),
('Oignon','Pièce',150),
('Oignon jaune','Pièce',150),
('Oignon blanc','Pièce',150),
('Oignon rouge','Pièce',150),
('Échalote','Pièce',25),
('Carotte','Pièce',80),
('Courgette','Pièce',250),
('Aubergine','Pièce',300),
('Navet','Pièce',150),
('Poivron rouge','Pièce',150),
('Poivron jaune','Pièce',150),
('Poivron vert','Pièce',150),
('Pomme de terre','Pièce',150),
('Pomme','Pièce',180),
('Poire','Pièce',180),
('Pêche','Pièce',150),
('Nectarine','Pièce',150),
('Prune','Pièce',40),
('Figue','Pièce',50),
('Citron','Pièce',100),
('Citron vert','Pièce',70),
('Tomate','Pièce',150),
('Tomate cerise','Pièce',15),
('Poireau','Pièce',200),
('Champignon de Paris','Pièce',20),
('Œuf (poule)','Pièce',50),
('Jaune d''œuf','Pièce',18),
('Blanc d''œuf','Pièce',30),
('Saucisse fraîche','Pièce',100),
('Saucisse de Toulouse','Pièce',125),
('Canard (cuisse confite)','Pièce',250),
('Filet mignon de porc','Pièce',500),
('Crevette','Pièce',10),
('Gambas','Pièce',20),
('Bacon','Tranche',20),
('Bacon','Pièce',20),
('Pancetta','Tranche',15),
('Jambon blanc','Tranche',40),
('Jambon cru','Tranche',25),
('Pain de mie','Tranche',30),
('Baguette','Tranche',20),
('Baguette','Pièce',250),
('Pâte brisée','Rouleau',230),
('Pâte brisée','Pièce',230),
('Pâte feuilletée','Rouleau',230),
('Pâte feuilletée','Pièce',230),
('Pâte sablée','Rouleau',230),
('Pâte sablée','Pièce',230),
('Chèvre (fromage)','Pièce',200),
('Reblochon','Pièce',450),
('Feta','Morceau',30),
('Coriandre fraîche','Bouquet',30),
('Coriandre fraîche','Botte',30),
('Coriandre fraîche','Brin',1),
('Basilic','Bouquet',30),
('Basilic','Botte',30),
('Basilic','Brin',1),
('Persil plat','Bouquet',30),
('Persil plat','Botte',30),
('Persil plat','Brin',1),
('Persil plat','Cuillère à soupe',3),
('Persil frisé','Bouquet',30),
('Persil frisé','Botte',30),
('Persil frisé','Brin',1),
('Romarin frais','Brin',2),
('Thym frais','Brin',1),
('Laurier frais','Feuille',0.2),
('Laurier frais','Brin',1),
('Bouquet garni','Pièce',5),
('Amande','Poignée',30),
('Noix','Poignée',30),
('Levure chimique','Sachet',11),
('Levure chimique','Paquet',11),
('Sucre vanillé','Sachet',8),
('Sucre en morceaux','Pièce',5),
('Beurre','Noix (de beurre)',10),
('Jus de citron','Pièce',30),
('Jus de citron','Filet',5),
('Jus de citron','Millilitre',1),
('Huile d''olive','Millilitre',0.92),
('Huile de tournesol','Millilitre',0.92),
('Huile de colza','Millilitre',0.92),
('Mayonnaise','Cuillère à soupe',15),
('Crème épaisse','Millilitre',1),
('Crème liquide','Millilitre',1),
('Lait demi-écrémé','Millilitre',1.03),
('Lait entier','Millilitre',1.03),
('Farine de blé','Millilitre',0.55),
('Sucre en poudre','Millilitre',0.85),
('Miel','Millilitre',1.4),
('Concentré de tomate','Cuillère à soupe',18),
('Cuisse de poulet','Pièce',250),
('Poulet entier','Pièce',1200),
('Vin blanc (cuisine)','Bouteille',750),
('Vin blanc (cuisine)','Millilitre',1),
('Vin rouge (cuisine)','Bouteille',750),
('Vin rouge (cuisine)','Millilitre',1),
('Tomate pelée (boîte)','Boîte',400),
('Bouillon cube (bœuf)','Cube',10),
('Bouillon cube (bœuf)','Pièce',10),
('Bouillon cube (volaille)','Cube',10),
('Bouillon cube (volaille)','Pièce',10),
('Bouillon cube (légumes)','Cube',10),
('Bouillon cube (légumes)','Pièce',10),
('Ail en poudre','Cuillère à café',3),
('Ail en poudre','Cuillère à soupe',9),
('Moutarde de Dijon','Cuillère à soupe',15),
('Moutarde à l''ancienne','Cuillère à soupe',15),
('Pêche au sirop','Boîte',400),
('Croûtons de pain','Pièce',3),
('Céleri branche','Pièce',50),
('Céleri branche','Brin',50),
('Pâte sablée au parmesan','Pièce',230),
('Ras-el-hanout','Cuillère à soupe',6),
('Ras-el-hanout','Cuillère à café',2);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM defaults_1210_mass m WHERE NOT EXISTS(SELECT 1 FROM public.unit_mappings u WHERE u.unite=m.unite)) THEN RAISE EXCEPTION 'Unité absente : appliquer la migration 1.2.8 et vérifier unit_mappings'; END IF; END $$;
INSERT INTO public.ingredient_densities(ingredient_id,unite,poids_g_approx,source_note)
SELECT i.id,m.unite,m.grams,'Mealio 1.2.10 : moyenne/format initial approximatif, modifiable dans Admin ; pas une mesure du lot.'
FROM defaults_1210_mass m JOIN public.official_ingredients i ON i.nom=m.nom
WHERE NOT EXISTS(SELECT 1 FROM public.ingredient_densities d WHERE d.ingredient_id=i.id AND d.unite=m.unite);
-- Ail : 5 g par gousse, choix explicite demandé. Supprimer la conversion Pièce ambiguë.
DELETE FROM public.ingredient_densities d USING public.official_ingredients i WHERE d.ingredient_id=i.id AND i.nom='Ail' AND pg_temp.mealio_key(d.unite) IN ('piece','pieces');
CREATE TABLE IF NOT EXISTS public.mealio_reference_seed_runs(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.mealio_reference_seed_runs ENABLE ROW LEVEL SECURITY;
UPDATE public.ingredient_densities d SET poids_g_approx=5,source_note='Mealio 1.2.10 : 5 g par gousse demandé, modifiable dans Admin.' FROM public.official_ingredients i WHERE d.ingredient_id=i.id AND i.nom='Ail' AND d.unite='Gousse' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Gousse' WHERE nom='Ail' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Oignon' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Oignon jaune' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Oignon blanc' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Oignon rouge' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Échalote' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Œuf (poule)' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Jaune d''œuf' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Blanc d''œuf' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Bouquet garni' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Saucisse fraîche' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Saucisse de Toulouse' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Carotte' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Courgette' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Aubergine' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Navet' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Poivron rouge' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Poivron jaune' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Poivron vert' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Tomate' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Tomate cerise' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Pomme' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Poire' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Pêche' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Nectarine' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Prune' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Figue' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Citron' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Citron vert' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Pièce' WHERE nom='Poireau' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Brin' WHERE nom='Thym frais' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Brin' WHERE nom='Romarin frais' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Feuille' WHERE nom='Laurier frais' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Bouquet' WHERE nom='Coriandre fraîche' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Bouquet' WHERE nom='Basilic' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
UPDATE public.official_ingredients SET unite_reference='Tranche' WHERE nom='Pain de mie' AND NOT EXISTS(SELECT 1 FROM public.mealio_reference_seed_runs WHERE version='1.2.10');
CREATE TEMP TABLE defaults_1210_alias(alias text,nom text) ON COMMIT DROP;
INSERT INTO defaults_1210_alias VALUES
('farine','Farine de blé'),
('farine tout usage','Farine de blé'),
('lait','Lait demi-écrémé'),
('huile','Huile de tournesol'),
('huile neutre','Huile de tournesol'),
('sucre','Sucre en poudre'),
('sucre de canne','Sucre roux'),
('poivre','Poivre noir'),
('poivre du moulin','Poivre noir'),
('poivre en grains','Poivre noir'),
('sel','Sel fin'),
('pincée de sel','Sel fin'),
('gros sel','Sel gros / Fleur de sel'),
('gros sel de mer','Sel gros / Fleur de sel'),
('fleur de sel','Sel gros / Fleur de sel'),
('crème fraîche','Crème épaisse'),
('crème fraîche entière','Crème épaisse'),
('chocolat','Chocolat noir'),
('champignons','Champignon de Paris'),
('petits champignons','Champignon de Paris'),
('persil','Persil plat'),
('persil haché','Persil plat'),
('beurre salé','Beurre demi-sel'),
('beurre (idéalement demi-sel)','Beurre demi-sel'),
('bouillon','Bouillon liquide'),
('bouillon de bœuf','Bouillon de bœuf liquide'),
('bouillon de volaille','Bouillon de volaille liquide'),
('levure','Levure chimique'),
('thym','Thym séché'),
('thym émietté','Thym séché'),
('gousses d''ail','Ail'),
('gousse d''ail','Ail'),
('tête d''ail rose de Lautrec','Ail'),
('oignons frais','Oignon'),
('gros oignon','Oignon'),
('oignons piqués d''un clou de girofle','Oignon'),
('oignons rosés de Roscoff AOP','Oignon'),
('petits oignons','Oignon'),
('courgettes moyennes','Courgette'),
('tomates bien mûres','Tomate'),
('cerneaux de noix','Noix'),
('amandes effilées','Amande'),
('bûche de chèvre','Chèvre (fromage)'),
('bûche de fromage de chèvre','Chèvre (fromage)'),
('croûtons de pain','Croûtons de pain'),
('châtaignes cuites au naturel','Châtaigne cuite'),
('riz arborio spécial risotto','Riz arborio'),
('lardons fumés','Lardons fumés'),
('poitrine fumée en tranches très minces','Poitrine de porc fumée'),
('poitrine salée en tranches très minces','Poitrine de porc salée'),
('épinards hachés surgelés','Épinard haché surgelé'),
('pois chiches cuits','Pois chiche cuit'),
('pêches au sirop','Pêche au sirop'),
('poitrine de veau en morceaux','Poitrine de veau'),
('gîte à la noix','Bœuf (gîte)'),
('macreuse','Bœuf (macreuse)'),
('plat de côte','Bœuf (plat de côte)'),
('pommes de terre BF15','Pomme de terre'),
('pommes de terre à chair ferme','Pomme de terre'),
('pommes de terre (BF15 ou Charlotte)','Pomme de terre'),
('pommes de terre (chair jaune BF ou charlotte)','Pomme de terre'),
('pommes de terre épluchées (type Bintje ou Manon)','Pomme de terre'),
('poires fraîches (Conférence ou Comice)','Poire'),
('Coco de Paimpol AOP frais à écosser','Cocos de Paimpol AOP à écosser'),
('Cocos de Paimpol AOP en gousses','Cocos de Paimpol AOP à écosser'),
('vin blanc sec','Vin blanc (cuisine)'),
('vin blanc sec (type Aligoté)','Vin blanc (cuisine)'),
('compote de pommes (idéalement sans sucres ajoutés)','Compote de pommes'),
('sucre en morceaux (pour le caramel)','Sucre en morceaux'),
('tranches de baguette grillées','Baguette'),
('Saucisses bretonnes (ou saucisses fraîches)','Saucisse fraîche'),
('saucisses','Saucisse fraîche'),
('Bacon ou jambon','Bacon'),
('pêches jaunes ou nectarines','Pêche'),
('pêches ou nectarines','Pêche'),
('Poivron jaune ou rouge','Poivron jaune'),
('pâte brisée ou sablée','Pâte brisée'),
('sucre (ou miel)','Sucre en poudre'),
('jambon cru ou blanc','Jambon cru'),
('lardons fumés ou nature','Lardons fumés'),
('thym séché ou herbes de Provence','Thym séché'),
('vin blanc sec ou bouillon de volaille','Vin blanc (cuisine)'),
('Vinaigre de cidre ou de Xérès','Vinaigre de cidre'),
('lambig (ou calvados)','Calvados'),
('Fromage de chèvre frais (ou bûche)','Chèvre frais'),
('gousse de vanille ou bâton de cannelle (facultatif)','Vanille (gousse)'),
('tranches de pain (mie ou campagne)','Pain de mie'),
('bouillon de volaille ou de viande','Bouillon de volaille liquide'),
('moutarde de Dijon','Moutarde de Dijon'),
('moutarde forte de Dijon','Moutarde de Dijon'),
('moutarde à l''ancienne','Moutarde à l''ancienne'),
('bouquet de basilic petit vert','Basilic'),
('tomates pelées','Tomate pelée (boîte)'),
('petits morceaux de céleri','Céleri branche'),
('poulet découpé','Poulet entier'),
('chapelure ou fromage râpé','Chapelure'),
('semoule fine ou biscuits écrasés','Semoule fine'),
('jambon haché gros ou lardons','Jambon blanc'),
('fromage de chèvre ou fromage bleu','Chèvre (fromage)'),
('morceaux de poulet (cuisses ou filets)','Cuisse de poulet'),
('ventrèche ou lard demi-sel séché','Poitrine de porc salée'),
('Grappe de raisin (blanc ou noir)','Raisin'),
('huile ou beurre','Huile de tournesol'),
('farine (ou 150g farine + 50g poudre d''amandes, noisette ou pistache)','Farine de blé');
INSERT INTO public.ingredient_synonyms(mot_recette,ingredient_id)
SELECT DISTINCT ON(pg_temp.mealio_key(a.alias)) a.alias,i.id FROM defaults_1210_alias a
JOIN public.official_ingredients i ON i.nom=a.nom
WHERE NOT EXISTS(SELECT 1 FROM public.ingredient_synonyms s WHERE pg_temp.mealio_key(s.mot_recette)=pg_temp.mealio_key(a.alias))
AND NOT EXISTS(SELECT 1 FROM public.official_ingredients o WHERE pg_temp.mealio_key(o.nom)=pg_temp.mealio_key(a.alias) AND o.id<>i.id)
ORDER BY pg_temp.mealio_key(a.alias),a.alias;
INSERT INTO public.mealio_reference_seed_runs(version) VALUES('1.2.10') ON CONFLICT DO NOTHING;
-- Actualiser les demandes déjà couvertes par le référentiel actif.
UPDATE public.reference_enrichment_review r SET ingredient_name=i.nom,status='verified',
 measurement_note='Association présente dans le référentiel actif après initialisation 1.2.10.',updated_at=now()
FROM public.official_ingredients i
WHERE r.status='pending' AND r.kind='alias' AND pg_temp.mealio_key(r.source_label)=pg_temp.mealio_key(i.nom);
UPDATE public.reference_enrichment_review r SET ingredient_name=i.nom,status='verified',
 measurement_note='Association par défaut autorisée en 1.2.10 ; modifiable dans Admin.',updated_at=now()
FROM public.ingredient_synonyms s JOIN public.official_ingredients i ON i.id=s.ingredient_id
WHERE r.status='pending' AND r.kind IN ('alias','compound') AND pg_temp.mealio_key(r.source_label)=pg_temp.mealio_key(s.mot_recette);
UPDATE public.reference_enrichment_review r SET value=d.poids_g_approx,status='verified',unite=d.unite,
 measurement_note=coalesce(d.source_note,'Équivalence déjà présente dans Admin.'),updated_at=now()
FROM public.ingredient_densities d JOIN public.official_ingredients i ON i.id=d.ingredient_id
WHERE r.status='pending' AND r.kind='unit_mass' AND i.nom=r.ingredient_name AND pg_temp.mealio_key(d.unite)=pg_temp.mealio_key(r.unite);
SELECT a.alias,a.nom AS cible_proposee,i.nom AS cible_existante FROM defaults_1210_alias a JOIN public.ingredient_synonyms s ON pg_temp.mealio_key(s.mot_recette)=pg_temp.mealio_key(a.alias) JOIN public.official_ingredients i ON i.id=s.ingredient_id WHERE i.nom<>a.nom;

-- Validation durable et sérialisée par libellé ; appelée seulement par le serveur Mealio.
CREATE OR REPLACE FUNCTION public.mealio_reference_key(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
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
CREATE OR REPLACE FUNCTION public.save_matcher_association(p_name text,p_ingredient_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; target_name text;
BEGIN
 IF p_name IS NULL OR length(trim(p_name))=0 OR length(p_name)>500 THEN RAISE EXCEPTION 'Libellé invalide'; END IF;
 k := public.mealio_reference_key(p_name);
 IF k='' THEN RAISE EXCEPTION 'Libellé normalisé vide'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('mealio:association:' || k));
 SELECT nom INTO target_name FROM public.official_ingredients WHERE id=p_ingredient_id;
 IF target_name IS NULL THEN RAISE EXCEPTION 'Ingrédient officiel introuvable'; END IF;
 IF EXISTS(SELECT 1 FROM public.official_ingredients WHERE public.mealio_reference_key(nom)=k AND id<>p_ingredient_id)
 OR EXISTS(SELECT 1 FROM public.ingredient_synonyms WHERE public.mealio_reference_key(mot_recette)=k AND ingredient_id<>p_ingredient_id)
 THEN RAISE EXCEPTION 'Association existante vers un autre ingrédient : corriger dans Admin'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE public.mealio_reference_key(nom)=k)
 AND NOT EXISTS(SELECT 1 FROM public.ingredient_synonyms WHERE public.mealio_reference_key(mot_recette)=k)
 THEN INSERT INTO public.ingredient_synonyms(mot_recette,ingredient_id) VALUES(trim(p_name),p_ingredient_id); END IF;
 RETURN jsonb_build_object('ok',true,'ingredient',target_name);
END $$;
REVOKE ALL ON FUNCTION public.save_matcher_association(text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_matcher_association(text,uuid) TO service_role;
COMMIT;
SELECT i.nom,i.unite_reference,d.unite,d.poids_g_approx,d.source_note FROM public.ingredient_densities d JOIN public.official_ingredients i ON i.id=d.ingredient_id ORDER BY i.nom,d.unite;
