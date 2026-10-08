-- OPTIONNEL : après avoir complété les mesures/associations vérifiées dans reference_enrichment_review.
-- Ne concerne ni les recettes ni les relations tête/gousse/conditionnement.
BEGIN;
CREATE TEMP TABLE enrichment_session_marker(dummy boolean) ON COMMIT DROP;
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


DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.reference_enrichment_review WHERE status='verified' AND kind='alias'
   GROUP BY pg_temp.mealio_key(source_label) HAVING count(DISTINCT ingredient_name)>1) THEN
   RAISE EXCEPTION 'Alias vérifiés contradictoires dans le lot';
 END IF;
 IF EXISTS(SELECT 1 FROM public.reference_enrichment_review WHERE status='verified' AND kind='unit_mass'
   GROUP BY ingredient_name,unite HAVING count(DISTINCT value)>1) THEN
   RAISE EXCEPTION 'Mesures vérifiées contradictoires dans le lot';
 END IF;
 IF EXISTS(SELECT 1 FROM public.reference_enrichment_review r
   JOIN public.official_ingredients i ON pg_temp.mealio_key(i.nom)=pg_temp.mealio_key(r.source_label)
   WHERE r.status='verified' AND r.kind='alias' AND i.nom<>r.ingredient_name) THEN
   RAISE EXCEPTION 'Un alias ne peut pas détourner le nom exact d’un ingrédient officiel';
 END IF;
 IF EXISTS(SELECT 1 FROM public.reference_enrichment_review r WHERE r.status='verified' AND r.kind='unit_mass'
   AND (r.value IS NULL OR r.value<=0 OR coalesce(trim(r.measurement_note),'')='' OR
     NOT EXISTS(SELECT 1 FROM public.official_ingredients i WHERE i.nom=r.ingredient_name) OR
     NOT EXISTS(SELECT 1 FROM public.unit_mappings u WHERE u.unite=r.unite))) THEN
   RAISE EXCEPTION 'Mesure vérifiée incomplète : valeur positive, note de mesure, ingrédient et unité existants obligatoires';
 END IF;
 IF EXISTS(SELECT 1 FROM public.reference_enrichment_review r WHERE r.status='verified' AND r.kind='alias'
   AND NOT EXISTS(SELECT 1 FROM public.official_ingredients i WHERE i.nom=r.ingredient_name)) THEN
   RAISE EXCEPTION 'Alias vérifié : ingrédient officiel cible introuvable';
 END IF;
 IF EXISTS(SELECT 1 FROM public.reference_enrichment_review r
   JOIN public.official_ingredients i ON i.nom=r.ingredient_name
   JOIN public.ingredient_synonyms sy ON pg_temp.mealio_key(sy.mot_recette)=pg_temp.mealio_key(r.source_label)
   WHERE r.status='verified' AND r.kind='alias' AND sy.ingredient_id<>i.id) THEN
   RAISE EXCEPTION 'Alias existant vers une autre cible : corriger explicitement cette association avant activation';
 END IF;
 IF EXISTS(SELECT 1 FROM public.reference_enrichment_review r
   JOIN public.official_ingredients i ON i.nom=r.ingredient_name
   JOIN public.ingredient_densities d ON d.ingredient_id=i.id AND d.unite=r.unite
   WHERE r.status='verified' AND r.kind='unit_mass' AND abs(d.poids_g_approx-r.value)>0.000001) THEN
   RAISE EXCEPTION 'Densité existante différente : corriger explicitement dans Admin avant activation';
 END IF;
END $$;
INSERT INTO public.ingredient_synonyms(mot_recette,ingredient_id)
SELECT DISTINCT ON(pg_temp.mealio_key(r.source_label)) r.source_label,i.id
FROM public.reference_enrichment_review r JOIN public.official_ingredients i ON i.nom=r.ingredient_name
WHERE r.status='verified' AND r.kind='alias'
  AND NOT EXISTS(SELECT 1 FROM public.ingredient_synonyms sy WHERE pg_temp.mealio_key(sy.mot_recette)=pg_temp.mealio_key(r.source_label))
ORDER BY pg_temp.mealio_key(r.source_label),r.source_label;
INSERT INTO public.ingredient_densities(ingredient_id,unite,poids_g_approx,source_note)
SELECT DISTINCT ON(i.id,r.unite) i.id,r.unite,r.value,r.measurement_note
FROM public.reference_enrichment_review r JOIN public.official_ingredients i ON i.nom=r.ingredient_name
WHERE r.status='verified' AND r.kind='unit_mass' AND r.value>0
  AND NOT EXISTS(SELECT 1 FROM public.ingredient_densities d WHERE d.ingredient_id=i.id AND d.unite=r.unite)
ORDER BY i.id,r.unite,r.request_key;
COMMIT;
