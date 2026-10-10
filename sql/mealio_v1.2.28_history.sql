-- Exécuter dans Supabase MEALIO uniquement, avant le code 1.2.28.
-- Aucun stock ni référentiel commun n'est modifié. Les repas passés sont lus depuis le planning.
BEGIN;
CREATE TABLE IF NOT EXISTS public.household_history_decisions (
  user_id text NOT NULL CHECK (length(trim(user_id))>0),
  recommendation_key text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('accepted','snoozed')),
  until_date date,
  PRIMARY KEY(user_id,recommendation_key),
  CHECK ((decision='accepted' AND until_date IS NULL) OR (decision='snoozed' AND until_date IS NOT NULL))
);
ALTER TABLE public.household_history_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.household_history_decisions FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.household_history_decisions TO service_role;
CREATE OR REPLACE FUNCTION public.activate_history_replenishment(
 p_user_id text,p_key text,p_kind text,p_ingredient_id uuid,p_produit text,p_unite text,
 p_quantity numeric,p_minimum numeric,p_interval_days integer,p_next_due_date date
) RETURNS jsonb LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE v_id uuid; v_existing boolean;
BEGIN
 IF p_user_id IS NULL OR length(trim(p_user_id))=0 OR p_ingredient_id IS NULL
 OR p_kind IS NULL OR p_kind NOT IN ('threshold','recurring')
 OR p_key IS DISTINCT FROM p_kind||':'||p_ingredient_id::text
 OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity>1000000000
 OR p_quantity::text IN ('NaN','Infinity','-Infinity')
 OR p_produit IS NULL OR length(trim(p_produit))=0 OR p_unite IS NULL OR length(trim(p_unite))=0 THEN
   RAISE EXCEPTION 'Paramètres de recommandation invalides';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.official_ingredients WHERE id=p_ingredient_id) THEN
   RAISE EXCEPTION 'Ingrédient officiel introuvable';
 END IF;
 IF p_kind='threshold' AND (p_minimum IS NULL OR p_minimum<0 OR p_minimum>=p_quantity OR p_minimum::text IN ('NaN','Infinity','-Infinity')) THEN
   RAISE EXCEPTION 'Seuil et cible invalides';
 END IF;
 IF p_kind='recurring' AND (p_interval_days IS NULL OR p_interval_days<1 OR p_interval_days>366 OR p_next_due_date IS NULL) THEN
   RAISE EXCEPTION 'Fréquence ou échéance invalide';
 END IF;
 -- Serialize parallel acceptances for the same household and ingredient.
 PERFORM pg_advisory_xact_lock(hashtext('mealio-history:'||p_user_id||':'||p_ingredient_id::text));
 SELECT EXISTS(SELECT 1 FROM public.stock_replenishment_thresholds WHERE user_id=p_user_id AND ingredient_id=p_ingredient_id)
 OR EXISTS(SELECT 1 FROM public.recurring_purchase_rules WHERE user_id=p_user_id AND (ingredient_id=p_ingredient_id OR (ingredient_id IS NULL AND lower(trim(produit))=lower(trim(p_produit)))))
 INTO v_existing;
 IF NOT v_existing THEN
   IF p_kind='threshold' THEN
     INSERT INTO public.stock_replenishment_thresholds(user_id,ingredient_id,min_quantity,target_quantity,unite,active,mode)
     VALUES(p_user_id,p_ingredient_id,p_minimum,p_quantity,p_unite,true,'suggestion')
     ON CONFLICT(user_id,ingredient_id) DO NOTHING RETURNING id INTO v_id;
     v_existing:=v_id IS NULL;
   ELSE
     INSERT INTO public.recurring_purchase_rules(user_id,ingredient_id,produit,quantity,unite,interval_days,next_due_date,mode,active)
     VALUES(p_user_id,p_ingredient_id,p_produit,p_quantity,p_unite,p_interval_days,p_next_due_date,'suggestion',true)
     RETURNING id INTO v_id;
   END IF;
 END IF;
 INSERT INTO public.household_history_decisions(user_id,recommendation_key,decision,until_date)
 VALUES(p_user_id,p_key,'accepted',NULL)
 ON CONFLICT(user_id,recommendation_key) DO UPDATE SET decision='accepted',until_date=NULL;
 RETURN jsonb_build_object('rule_id',v_id,'already_exists',v_existing);
END;
$$;
REVOKE ALL ON FUNCTION public.activate_history_replenishment(text,text,text,uuid,text,text,numeric,numeric,integer,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_history_replenishment(text,text,text,uuid,text,text,numeric,numeric,integer,date) TO service_role;
COMMIT;
