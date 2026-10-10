-- Frosti V1.1. Executer apres 001, avant de remplacer les sources.
-- Migration additive : aucun lot ni equipement existant n'est supprime.
BEGIN;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS date_kind text NOT NULL DEFAULT 'declared';
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS fridge_default_days integer;
ALTER TABLE public.alert_rules ADD COLUMN IF NOT EXISTS freezer_default_days integer;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='items_date_kind_check' AND conrelid='public.items'::regclass) THEN
  ALTER TABLE public.items ADD CONSTRAINT items_date_kind_check CHECK(date_kind IN ('declared','estimated'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='alert_rules_defaults_check' AND conrelid='public.alert_rules'::regclass) THEN
  ALTER TABLE public.alert_rules ADD CONSTRAINT alert_rules_defaults_check CHECK(
   (fridge_default_days IS NULL OR fridge_default_days BETWEEN 1 AND 3650) AND
   (freezer_default_days IS NULL OR freezer_default_days BETWEEN 1 AND 3650));
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.frosti_stock_action(
 p_user uuid,p_operation uuid,p_action text,p_item uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item public.items; target public.freezers; amount numeric; op public.frosti_operations;
 result jsonb; original uuid; m public.stock_movements; current_row jsonb; snapshot public.items;
 request_value jsonb; found_count integer;
BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR p_payload IS NULL THEN RAISE EXCEPTION 'Opération incomplète.'; END IF;
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
 PERFORM set_config('frosti.origin','frosti',true);
 IF p_action='undo' THEN
  original:=(p_payload->>'operation_id')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||original::text,0));
  SELECT count(*) INTO found_count FROM public.stock_movements WHERE user_id=p_user AND operation_id=original;
  IF found_count=0 THEN RAISE EXCEPTION 'Mouvement introuvable.'; END IF;
  -- Lock all involved lots in a deterministic order, then verify every snapshot.
  PERFORM 1 FROM public.items WHERE id IN(SELECT item_id FROM public.stock_movements WHERE user_id=p_user AND operation_id=original) ORDER BY id FOR UPDATE;
  FOR m IN SELECT * FROM public.stock_movements WHERE user_id=p_user AND operation_id=original ORDER BY created_at,id LOOP
   IF m.undone_by IS NOT NULL OR m.kind='undo' THEN RAISE EXCEPTION 'Mouvement déjà annulé ou non annulable.'; END IF;
   SELECT to_jsonb(i) INTO current_row FROM public.items i WHERE i.id=m.item_id;
   IF current_row IS DISTINCT FROM m.after_row THEN RAISE EXCEPTION 'Ce lot a changé depuis. Corrigez-le par un inventaire.'; END IF;
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
     INSERT INTO public.items(id,created_at,user_id,congelo_id,categorie,produit,qte,unite,date_entree,date_peremption,notes,version,date_kind)
     VALUES(snapshot.id,snapshot.created_at,p_user,snapshot.congelo_id,snapshot.categorie,snapshot.produit,snapshot.qte,snapshot.unite,snapshot.date_entree,snapshot.date_peremption,snapshot.notes,snapshot.version+1,COALESCE(snapshot.date_kind,'declared'));
    ELSE
     UPDATE public.items SET congelo_id=snapshot.congelo_id,categorie=snapshot.categorie,produit=snapshot.produit,qte=snapshot.qte,unite=snapshot.unite,date_entree=snapshot.date_entree,date_peremption=snapshot.date_peremption,date_kind=COALESCE(snapshot.date_kind,'declared'),notes=snapshot.notes
     WHERE id=m.item_id AND user_id=p_user;
    END IF;
   END IF;
  END LOOP;
  UPDATE public.stock_movements SET undone_by=p_operation WHERE user_id=p_user AND operation_id=original;
  result:=jsonb_build_object('operation_id',p_operation);
 ELSIF p_action='add' THEN
  SELECT * INTO target FROM public.freezers WHERE id=(p_payload->>'congelo_id')::uuid AND user_id=p_user AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Emplacement indisponible pour ce foyer.'; END IF;
  amount:=(p_payload->>'qte')::numeric;
  IF amount IS NULL OR NOT(amount>0 AND amount<'Infinity'::numeric) THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;
  IF COALESCE(trim(p_payload->>'produit'),'')='' OR COALESCE(trim(p_payload->>'categorie'),'')='' THEN RAISE EXCEPTION 'Produit et catégorie obligatoires.'; END IF;
  INSERT INTO public.items(user_id,congelo_id,produit,categorie,qte,unite,date_entree,date_peremption,notes,date_kind)
  VALUES(p_user,target.id,trim(p_payload->>'produit'),trim(p_payload->>'categorie'),amount,COALESCE(NULLIF(trim(p_payload->>'unite'),''),'pièce(s)'),COALESCE((p_payload->>'date_entree')::date,CURRENT_DATE),(p_payload->>'date_peremption')::date,p_payload->>'notes',COALESCE(p_payload->>'date_kind','declared')) RETURNING * INTO item;
  result:=to_jsonb(item);
 ELSE
  SELECT * INTO item FROM public.items WHERE id=p_item AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot introuvable pour ce foyer.'; END IF;
  IF p_action IN('edit','inventory') AND (p_payload->>'version')::bigint IS DISTINCT FROM item.version THEN
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
  ELSIF p_action='transfer' THEN
   SELECT * INTO target FROM public.freezers WHERE id=(p_payload->>'congelo_id')::uuid AND user_id=p_user AND archived_at IS NULL FOR SHARE;
   IF NOT FOUND OR target.id=item.congelo_id THEN RAISE EXCEPTION 'Choisissez un autre emplacement de ce foyer.'; END IF;
   amount:=(p_payload->>'amount')::numeric;
   IF amount IS NULL OR NOT(amount>0 AND amount<'Infinity'::numeric) OR amount>item.qte THEN RAISE EXCEPTION 'Quantité à déplacer invalide.'; END IF;
   IF amount=item.qte THEN
    UPDATE public.items SET congelo_id=target.id WHERE id=item.id RETURNING * INTO item;
   ELSE
    INSERT INTO public.items(user_id,congelo_id,categorie,produit,qte,unite,date_entree,date_peremption,notes,date_kind)
    VALUES(p_user,target.id,item.categorie,item.produit,amount,item.unite,item.date_entree,item.date_peremption,item.notes,item.date_kind);
    UPDATE public.items SET qte=qte-amount WHERE id=item.id RETURNING * INTO item;
   END IF;
  ELSIF p_action='inventory' THEN
   IF (p_payload->>'qte')::numeric=0 THEN
    DELETE FROM public.items WHERE id=item.id RETURNING * INTO item; item.qte:=0;
   ELSE
    UPDATE public.items SET qte=(p_payload->>'qte')::numeric WHERE id=item.id RETURNING * INTO item;
   END IF;
  ELSIF p_action='edit' THEN
   IF COALESCE(trim(p_payload->>'produit'),'')='' OR COALESCE(trim(p_payload->>'categorie'),'')='' OR COALESCE(trim(p_payload->>'unite'),'')='' THEN RAISE EXCEPTION 'Produit, catégorie et unité obligatoires.'; END IF;
   IF (p_payload->>'qte')::numeric=0 THEN
    DELETE FROM public.items WHERE id=item.id RETURNING * INTO item; item.qte:=0;
   ELSE
   UPDATE public.items SET produit=trim(p_payload->>'produit'),categorie=trim(p_payload->>'categorie'),qte=(p_payload->>'qte')::numeric,unite=trim(p_payload->>'unite'),date_entree=(p_payload->>'date_entree')::date,date_peremption=(p_payload->>'date_peremption')::date,date_kind=COALESCE(p_payload->>'date_kind','declared'),notes=p_payload->>'notes' WHERE id=item.id RETURNING * INTO item;
   END IF;
  ELSE RAISE EXCEPTION 'Action inconnue.';
  END IF;
  result:=to_jsonb(item);
 END IF;
 UPDATE public.frosti_operations SET result=result_value.value FROM (SELECT result AS value) result_value WHERE user_id=p_user AND operation_id=p_operation;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.frosti_equipment_action(p_user uuid,p_id uuid,p_action text,p_name text DEFAULT NULL,p_fridge boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE equipment public.freezers;
BEGIN
 IF p_action='add' THEN
  IF COALESCE(trim(p_name),'')='' THEN RAISE EXCEPTION 'Nom obligatoire.'; END IF;
  INSERT INTO public.freezers(user_id,name,is_fridge) VALUES(p_user,trim(p_name),p_fridge) RETURNING * INTO equipment;
 ELSE
  SELECT * INTO equipment FROM public.freezers WHERE id=p_id AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Équipement introuvable.'; END IF;
  IF p_action='archive' THEN
   IF EXISTS(SELECT 1 FROM public.items WHERE congelo_id=p_id AND qte>0) THEN RAISE EXCEPTION 'Déplacez le contenu avant d’archiver cet équipement.'; END IF;
   UPDATE public.freezers SET archived_at=now() WHERE id=p_id RETURNING * INTO equipment;
  ELSIF p_action='delete' THEN
   IF EXISTS(SELECT 1 FROM public.items WHERE congelo_id=p_id) THEN RAISE EXCEPTION 'Transférez ou retirez tous les lots avant de supprimer cet équipement.'; END IF;
   IF EXISTS(SELECT 1 FROM public.storage_defaults WHERE freezer_id=p_id)
     OR EXISTS(SELECT 1 FROM public.storage_routing_rules WHERE freezer_id=p_id) THEN
    RAISE EXCEPTION 'Cet équipement est utilisé par des règles de rangement. Changez leur destination dans Mealio avant de le supprimer.';
   END IF;
   DELETE FROM public.freezers WHERE id=p_id;
  ELSIF p_action='restore' THEN
   UPDATE public.freezers SET archived_at=NULL WHERE id=p_id RETURNING * INTO equipment;
  ELSIF p_action='rename' THEN
   IF COALESCE(trim(p_name),'')='' THEN RAISE EXCEPTION 'Nom obligatoire.'; END IF;
   UPDATE public.freezers SET name=trim(p_name) WHERE id=p_id RETURNING * INTO equipment;
  ELSE RAISE EXCEPTION 'Action inconnue.'; END IF;
 END IF;
 RETURN to_jsonb(equipment);
END $$;


-- Un seul groupe atomique et annulable pour jusqu'a 100 lots d'un meme espace.
CREATE OR REPLACE FUNCTION public.frosti_transfer_batch(p_user uuid,p_operation uuid,p_source uuid,p_target uuid,p_lots jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request_value jsonb; saved public.frosti_operations; r record; item public.items;
 child_id uuid; moved integer:=0; result_value jsonb;
BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR p_source IS NULL OR p_target IS NULL
  OR p_source=p_target OR jsonb_typeof(p_lots) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Transfert incomplet.'; END IF;
 IF jsonb_array_length(p_lots) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Sélectionnez entre 1 et 100 lots.'; END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_lots))<>jsonb_array_length(p_lots) THEN
  RAISE EXCEPTION 'Un lot est sélectionné plusieurs fois.';
 END IF;
 request_value:=jsonb_build_object('source',p_source,'target',p_target,'lots',p_lots);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_operation::text,0));
 SELECT * INTO saved FROM public.frosti_operations WHERE user_id=p_user AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.request<>request_value THEN RAISE EXCEPTION 'Identifiant déjà utilisé pour un autre transfert.'; END IF;
  RETURN saved.result;
 END IF;
 PERFORM 1 FROM public.items WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_lots)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.freezers WHERE id=p_source AND user_id=p_user AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Équipement source indisponible.'; END IF;
 PERFORM 1 FROM public.freezers WHERE id=p_target AND user_id=p_user AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination indisponible pour ce foyer.'; END IF;
 INSERT INTO public.frosti_operations(user_id,operation_id,request) VALUES(p_user,p_operation,request_value);
 FOR r IN SELECT * FROM jsonb_to_recordset(p_lots) AS x(id uuid,amount numeric,version bigint) ORDER BY id LOOP
  SELECT * INTO item FROM public.items WHERE id=r.id AND user_id=p_user AND congelo_id=p_source;
  IF NOT FOUND THEN RAISE EXCEPTION 'Un lot a changé d’emplacement ou ne vous appartient pas. Actualisez.'; END IF;
  IF r.version IS DISTINCT FROM item.version THEN RAISE EXCEPTION 'Un lot a changé sur un autre appareil. Actualisez.'; END IF;
  child_id:=md5(p_operation::text||r.id::text)::uuid;
  PERFORM public.frosti_stock_action(p_user,child_id,'transfer',r.id,jsonb_build_object('amount',r.amount,'congelo_id',p_target));
  UPDATE public.stock_movements SET operation_id=p_operation,kind='transfer_batch'
   WHERE user_id=p_user AND operation_id=child_id;
  moved:=moved+1;
 END LOOP;
 result_value:=jsonb_build_object('count',moved,'operation_id',p_operation);
 UPDATE public.frosti_operations SET result=result_value WHERE user_id=p_user AND operation_id=p_operation;
 RETURN result_value;
END $$;
REVOKE ALL ON FUNCTION public.frosti_transfer_batch(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.frosti_transfer_batch(uuid,uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
