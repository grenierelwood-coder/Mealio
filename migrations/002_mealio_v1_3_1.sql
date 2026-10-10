-- Mealio V1.3.1 : reprise métier, préparation liée au planning et droits serveur.
BEGIN;
ALTER TABLE public.shopping_item_stock_transfers ADD COLUMN IF NOT EXISTS request_payload jsonb;
ALTER TABLE public.ecosystem_jobs ADD COLUMN IF NOT EXISTS completed_steps integer NOT NULL DEFAULT 0;
ALTER TABLE public.ecosystem_jobs ADD COLUMN IF NOT EXISTS step_results jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.ecosystem_jobs ADD COLUMN IF NOT EXISTS overrides jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.ecosystem_jobs ADD COLUMN IF NOT EXISTS repair_log jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS public.meal_preparation_links(
 user_id text NOT NULL,meal_plan_id uuid NOT NULL,preparation_id uuid NOT NULL,
 recipe_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,meal_plan_id)
);
ALTER TABLE public.meal_preparation_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meal_preparation_links FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.meal_preparation_links TO service_role;
CREATE UNIQUE INDEX IF NOT EXISTS meal_consumption_household_plan ON public.meal_consumption_events(user_id,meal_plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS shopping_transfer_operation_key ON public.shopping_item_stock_transfers(operation_key);
CREATE OR REPLACE FUNCTION public.mealio_reserve_purchase_stock(p_user text,p_item uuid,p_source text,p_location uuid,p_location_name text,p_rule text,p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item public.shopping_items; existing public.shopping_item_stock_transfers; done numeric; amount numeric; op text; frozen jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('mealio.purchase:'||p_item::text,0));
 SELECT i.* INTO item FROM public.shopping_items i JOIN public.shopping_lists l ON l.id=i.list_id WHERE i.id=p_item AND l.user_id=p_user FOR UPDATE OF i;
 IF NOT FOUND THEN RAISE EXCEPTION 'Achat introuvable pour ce foyer.'; END IF;
 SELECT * INTO existing FROM public.shopping_item_stock_transfers WHERE shopping_item_id=p_item AND status<>'completed' ORDER BY attempted_at,id LIMIT 1 FOR UPDATE;
 IF FOUND THEN RETURN to_jsonb(existing); END IF;
 SELECT COALESCE(sum(quantity),0) INTO done FROM public.shopping_item_stock_transfers WHERE shopping_item_id=p_item AND status='completed';
 IF NOT EXISTS(SELECT 1 FROM public.shopping_item_stock_transfers WHERE shopping_item_id=p_item) THEN done:=GREATEST(done,COALESCE(item.stock_stored_quantity,0)); END IF;
 amount:=GREATEST(COALESCE(item.qte_achetee,0)-done,0);
 IF amount=0 THEN RETURN jsonb_build_object('status','nothing','stored_quantity',done); END IF;
 IF p_source NOT IN('frosti','cellio') OR p_location IS NULL OR jsonb_typeof(p_request)<>'object' THEN RAISE EXCEPTION 'Destination invalide.'; END IF;
 op:='mealio:'||p_item::text||':from:'||done::text||':to:'||(done+amount)::text;
 frozen:=p_request||jsonb_build_object('qte',amount,'source',p_source,CASE WHEN p_source='frosti' THEN 'congelo_id' ELSE 'cellar_id' END,p_location);
 INSERT INTO public.shopping_item_stock_transfers(shopping_item_id,operation_key,storage,location_id,location_name,rule_label,quantity,status,attempted_at,request_payload)
 VALUES(p_item,op,p_source,p_location,p_location_name,p_rule,amount,'pending',now(),frozen) RETURNING * INTO existing;
 RETURN to_jsonb(existing);
END $$;
REVOKE ALL ON FUNCTION public.mealio_reserve_purchase_stock(text,uuid,text,uuid,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mealio_reserve_purchase_stock(text,uuid,text,uuid,text,text,jsonb) TO service_role;
-- Every household table is served through authenticated Mealio routes.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['shopping_lists','shopping_items','shopping_item_stock_transfers','shopping_purchase_events','shopping_issues','meal_plans','meal_consumption_events','ecosystem_jobs','household_pantry_products','household_pantry_signals','household_inventory_reminders','stock_replenishment_thresholds','recurring_purchase_rules','favorite_preferences','household_ingredient_preparations','household_history_decisions'] LOOP
  IF to_regclass('public.'||t) IS NOT NULL THEN
   EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
   EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
   EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO service_role',t);
  END IF;
 END LOOP;
END $$;
ALTER TABLE public.ecosystem_jobs ADD COLUMN IF NOT EXISTS lease_token uuid;
ALTER TABLE public.ecosystem_jobs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
CREATE OR REPLACE FUNCTION public.mealio_claim_job(p_user text,p_id uuid,p_token uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE public.ecosystem_jobs SET lease_token=p_token,lease_until=now()+interval '2 minutes' WHERE id=p_id AND user_id=p_user AND status<>'completed' AND (lease_until IS NULL OR lease_until<now());
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.mealio_claim_job(text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mealio_claim_job(text,uuid,uuid) TO service_role;
COMMIT;
