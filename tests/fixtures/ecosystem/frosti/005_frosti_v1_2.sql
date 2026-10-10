-- Frosti V1.2 : executer apres 004. Aucun doublon existant n'est supprime automatiquement.
BEGIN;
CREATE OR REPLACE FUNCTION public.frosti_stock_action(
 p_user uuid,p_operation uuid,p_action text,p_item uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item public.items; target public.freezers; amount numeric; op public.frosti_operations;
 result jsonb; original uuid; m public.stock_movements; current_row jsonb; snapshot public.items;
 request_value jsonb; found_count integer; matching public.items;
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
  IF p_action IN('edit','inventory','merge') AND (p_payload->>'version')::bigint IS DISTINCT FROM item.version THEN
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
 PERFORM pg_advisory_xact_lock(hashtextextended('frosti.stock:'||p_user::text,0));
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
  -- Several selected lots can merge into the same destination row.
  -- Keep one original before snapshot and the latest after snapshot per row.
  UPDATE public.stock_movements previous SET after_row=child.after_row
   FROM public.stock_movements child
   WHERE previous.user_id=p_user AND previous.operation_id=p_operation
    AND child.user_id=p_user AND child.operation_id=child_id AND previous.item_id=child.item_id;
  DELETE FROM public.stock_movements child USING public.stock_movements previous
   WHERE previous.user_id=p_user AND previous.operation_id=p_operation
    AND child.user_id=p_user AND child.operation_id=child_id AND previous.item_id=child.item_id;
  UPDATE public.stock_movements SET operation_id=p_operation,kind='transfer_batch'
   WHERE user_id=p_user AND operation_id=child_id;
  moved:=moved+1;
 END LOOP;
 result_value:=jsonb_build_object('count',moved,'operation_id',p_operation);
 UPDATE public.frosti_operations SET result=result_value WHERE user_id=p_user AND operation_id=p_operation;
 RETURN result_value;
END $$;
COMMIT;
