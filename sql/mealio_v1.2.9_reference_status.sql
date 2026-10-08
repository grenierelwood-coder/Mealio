-- Diagnostic en lecture seule ; exécuter dans Mealio après le premier SQL 1.2.8.
-- 1. Demandes par nature/statut. Ce ne sont pas des conversions actives.
SELECT kind, status, count(*) AS demandes
FROM public.reference_enrichment_review
GROUP BY kind, status ORDER BY kind, status;

-- 2. Dossiers vérifiés : le second SQL 1.2.8 active alias/unit_mass seulement.
SELECT request_key, kind, source_label, ingredient_name, unite, value,
       measurement_note, status
FROM public.reference_enrichment_review
WHERE status = 'verified'
ORDER BY kind, ingredient_name, source_label;

-- 3. Conversions de masse actuellement actives (tous les ingrédients).
SELECT i.nom, i.unite_reference, d.unite, d.poids_g_approx, d.source_note
FROM public.ingredient_densities d
JOIN public.official_ingredients i ON i.id = d.ingredient_id
ORDER BY i.nom, d.unite;

-- 4. Données actives sur les trois ingrédients signalés.
SELECT i.id, i.nom, i.unite_reference,
       (SELECT jsonb_agg(s.mot_recette ORDER BY s.mot_recette)
        FROM public.ingredient_synonyms s WHERE s.ingredient_id=i.id) AS synonymes,
       (SELECT jsonb_agg(jsonb_build_object('unite', d.unite, 'grammes_par_unite', d.poids_g_approx)
                         ORDER BY d.unite)
        FROM public.ingredient_densities d WHERE d.ingredient_id=i.id) AS equivalences
FROM public.official_ingredients i
WHERE i.nom IN ('Ail', 'Oignon', 'Saucisse fraîche')
ORDER BY i.nom;

-- 5. Dossiers à examiner : lire les champs complets, pas seulement source_note.
SELECT request_key, kind, source_label, ingredient_name, unite, value,
       source_note, measurement_note, status
FROM public.reference_enrichment_review
WHERE status = 'pending'
ORDER BY kind, ingredient_name NULLS LAST, source_label;
