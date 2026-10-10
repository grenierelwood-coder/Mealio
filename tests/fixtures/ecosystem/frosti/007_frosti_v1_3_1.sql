-- Ecosystem fields: apply after the prior stock migrations. Historical values are untouched.
BEGIN;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS preparation_id uuid;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS recipe_id uuid;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS portions_per_unit numeric CHECK(portions_per_unit>0 AND portions_per_unit<'Infinity'::numeric);
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS date_fabrication date;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS millesime text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS domaine text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS format text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS ingredient_id uuid;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS ingredient_name text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS content_quantity numeric;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS content_unit text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS product_type text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS preparation_origin text;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS date_role text NOT NULL DEFAULT 'unknown';
CREATE INDEX IF NOT EXISTS items_household_ingredient ON public.items(user_id,ingredient_id);
CREATE TABLE IF NOT EXISTS public.ingredient_catalog(id uuid PRIMARY KEY, name text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.ingredient_catalog ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ingredient_catalog FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.ingredient_catalog TO service_role;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='items_ecosystem_metadata' AND conrelid='public.items'::regclass) THEN
  ALTER TABLE public.items ADD CONSTRAINT items_ecosystem_metadata CHECK(
   ((content_quantity IS NULL AND content_unit IS NULL) OR (content_quantity IS NOT NULL AND content_unit IS NOT NULL AND content_quantity>0 AND content_quantity<'Infinity'::numeric AND content_unit IN ('g','mL','pièce(s)'))) AND
   (product_type IS NULL OR product_type IN ('food','beverage','wine')) AND
   (preparation_origin IS NULL OR preparation_origin IN ('bought','homemade')) AND
   date_role IN ('unknown','dlc','ddm','apogee','indicative') AND
   (date_role NOT IN ('dlc','ddm','apogee') OR date_peremption IS NOT NULL)
  );
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.frosti_stock_action(
 p_user uuid,p_operation uuid,p_action text,p_item uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item public.items; target public.freezers; amount numeric; op public.frosti_operations;
 result jsonb; original uuid; m public.stock_movements; current_row jsonb; snapshot public.items;
 request_value jsonb; found_count integer; matching public.items; default_days integer;
BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR p_payload IS NULL THEN RAISE EXCEPTION 'Opération incomplète.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('frosti.stock:'||p_user::text,0));
 request_value:=jsonb_build_object('action',p_action,'item',p_item,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_operation::text,0));
 SELECT * INTO op FROM public.frosti_operations WHERE user_id=p_user AND operation_id=p_operation;
 IF FOUND THEN
  IF op.request<>request_value THEN RAISE EXCEPTION 'Identifiant déjà utilisé pour une autre opération.'; END IF;
  RETURN op.result;
 END IF;
 INSERT INTO public.frosti_operations(user_id,operation_id,request) VALUES(p_user,p_operation,request_value);
 PERFORM set_config('frosti.operation_id',p_operation::text,true);
 PERFORM set_config('frosti.kind',p_action,true);
 PERFORM set_config('frosti.origin',CASE WHEN p_payload->>'origin'='mealio' THEN 'mealio' ELSE 'frosti' END,true);
 IF p_action='undo' THEN
  original:=(p_payload->>'operation_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||original::text,0));
  SELECT count(*) INTO found_count FROM public.stock_movements WHERE user_id=p_user AND operation_id=original;
  IF found_count=0 THEN RAISE EXCEPTION 'Mouvement introuvable.'; END IF;
  -- Lock all involved lots in a deterministic order, then verify every snapshot.
  PERFORM 1 FROM public.items WHERE id IN(SELECT item_id FROM public.stock_movements WHERE user_id=p_user AND operation_id=original) ORDER BY id FOR UPDATE;
  FOR m IN SELECT * FROM public.stock_movements WHERE user_id=p_user AND operation_id=original ORDER BY created_at,id LOOP
   IF m.origin='mealio' AND m.kind<>'inventory' THEN RAISE EXCEPTION 'Cette opération est coordonnée par Mealio. Corrigez le stock par un inventaire pour conserver son journal.'; END IF;
   IF m.undone_by IS NOT NULL OR m.kind='undo' THEN RAISE EXCEPTION 'Mouvement déjà annulé ou non annulable.'; END IF;
   SELECT to_jsonb(i) INTO current_row FROM public.items i WHERE i.id=m.item_id;
   IF current_row IS DISTINCT FROM (CASE WHEN m.after_row IS NULL THEN NULL ELSE to_jsonb(jsonb_populate_record(NULL::public.items,m.after_row))||jsonb_build_object('date_role',COALESCE(m.after_row->>'date_role','unknown')) END) THEN RAISE EXCEPTION 'Ce lot a changé depuis. Corrigez-le par un inventaire.'; END IF;
  END LOOP;
  FOR m IN SELECT * FROM public.stock_movements WHERE user_id=p_user AND operation_id=original ORDER BY created_at,id LOOP
   IF m.before_row IS NULL THEN
    DELETE FROM public.items WHERE id=m.item_id AND user_id=p_user;
   ELSE
    snapshot:=jsonb_populate_record(NULL::public.items,m.before_row);
    IF NOT EXISTS(SELECT 1 FROM public.freezers WHERE id=snapshot.congelo_id AND user_id=p_user AND archived_at IS NULL) THEN
     RAISE EXCEPTION 'Réactivez l’emplacement avant d’annuler.';
    END IF;
    IF m.after_row IS NULL THEN
     INSERT INTO public.items(id,created_at,user_id,congelo_id,categorie,produit,qte,unite,date_entree,date_peremption,notes,version,date_kind,date_fabrication,millesime,domaine,format,ingredient_id,ingredient_name,content_quantity,content_unit,product_type,preparation_origin,date_role,preparation_id,recipe_id,portions_per_unit)
     VALUES(snapshot.id,snapshot.created_at,p_user,snapshot.congelo_id,snapshot.categorie,snapshot.produit,snapshot.qte,snapshot.unite,snapshot.date_entree,snapshot.date_peremption,snapshot.notes,snapshot.version+1,COALESCE(snapshot.date_kind,'declared'),snapshot.date_fabrication,snapshot.millesime,snapshot.domaine,snapshot.format,snapshot.ingredient_id,snapshot.ingredient_name,snapshot.content_quantity,snapshot.content_unit,snapshot.product_type,snapshot.preparation_origin,COALESCE(snapshot.date_role,'unknown'),snapshot.preparation_id,snapshot.recipe_id,snapshot.portions_per_unit);
    ELSE
     UPDATE public.items SET congelo_id=snapshot.congelo_id,categorie=snapshot.categorie,produit=snapshot.produit,qte=snapshot.qte,unite=snapshot.unite,date_entree=snapshot.date_entree,date_peremption=snapshot.date_peremption,date_kind=COALESCE(snapshot.date_kind,'declared'),notes=snapshot.notes,date_fabrication=snapshot.date_fabrication,millesime=snapshot.millesime,domaine=snapshot.domaine,format=snapshot.format,ingredient_id=snapshot.ingredient_id,ingredient_name=snapshot.ingredient_name,content_quantity=snapshot.content_quantity,content_unit=snapshot.content_unit,product_type=snapshot.product_type,preparation_origin=snapshot.preparation_origin,date_role=COALESCE(snapshot.date_role,'unknown'),preparation_id=snapshot.preparation_id,recipe_id=snapshot.recipe_id,portions_per_unit=snapshot.portions_per_unit
     WHERE id=m.item_id AND user_id=p_user;
    END IF;
   END IF;
  END LOOP;
  UPDATE public.stock_movements SET undone_by=p_operation WHERE user_id=p_user AND operation_id=original;
  result:=jsonb_build_object('operation_id',p_operation);
 ELSIF p_action='add' THEN
  SELECT * INTO target FROM public.freezers WHERE id=(p_payload->>'congelo_id')::uuid AND user_id=p_user AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Emplacement indisponible pour ce foyer.'; END IF;
  -- Defaults are applied after the immutable request receipt is checked.
  IF p_payload->>'apply_default_expiry'='true' AND NULLIF(p_payload->>'date_peremption','') IS NULL AND COALESCE(p_payload->>'product_type','food')<>'wine' THEN
   SELECT CASE WHEN target.is_fridge THEN fridge_default_days ELSE freezer_default_days END INTO default_days
   FROM public.alert_rules WHERE user_id::text=p_user::text AND categorie=trim(p_payload->>'categorie');
   IF default_days BETWEEN 1 AND 3650 THEN p_payload:=p_payload||jsonb_build_object('date_peremption',(COALESCE((p_payload->>'date_entree')::date,(now() AT TIME ZONE 'Europe/Paris')::date)+default_days)::text,'date_kind','estimated','date_role','indicative'); END IF;
  END IF;
  amount:=(p_payload->>'qte')::numeric;
  IF amount IS NULL OR NOT(amount>0 AND amount<'Infinity'::numeric) THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;
  IF COALESCE(trim(p_payload->>'produit'),'')='' OR COALESCE(trim(p_payload->>'categorie'),'')='' THEN RAISE EXCEPTION 'Produit et catégorie obligatoires.'; END IF;
  SELECT * INTO matching FROM public.items i WHERE p_payload->>'merge_exact'='true' AND i.user_id=p_user AND i.congelo_id=target.id AND i.produit IS NOT DISTINCT FROM trim(p_payload->>'produit') AND i.categorie IS NOT DISTINCT FROM trim(p_payload->>'categorie') AND i.unite IS NOT DISTINCT FROM COALESCE(NULLIF(trim(p_payload->>'unite'),''),'pièce(s)') AND i.date_entree IS NOT DISTINCT FROM COALESCE((p_payload->>'date_entree')::date,CURRENT_DATE) AND i.date_peremption IS NOT DISTINCT FROM (p_payload->>'date_peremption')::date AND i.date_kind IS NOT DISTINCT FROM COALESCE(p_payload->>'date_kind','declared') AND i.notes IS NOT DISTINCT FROM p_payload->>'notes' AND i.millesime IS NOT DISTINCT FROM p_payload->>'millesime' AND i.domaine IS NOT DISTINCT FROM p_payload->>'domaine' AND i.format IS NOT DISTINCT FROM p_payload->>'format' AND i.date_fabrication IS NOT DISTINCT FROM (p_payload->>'date_fabrication')::date AND i.ingredient_id IS NOT DISTINCT FROM (p_payload->>'ingredient_id')::uuid AND i.content_quantity IS NOT DISTINCT FROM (p_payload->>'content_quantity')::numeric AND i.content_unit IS NOT DISTINCT FROM (p_payload->>'content_unit') AND i.product_type IS NOT DISTINCT FROM (p_payload->>'product_type') AND i.preparation_origin IS NOT DISTINCT FROM (p_payload->>'preparation_origin') AND i.date_role IS NOT DISTINCT FROM COALESCE(p_payload->>'date_role','unknown') AND i.preparation_id IS NOT DISTINCT FROM (p_payload->>'preparation_id')::uuid AND i.recipe_id IS NOT DISTINCT FROM (p_payload->>'recipe_id')::uuid AND i.portions_per_unit IS NOT DISTINCT FROM (p_payload->>'portions_per_unit')::numeric ORDER BY i.created_at,i.id LIMIT 1 FOR UPDATE;
  IF FOUND THEN UPDATE public.items SET qte=qte+amount WHERE id=matching.id RETURNING * INTO item;
  ELSE
  INSERT INTO public.items(user_id,congelo_id,produit,categorie,qte,unite,date_entree,date_peremption,notes,date_kind,date_fabrication,millesime,domaine,format,ingredient_id,ingredient_name,content_quantity,content_unit,product_type,preparation_origin,date_role,preparation_id,recipe_id,portions_per_unit)
  VALUES(p_user,target.id,trim(p_payload->>'produit'),trim(p_payload->>'categorie'),amount,COALESCE(NULLIF(trim(p_payload->>'unite'),''),'pièce(s)'),COALESCE((p_payload->>'date_entree')::date,CURRENT_DATE),(p_payload->>'date_peremption')::date,p_payload->>'notes',COALESCE(p_payload->>'date_kind','declared'),(p_payload->>'date_fabrication')::date,p_payload->>'millesime',p_payload->>'domaine',p_payload->>'format',(p_payload->>'ingredient_id')::uuid,p_payload->>'ingredient_name',(p_payload->>'content_quantity')::numeric,p_payload->>'content_unit',p_payload->>'product_type',p_payload->>'preparation_origin',COALESCE(p_payload->>'date_role','unknown'),(p_payload->>'preparation_id')::uuid,(p_payload->>'recipe_id')::uuid,(p_payload->>'portions_per_unit')::numeric) RETURNING * INTO item;
  END IF;
  result:=to_jsonb(item);
 ELSE
  SELECT * INTO item FROM public.items WHERE id=p_item AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot introuvable pour ce foyer.'; END IF;
  IF (p_action IN('edit','inventory','merge') OR p_payload ? 'version') AND (p_payload->>'version')::bigint IS DISTINCT FROM item.version THEN
   RAISE EXCEPTION 'Le lot a changé sur un autre appareil. Actualisez avant de corriger.';
  END IF;
  IF p_action IN('use','discard') THEN
   amount:=(p_payload->>'amount')::numeric;
   IF amount IS NULL OR NOT(amount>0 AND amount<'Infinity'::numeric) OR amount>item.qte THEN RAISE EXCEPTION 'Quantité supérieure au stock disponible ou invalide.'; END IF;
   IF amount=item.qte THEN
    DELETE FROM public.items WHERE id=item.id RETURNING * INTO item; item.qte:=0;
   ELSE
    UPDATE public.items SET qte=qte-amount WHERE id=item.id RETURNING * INTO item;
   END IF;
  ELSIF p_action IN('transfer','merge') THEN
   IF p_action='merge' THEN
    SELECT * INTO target FROM public.freezers WHERE id=item.congelo_id AND user_id=p_user AND archived_at IS NULL FOR SHARE;
    amount:=item.qte;
   ELSE
    SELECT * INTO target FROM public.freezers WHERE id=(p_payload->>'congelo_id')::uuid AND user_id=p_user AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND OR target.id=item.congelo_id THEN RAISE EXCEPTION 'Choisissez un autre emplacement de ce foyer.'; END IF;
    amount:=(p_payload->>'amount')::numeric;
   END IF;
   IF target.id IS NULL THEN RAISE EXCEPTION 'Emplacement indisponible.'; END IF;
   IF amount IS NULL OR NOT(amount>0 AND amount<'Infinity'::numeric) OR amount>item.qte THEN RAISE EXCEPTION 'Quantité à déplacer invalide.'; END IF;
   SELECT * INTO matching FROM public.items i
    WHERE i.user_id=p_user AND i.congelo_id=target.id AND i.id<>item.id
     AND i.produit IS NOT DISTINCT FROM item.produit
     AND i.categorie IS NOT DISTINCT FROM item.categorie
     AND i.unite IS NOT DISTINCT FROM item.unite
     AND i.date_entree IS NOT DISTINCT FROM item.date_entree
     AND i.date_peremption IS NOT DISTINCT FROM item.date_peremption
     AND i.date_kind IS NOT DISTINCT FROM item.date_kind
     AND i.notes IS NOT DISTINCT FROM item.notes
     AND i.millesime IS NOT DISTINCT FROM item.millesime AND i.domaine IS NOT DISTINCT FROM item.domaine AND i.format IS NOT DISTINCT FROM item.format
     AND i.date_fabrication IS NOT DISTINCT FROM item.date_fabrication
     AND i.ingredient_id IS NOT DISTINCT FROM item.ingredient_id
     AND i.content_quantity IS NOT DISTINCT FROM item.content_quantity
     AND i.content_unit IS NOT DISTINCT FROM item.content_unit
     AND i.product_type IS NOT DISTINCT FROM item.product_type
     AND i.preparation_origin IS NOT DISTINCT FROM item.preparation_origin
     AND i.date_role IS NOT DISTINCT FROM item.date_role AND i.preparation_id IS NOT DISTINCT FROM item.preparation_id AND i.recipe_id IS NOT DISTINCT FROM item.recipe_id AND i.portions_per_unit IS NOT DISTINCT FROM item.portions_per_unit
    ORDER BY i.created_at,i.id LIMIT 1 FOR UPDATE;
   IF FOUND THEN
    UPDATE public.items SET qte=qte+amount WHERE id=matching.id RETURNING * INTO matching;
    IF amount=item.qte THEN
     DELETE FROM public.items WHERE id=item.id;
    ELSE
     UPDATE public.items SET qte=qte-amount WHERE id=item.id;
    END IF;
    item:=matching;
   ELSIF p_action='merge' THEN
    RAISE EXCEPTION 'Aucun autre lot strictement identique dans cet équipement. Les dates, unité, catégorie et notes doivent correspondre.';
   ELSIF amount=item.qte THEN
    UPDATE public.items SET congelo_id=target.id WHERE id=item.id RETURNING * INTO item;
   ELSE
    INSERT INTO public.items(user_id,congelo_id,categorie,produit,qte,unite,date_entree,date_peremption,notes,date_kind,date_fabrication,millesime,domaine,format,ingredient_id,ingredient_name,content_quantity,content_unit,product_type,preparation_origin,date_role,preparation_id,recipe_id,portions_per_unit)
    VALUES(p_user,target.id,item.categorie,item.produit,amount,item.unite,item.date_entree,item.date_peremption,item.notes,item.date_kind,item.date_fabrication,item.millesime,item.domaine,item.format,item.ingredient_id,item.ingredient_name,item.content_quantity,item.content_unit,item.product_type,item.preparation_origin,COALESCE(item.date_role,'unknown'),item.preparation_id,item.recipe_id,item.portions_per_unit);
    UPDATE public.items SET qte=qte-amount WHERE id=item.id RETURNING * INTO item;
   END IF;
  ELSIF p_action='inventory' THEN
   IF (p_payload->>'qte')::numeric=0 THEN
    DELETE FROM public.items WHERE id=item.id RETURNING * INTO item; item.qte:=0;
   ELSE
    UPDATE public.items SET qte=(p_payload->>'qte')::numeric WHERE id=item.id RETURNING * INTO item;
   END IF;
  ELSIF p_action='edit' THEN
   IF item.content_quantity IS NOT NULL AND p_payload->>'content_quantity' IS NOT NULL AND trim(p_payload->>'unite') IS DISTINCT FROM item.unite THEN RAISE EXCEPTION 'Retirez ou corrigez le conditionnement avant de changer l’unité.'; END IF;
   IF COALESCE(trim(p_payload->>'produit'),'')='' OR COALESCE(trim(p_payload->>'categorie'),'')='' OR COALESCE(trim(p_payload->>'unite'),'')='' THEN RAISE EXCEPTION 'Produit, catégorie et unité obligatoires.'; END IF;
   IF (p_payload->>'qte')::numeric=0 THEN
    DELETE FROM public.items WHERE id=item.id RETURNING * INTO item; item.qte:=0;
   ELSE
   UPDATE public.items SET produit=trim(p_payload->>'produit'),categorie=trim(p_payload->>'categorie'),qte=(p_payload->>'qte')::numeric,unite=trim(p_payload->>'unite'),date_entree=(p_payload->>'date_entree')::date,date_peremption=(p_payload->>'date_peremption')::date,date_kind=COALESCE(p_payload->>'date_kind','declared'),notes=p_payload->>'notes',date_fabrication=(p_payload->>'date_fabrication')::date,millesime=CASE WHEN p_payload ? 'millesime' THEN p_payload->>'millesime' ELSE item.millesime END,domaine=CASE WHEN p_payload ? 'domaine' THEN p_payload->>'domaine' ELSE item.domaine END,format=CASE WHEN p_payload ? 'format' THEN p_payload->>'format' ELSE item.format END,ingredient_id=(p_payload->>'ingredient_id')::uuid,ingredient_name=p_payload->>'ingredient_name',content_quantity=(p_payload->>'content_quantity')::numeric,content_unit=p_payload->>'content_unit',product_type=p_payload->>'product_type',preparation_origin=p_payload->>'preparation_origin',date_role=COALESCE(p_payload->>'date_role','unknown'),preparation_id=item.preparation_id,recipe_id=item.recipe_id,portions_per_unit=item.portions_per_unit WHERE id=item.id RETURNING * INTO item;
   END IF;
  ELSE RAISE EXCEPTION 'Action inconnue.';
  END IF;
  result:=to_jsonb(item);
 END IF;
 UPDATE public.frosti_operations SET result=result_value.value FROM (SELECT result AS value) result_value WHERE user_id=p_user AND operation_id=p_operation;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.frosti_inventory_batch(p_user uuid,p_operation uuid,p_rows jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 DECLARE op public.frosti_operations; r jsonb; i public.items; result jsonb := '[]'; req jsonb;
 BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Inventaire invalide.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('frosti.stock:'||p_user::text,0));
 req:=jsonb_build_object('action','inventory_batch','rows',p_rows);
 SELECT * INTO op FROM public.frosti_operations WHERE user_id=p_user AND operation_id=p_operation;
 IF FOUND THEN IF op.request<>req THEN RAISE EXCEPTION 'Identifiant déjà utilisé.'; END IF; RETURN op.result; END IF;
 IF (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) THEN RAISE EXCEPTION 'Doublon.'; END IF;
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  SELECT * INTO i FROM public.items WHERE id=(r->>'id')::uuid AND user_id=p_user FOR UPDATE;
  IF NOT FOUND OR i.version IS DISTINCT FROM (r->>'version')::bigint THEN RAISE EXCEPTION 'Le lot a changé. Actualisez l’inventaire.'; END IF;
  IF i.content_quantity IS NOT NULL AND trim(r->>'unite') IS DISTINCT FROM i.unite THEN RAISE EXCEPTION 'Ce lot possède un contenu par unité : corrigez le conditionnement dans l’application source.'; END IF;
  IF r->>'unite' IS NULL OR trim(r->>'unite')='' OR (r->>'qte')::numeric IS NULL OR NOT((r->>'qte')::numeric>=0 AND (r->>'qte')::numeric<'Infinity'::numeric) THEN RAISE EXCEPTION 'Correction invalide.'; END IF;
 END LOOP;
 PERFORM set_config('frosti.operation_id',p_operation::text,true);
 PERFORM set_config('frosti.kind','inventory',true); PERFORM set_config('frosti.origin','mealio',true);
 FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  IF (r->>'qte')::numeric=0 THEN DELETE FROM public.items WHERE id=(r->>'id')::uuid AND user_id=p_user RETURNING * INTO i;
  ELSE UPDATE public.items SET qte=(r->>'qte')::numeric,unite=trim(r->>'unite') WHERE id=(r->>'id')::uuid AND user_id=p_user RETURNING * INTO i; END IF;
  result:=result||jsonb_build_array(to_jsonb(i));
 END LOOP;
 INSERT INTO public.frosti_operations(user_id,operation_id,request,result) VALUES(p_user,p_operation,req,result);
 RETURN result;
 END $$;
 REVOKE ALL ON FUNCTION public.frosti_inventory_batch(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
 GRANT EXECUTE ON FUNCTION public.frosti_inventory_batch(uuid,uuid,jsonb) TO service_role;
COMMIT;
