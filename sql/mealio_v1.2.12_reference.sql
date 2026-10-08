-- MEALIO : après mealio_v1.2.10_defaults.sql. Aucune modification Frosti/Cellio.
-- Compléments d'identité pour les composants et les alternatives ; pas de synonymes entre variétés.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('mealio-reference-v1212'));
INSERT INTO public.official_ingredients(nom,categorie,rayon,default_storage,default_is_fridge,unite_reference)
SELECT x.nom,x.categorie,x.rayon,x.default_storage,x.default_is_fridge,x.unite_reference
FROM jsonb_to_recordset($payload$[{"nom":"Biscuit sec","unite_reference":"Pièce","categorie":"Épicerie","default_storage":"cellio","default_is_fridge":false,"rayon":"Épicerie"},{"nom":"Cannelle (bâton)","unite_reference":"Pièce","categorie":"Épicerie","default_storage":"cellio","default_is_fridge":false,"rayon":"Épicerie"},{"nom":"Fromage bleu","unite_reference":"Gramme","categorie":"Produits laitiers","default_storage":"frosti","default_is_fridge":true,"rayon":"Produits laitiers"},{"nom":"Fromage frais","unite_reference":"Gramme","categorie":"Produits laitiers","default_storage":"frosti","default_is_fridge":true,"rayon":"Produits laitiers"},{"nom":"Lard demi-sel","unite_reference":"Gramme","categorie":"Viandes","default_storage":"frosti","default_is_fridge":true,"rayon":"Viandes"},{"nom":"Pain de campagne","unite_reference":"Tranche","categorie":"Épicerie","default_storage":"cellio","default_is_fridge":false,"rayon":"Épicerie"},{"nom":"Poudre de noisette","unite_reference":"Gramme","categorie":"Épicerie","default_storage":"cellio","default_is_fridge":false,"rayon":"Épicerie"},{"nom":"Poudre de pistache","unite_reference":"Gramme","categorie":"Épicerie","default_storage":"cellio","default_is_fridge":false,"rayon":"Épicerie"},{"nom":"Quetsche","unite_reference":"Pièce","categorie":"Fruits frais","default_storage":"frosti","default_is_fridge":true,"rayon":"Fruits frais"},{"nom":"Reine-Claude","unite_reference":"Pièce","categorie":"Fruits frais","default_storage":"frosti","default_is_fridge":true,"rayon":"Fruits frais"},{"nom":"Tomate séchée","unite_reference":"Gramme","categorie":"Épicerie","default_storage":"cellio","default_is_fridge":false,"rayon":"Épicerie"},{"nom":"Ventrèche","unite_reference":"Gramme","categorie":"Viandes","default_storage":"frosti","default_is_fridge":true,"rayon":"Viandes"},{"nom":"Vinaigre de Xérès","unite_reference":"Millilitre","categorie":"Épicerie","default_storage":"cellio","default_is_fridge":false,"rayon":"Épicerie"}]$payload$::jsonb) AS x(nom text,categorie text,rayon text,default_storage text,default_is_fridge boolean,unite_reference text)
WHERE NOT EXISTS(SELECT 1 FROM public.official_ingredients i WHERE public.mealio_reference_key(i.nom)=public.mealio_reference_key(x.nom));
INSERT INTO public.ingredient_densities(ingredient_id,unite,poids_g_approx,source_note)
SELECT i.id,v.unite,v.grams,'Moyenne initiale Mealio v1.2.12, modifiable dans Admin.'
FROM (VALUES
 ('Quetsche','Pièce',30),
 ('Reine-Claude','Pièce',35),
 ('Cannelle (bâton)','Pièce',3),
 ('Biscuit sec','Pièce',8),
 ('Pain de campagne','Tranche',35),
 ('Vinaigre de Xérès','Cuillère à soupe',15),
 ('Semoule fine','Cuillère à soupe',12),
 ('Sel gros / Fleur de sel','Pincée',0.3),
 ('Sel fin','Pincée',0.3),
 ('Poivre noir','Pincée',0.1),
 ('Muscade','Pincée',0.1),
 ('Olive noire','Cuillère à soupe',20),
 ('Olive verte','Cuillère à soupe',20),
 ('Thym séché','Cuillère à café',0.7),
 ('Herbes de Provence','Cuillère à café',1),
 ('Paprika','Cuillère à café',2.5),
 ('Cannelle','Cuillère à café',2.5),
 ('Extrait de vanille','Millilitre',1),
 ('Vinaigre de cidre','Millilitre',1),
 ('Sauce sriracha','Millilitre',1.1),
 ('Maïzena','Cuillère à café',3),
 ('Vanille (gousse)','Pièce',3),
 ('Blanc de poulet','Pièce',180),
 ('Maïzena','Pointe de couteau',0.5)
) AS v(nom,unite,grams)
JOIN public.official_ingredients i ON public.mealio_reference_key(i.nom)=public.mealio_reference_key(v.nom)
ON CONFLICT(ingredient_id,unite) DO NOTHING;
COMMIT;
