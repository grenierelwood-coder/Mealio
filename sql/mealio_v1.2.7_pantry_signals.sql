-- Supabase MEALIO, après 1.2.6 et avant le code 1.2.7.
BEGIN;
CREATE TABLE IF NOT EXISTS public.household_pantry_signals (
  user_id text NOT NULL CHECK (length(trim(user_id)) > 0),
  ingredient_id uuid NOT NULL REFERENCES public.official_ingredients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('almost_finished','history_snooze')),
  signaled_at timestamptz NOT NULL DEFAULT now(),
  until_date date,
  PRIMARY KEY (user_id, ingredient_id, kind),
  CHECK ((kind='almost_finished' AND until_date IS NULL) OR (kind='history_snooze' AND until_date IS NOT NULL))
);
ALTER TABLE public.household_pantry_signals ENABLE ROW LEVEL SECURITY;
-- Pas d'accès direct navigateur. Les routes serveur filtrent le nom de foyer de la session.
CREATE INDEX IF NOT EXISTS shopping_purchase_events_list_history_idx
  ON public.shopping_purchase_events (list_id, purchased_at DESC, id DESC);
-- Serialize alert additions for a household: parallel clicks create one list/line.
CREATE OR REPLACE FUNCTION public.add_pantry_alert_to_courses(
  p_user_id text, p_ingredient_id uuid, p_produit text, p_quantity numeric, p_unite text
) RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_list_id uuid;
  v_item public.shopping_items%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR length(trim(p_user_id))=0 OR p_ingredient_id IS NULL
    OR p_quantity IS NULL OR p_quantity <= 0 OR p_quantity::text IN ('NaN','Infinity','-Infinity')
    OR p_unite IS NULL OR length(trim(p_unite))=0 THEN
    RAISE EXCEPTION 'Paramètres épicerie invalides';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('mealio-pantry:' || p_user_id));
  SELECT id INTO v_list_id FROM public.shopping_lists
    WHERE user_id=p_user_id AND status='en_cours' ORDER BY created_at DESC,id LIMIT 1 FOR UPDATE;
  IF v_list_id IS NULL THEN
    INSERT INTO public.shopping_lists(user_id,name,status) VALUES(p_user_id,'Courses','en_cours') RETURNING id INTO v_list_id;
  END IF;
  SELECT * INTO v_item FROM public.shopping_items
    WHERE list_id=v_list_id AND ingredient_id=p_ingredient_id AND unite=p_unite ORDER BY id LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('item',to_jsonb(v_item),'merged',true);
  END IF;
  INSERT INTO public.shopping_items(list_id,produit,ingredient_id,qte,qte_achat,pantry_pack_quantity,qte_achetee,unite,is_checked,is_manual)
    VALUES(v_list_id,p_produit,p_ingredient_id,p_quantity,p_quantity,p_quantity,0,p_unite,false,false)
    RETURNING * INTO v_item;
  RETURN jsonb_build_object('item',to_jsonb(v_item),'merged',false);
END;
$$;
-- Only authenticated server routes with the service key may invoke it.
REVOKE ALL ON FUNCTION public.add_pantry_alert_to_courses(text,uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.add_pantry_alert_to_courses(text,uuid,text,numeric,text) TO service_role;
COMMIT;
