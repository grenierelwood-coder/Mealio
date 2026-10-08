-- MEALIO UNIQUEMENT. Exécuter avant de démarrer le code 1.2.4.
-- Transaction et script réexécutable. Aucun stock ni compte n'est modifié.
BEGIN;
ALTER TABLE public.ai_resolution_log ADD COLUMN IF NOT EXISTS reference_signature text;

-- Retrait limité aux deux associations incorrectes observées dans l'export.
DELETE FROM public.ingredient_synonyms
WHERE (id = 'a6b2370b-fdbb-4532-a500-4d3be3f038b9'
       AND ingredient_id = 'c9eb690b-2ded-46d3-aed6-05ef0ca18aba')
   OR (id = '61adca7f-af82-4f92-b45e-6c917efcbec8'
       AND ingredient_id = '93728171-5b72-42eb-97e6-5d8a083892ce');

-- Ne pas réutiliser ces propositions dangereuses depuis la mémoire.
UPDATE public.ai_resolution_log SET statut = 'rejete'
WHERE statut = 'en_attente'
  AND ((lower(mot_recette) = 'ail en poudre'
        AND ingredient_id_propose = '93728171-5b72-42eb-97e6-5d8a083892ce')
    OR (mot_recette = 'Saucisses bretonnes (ou saucisses fraîches)'
        AND ingredient_id_propose = 'dbe202ff-ed87-4112-80fb-a51d607f1a7d'));

INSERT INTO public.official_ingredients
  (nom, categorie, rayon, unite_reference, default_storage, default_is_fridge)
VALUES
  ('Cocos de Paimpol AOP écossés', 'Légumineuses', 'Fruits & légumes', 'Gramme', 'frosti', true),
  ('Poitrine de porc fumée', 'Charcuterie', 'Charcuterie', 'Gramme', 'frosti', true),
  ('Bouquet garni', 'Herbes fraîches & Aromates', 'Fruits & légumes', 'Pièce', 'frosti', true),
  ('Saucisse fraîche', 'Viandes', 'Boucherie', 'Gramme', 'frosti', true),
  ('Oignon', 'Légumes frais', 'Fruits & légumes', 'Pièce', 'cellio', false),
  ('Ail en poudre', 'Épices & Herbes séchées', 'Épicerie', 'Gramme', 'cellio', false)
ON CONFLICT (nom) DO NOTHING;

-- Libellé explicite : un bouquet vendu comme unité, pas une feuille isolée.
INSERT INTO public.ingredient_synonyms (mot_recette, ingredient_id)
SELECT 'Bouquet garni (thym, laurier)', id
FROM public.official_ingredients o
WHERE o.nom = 'Bouquet garni'
  AND NOT EXISTS (SELECT 1 FROM public.ingredient_synonyms s
                 WHERE lower(s.mot_recette) = lower('Bouquet garni (thym, laurier)'));
COMMIT;

-- Résultat à vérifier après exécution.
SELECT nom, unite_reference, default_storage
FROM public.official_ingredients
WHERE nom IN ('Cocos de Paimpol AOP écossés','Poitrine de porc fumée',
             'Bouquet garni','Saucisse fraîche','Oignon','Ail en poudre');
