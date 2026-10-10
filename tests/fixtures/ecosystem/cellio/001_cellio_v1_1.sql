-- Additive migration. Execute before deploying Cellio V1.1. No existing rows removed.
BEGIN;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.cellars ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS dlc_warning_days integer NOT NULL DEFAULT 30;
CREATE TABLE IF NOT EXISTS public.cellio_operations (
 user_id uuid NOT NULL REFERENCES public.app_users(id), operation_id uuid NOT NULL,
 request jsonb NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,operation_id)
);
CREATE TABLE IF NOT EXISTS public.stock_movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
 operation_id uuid NOT NULL, kind text NOT NULL, origin text NOT NULL,
 item_id uuid NOT NULL, before_row jsonb, after_row jsonb,
 undone_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stock_movements_household_date ON public.stock_movements(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS stock_movements_operation ON public.stock_movements(user_id,operation_id);
CREATE INDEX IF NOT EXISTS items_household_location ON public.items(user_id,cellar_id);
CREATE TABLE IF NOT EXISTS public.cellio_login_limits (
 key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.cellio_notification_runs (
 user_id uuid NOT NULL, day date NOT NULL, status text NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, error text,
 PRIMARY KEY(user_id,day)
);
-- NOT VALID preserves existing legacy rows but rejects invalid new writes.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='cellio_items_quantity_check' AND conrelid='public.items'::regclass) THEN
  ALTER TABLE public.items ADD CONSTRAINT cellio_items_quantity_check CHECK(qte IS NOT NULL AND qte>=0 AND qte<'Infinity'::numeric) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='cellio_items_owner_check' AND conrelid='public.items'::regclass) THEN
  ALTER TABLE public.items ADD CONSTRAINT cellio_items_owner_check CHECK(user_id IS NOT NULL AND cellar_id IS NOT NULL) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='cellio_items_location_owner' AND conrelid='public.items'::regclass) THEN
  ALTER TABLE public.items ADD CONSTRAINT cellio_items_location_owner FOREIGN KEY(cellar_id,user_id) REFERENCES public.cellars(id,user_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='cellio_routing_location_owner' AND conrelid='public.storage_routing_rules'::regclass) THEN
  ALTER TABLE public.storage_routing_rules ADD CONSTRAINT cellio_routing_location_owner FOREIGN KEY(cellar_id,user_id) REFERENCES public.cellars(id,user_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='cellio_alert_positive_days' AND conrelid='public.alert_rules'::regclass) THEN
  ALTER TABLE public.alert_rules ADD CONSTRAINT cellio_alert_positive_days CHECK((fridge_days IS NULL OR fridge_days>0) AND (freezer_days IS NULL OR freezer_days>0)) NOT VALID;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cellio_item_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN NEW.version:=OLD.version+1; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS cellio_item_version ON public.items;
CREATE TRIGGER cellio_item_version BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.cellio_item_version();

CREATE OR REPLACE FUNCTION public.cellio_audit_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; op uuid; kind_value text; origin_value text;
BEGIN
 IF TG_OP='DELETE' THEN owner_id:=OLD.user_id; ELSE owner_id:=NEW.user_id; END IF;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
  RAISE EXCEPTION 'Le propriétaire du lot ne peut pas être changé.';
 END IF;
 IF owner_id IS NULL THEN RETURN NULL; END IF;
 op:=COALESCE(NULLIF(current_setting('cellio.operation_id',true),'')::uuid,gen_random_uuid());
 kind_value:=COALESCE(NULLIF(current_setting('cellio.kind',true),''),lower(TG_OP));
 origin_value:=COALESCE(NULLIF(current_setting('cellio.origin',true),''),'mealio_ou_externe');
 INSERT INTO public.stock_movements(user_id,operation_id,kind,origin,item_id,before_row,after_row)
 VALUES(owner_id,op,kind_value,origin_value,CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,
 CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
 CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS cellio_audit_item ON public.items;
CREATE TRIGGER cellio_audit_item AFTER INSERT OR UPDATE OR DELETE ON public.items FOR EACH ROW EXECUTE FUNCTION public.cellio_audit_item();

CREATE OR REPLACE FUNCTION public.cellio_login_attempt(p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 DELETE FROM public.cellio_login_limits WHERE window_start<now()-interval '1 day';
 INSERT INTO public.cellio_login_limits(key,attempts,window_start) VALUES(p_key,1,now())
 ON CONFLICT(key) DO UPDATE SET
 attempts=CASE WHEN cellio_login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE cellio_login_limits.attempts+1 END,
 window_start=CASE WHEN cellio_login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE cellio_login_limits.window_start END
 RETURNING attempts INTO n;
 RETURN n<=10;
END $$;

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
CREATE OR REPLACE FUNCTION public.cellio_stock_action(
 p_user uuid,p_operation uuid,p_action text,p_item uuid,p_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item public.items; target public.cellars; amount numeric; op public.cellio_operations;
 result jsonb; original uuid; m public.stock_movements; current_row jsonb; snapshot public.items;
 request_value jsonb; found_count integer; matching public.items;
BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR p_payload IS NULL THEN RAISE EXCEPTION 'Opération incomplète.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cellio.stock:'||p_user::text,0));
 request_value:=jsonb_build_object('action',p_action,'item',p_item,'payload',p_payload);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_operation::text,0));
 SELECT * INTO op FROM public.cellio_operations WHERE user_id=p_user AND operation_id=p_operation;
 IF FOUND THEN
  IF op.request<>request_value THEN RAISE EXCEPTION 'Identifiant déjà utilisé pour une autre opération.'; END IF;
  RETURN op.result;
 END IF;
 INSERT INTO public.cellio_operations(user_id,operation_id,request) VALUES(p_user,p_operation,request_value);
 PERFORM set_config('cellio.operation_id',p_operation::text,true);
 PERFORM set_config('cellio.kind',p_action,true);
 PERFORM set_config('cellio.origin','cellio',true);
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
    IF NOT EXISTS(SELECT 1 FROM public.cellars WHERE id=snapshot.cellar_id AND user_id=p_user AND archived_at IS NULL) THEN
     RAISE EXCEPTION 'Réactivez l’emplacement avant d’annuler.';
    END IF;
    IF m.after_row IS NULL THEN
     INSERT INTO public.items(id,created_at,user_id,cellar_id,categorie,produit,qte,unite,date_entree,date_peremption,notes,version,date_kind,millesime,domaine,format,date_fabrication)
     VALUES(snapshot.id,snapshot.created_at,p_user,snapshot.cellar_id,snapshot.categorie,snapshot.produit,snapshot.qte,snapshot.unite,snapshot.date_entree,snapshot.date_peremption,snapshot.notes,snapshot.version+1,COALESCE(snapshot.date_kind,'declared'),snapshot.millesime,snapshot.domaine,snapshot.format,snapshot.date_fabrication);
    ELSE
     UPDATE public.items SET cellar_id=snapshot.cellar_id,categorie=snapshot.categorie,produit=snapshot.produit,qte=snapshot.qte,unite=snapshot.unite,date_entree=snapshot.date_entree,date_peremption=snapshot.date_peremption,date_kind=COALESCE(snapshot.date_kind,'declared'),millesime=snapshot.millesime,domaine=snapshot.domaine,format=snapshot.format,date_fabrication=snapshot.date_fabrication,notes=snapshot.notes
     WHERE id=m.item_id AND user_id=p_user;
    END IF;
   END IF;
  END LOOP;
  UPDATE public.stock_movements SET undone_by=p_operation WHERE user_id=p_user AND operation_id=original;
  result:=jsonb_build_object('operation_id',p_operation);
 ELSIF p_action='add' THEN
  SELECT * INTO target FROM public.cellars WHERE id=(p_payload->>'cellar_id')::uuid AND user_id=p_user AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Emplacement indisponible pour ce foyer.'; END IF;
  amount:=(p_payload->>'qte')::numeric;
  IF amount IS NULL OR NOT(amount>0 AND amount<'Infinity'::numeric) THEN RAISE EXCEPTION 'Quantité invalide.'; END IF;
  IF COALESCE(trim(p_payload->>'produit'),'')='' OR COALESCE(trim(p_payload->>'categorie'),'')='' THEN RAISE EXCEPTION 'Produit et catégorie obligatoires.'; END IF;
  INSERT INTO public.items(user_id,cellar_id,produit,categorie,qte,unite,date_entree,date_peremption,notes,date_kind,millesime,domaine,format,date_fabrication)
  VALUES(p_user,target.id,trim(p_payload->>'produit'),trim(p_payload->>'categorie'),amount,COALESCE(NULLIF(trim(p_payload->>'unite'),''),'pièce(s)'),COALESCE((p_payload->>'date_entree')::date,CURRENT_DATE),(p_payload->>'date_peremption')::date,p_payload->>'notes',COALESCE(p_payload->>'date_kind','declared'),p_payload->>'millesime',p_payload->>'domaine',p_payload->>'format',(p_payload->>'date_fabrication')::date) RETURNING * INTO item;
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
    SELECT * INTO target FROM public.cellars WHERE id=item.cellar_id AND user_id=p_user AND archived_at IS NULL FOR SHARE;
    amount:=item.qte;
   ELSE
    SELECT * INTO target FROM public.cellars WHERE id=(p_payload->>'cellar_id')::uuid AND user_id=p_user AND archived_at IS NULL FOR SHARE;
    IF NOT FOUND OR target.id=item.cellar_id THEN RAISE EXCEPTION 'Choisissez un autre emplacement de ce foyer.'; END IF;
    amount:=(p_payload->>'amount')::numeric;
   END IF;
   IF target.id IS NULL THEN RAISE EXCEPTION 'Emplacement indisponible.'; END IF;
   IF amount IS NULL OR NOT(amount>0 AND amount<'Infinity'::numeric) OR amount>item.qte THEN RAISE EXCEPTION 'Quantité à déplacer invalide.'; END IF;
   SELECT * INTO matching FROM public.items i
    WHERE i.user_id=p_user AND i.cellar_id=target.id AND i.id<>item.id
     AND i.produit IS NOT DISTINCT FROM item.produit
     AND i.categorie IS NOT DISTINCT FROM item.categorie
     AND i.unite IS NOT DISTINCT FROM item.unite
     AND i.date_entree IS NOT DISTINCT FROM item.date_entree
     AND i.date_peremption IS NOT DISTINCT FROM item.date_peremption
     AND i.date_kind IS NOT DISTINCT FROM item.date_kind
     AND i.notes IS NOT DISTINCT FROM item.notes
     AND i.millesime IS NOT DISTINCT FROM item.millesime
     AND i.domaine IS NOT DISTINCT FROM item.domaine
     AND i.format IS NOT DISTINCT FROM item.format
     AND i.date_fabrication IS NOT DISTINCT FROM item.date_fabrication
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
    UPDATE public.items SET cellar_id=target.id WHERE id=item.id RETURNING * INTO item;
   ELSE
    INSERT INTO public.items(user_id,cellar_id,categorie,produit,qte,unite,date_entree,date_peremption,notes,date_kind,millesime,domaine,format,date_fabrication)
    VALUES(p_user,target.id,item.categorie,item.produit,amount,item.unite,item.date_entree,item.date_peremption,item.notes,item.date_kind,item.millesime,item.domaine,item.format,item.date_fabrication);
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
   UPDATE public.items SET produit=trim(p_payload->>'produit'),categorie=trim(p_payload->>'categorie'),qte=(p_payload->>'qte')::numeric,unite=trim(p_payload->>'unite'),date_entree=(p_payload->>'date_entree')::date,date_peremption=(p_payload->>'date_peremption')::date,date_kind=COALESCE(p_payload->>'date_kind','declared'),millesime=p_payload->>'millesime',domaine=p_payload->>'domaine',format=p_payload->>'format',date_fabrication=(p_payload->>'date_fabrication')::date,notes=p_payload->>'notes' WHERE id=item.id RETURNING * INTO item;
   END IF;
  ELSE RAISE EXCEPTION 'Action inconnue.';
  END IF;
  result:=to_jsonb(item);
 END IF;
 UPDATE public.cellio_operations SET result=result_value.value FROM (SELECT result AS value) result_value WHERE user_id=p_user AND operation_id=p_operation;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION public.cellio_transfer_batch(p_user uuid,p_operation uuid,p_source uuid,p_target uuid,p_lots jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE request_value jsonb; saved public.cellio_operations; r record; item public.items;
 child_id uuid; moved integer:=0; result_value jsonb;
BEGIN
 IF p_user IS NULL OR p_operation IS NULL OR p_source IS NULL OR p_target IS NULL
  OR p_source=p_target OR jsonb_typeof(p_lots) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Transfert incomplet.'; END IF;
 IF jsonb_array_length(p_lots) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Sélectionnez entre 1 et 100 lots.'; END IF;
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_lots))<>jsonb_array_length(p_lots) THEN
  RAISE EXCEPTION 'Un lot est sélectionné plusieurs fois.';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cellio.stock:'||p_user::text,0));
 request_value:=jsonb_build_object('source',p_source,'target',p_target,'lots',p_lots);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||p_operation::text,0));
 SELECT * INTO saved FROM public.cellio_operations WHERE user_id=p_user AND operation_id=p_operation;
 IF FOUND THEN
  IF saved.request<>request_value THEN RAISE EXCEPTION 'Identifiant déjà utilisé pour un autre transfert.'; END IF;
  RETURN saved.result;
 END IF;
 PERFORM 1 FROM public.items WHERE id IN(SELECT (value->>'id')::uuid FROM jsonb_array_elements(p_lots)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.cellars WHERE id=p_source AND user_id=p_user AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Équipement source indisponible.'; END IF;
 PERFORM 1 FROM public.cellars WHERE id=p_target AND user_id=p_user AND archived_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Destination indisponible pour ce foyer.'; END IF;
 INSERT INTO public.cellio_operations(user_id,operation_id,request) VALUES(p_user,p_operation,request_value);
 FOR r IN SELECT * FROM jsonb_to_recordset(p_lots) AS x(id uuid,amount numeric,version bigint) ORDER BY id LOOP
  SELECT * INTO item FROM public.items WHERE id=r.id AND user_id=p_user AND cellar_id=p_source;
  IF NOT FOUND THEN RAISE EXCEPTION 'Un lot a changé d’emplacement ou ne vous appartient pas. Actualisez.'; END IF;
  IF r.version IS DISTINCT FROM item.version THEN RAISE EXCEPTION 'Un lot a changé sur un autre appareil. Actualisez.'; END IF;
  child_id:=md5(p_operation::text||r.id::text)::uuid;
  PERFORM public.cellio_stock_action(p_user,child_id,'transfer',r.id,jsonb_build_object('amount',r.amount,'cellar_id',p_target));
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
 UPDATE public.cellio_operations SET result=result_value WHERE user_id=p_user AND operation_id=p_operation;
 RETURN result_value;
END $$;

CREATE OR REPLACE FUNCTION public.cellio_equipment_action(p_user uuid,p_id uuid,p_action text,p_name text DEFAULT NULL,p_secondary boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE equipment public.cellars;
BEGIN
 IF p_action='add' THEN
  IF COALESCE(trim(p_name),'')='' THEN RAISE EXCEPTION 'Nom obligatoire.'; END IF;
  INSERT INTO public.cellars(user_id,name,is_secondary) VALUES(p_user,trim(p_name),p_secondary) RETURNING * INTO equipment;
 ELSE
  SELECT * INTO equipment FROM public.cellars WHERE id=p_id AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Équipement introuvable.'; END IF;
  IF p_action='archive' THEN
   IF EXISTS(SELECT 1 FROM public.items WHERE cellar_id=p_id AND qte>0) THEN RAISE EXCEPTION 'Déplacez le contenu avant d’archiver cet équipement.'; END IF;
   UPDATE public.cellars SET archived_at=now() WHERE id=p_id RETURNING * INTO equipment;
  ELSIF p_action='delete' THEN
   IF EXISTS(SELECT 1 FROM public.items WHERE cellar_id=p_id) THEN RAISE EXCEPTION 'Transférez ou retirez tous les lots avant de supprimer cet équipement.'; END IF;
   IF EXISTS(SELECT 1 FROM public.storage_defaults WHERE cellar_id=p_id)
     OR EXISTS(SELECT 1 FROM public.storage_routing_rules WHERE cellar_id=p_id) THEN
    RAISE EXCEPTION 'Cet équipement est utilisé par des règles de rangement. Changez leur destination dans Mealio avant de le supprimer.';
   END IF;
   DELETE FROM public.cellars WHERE id=p_id;
  ELSIF p_action='restore' THEN
   UPDATE public.cellars SET archived_at=NULL WHERE id=p_id RETURNING * INTO equipment;
  ELSIF p_action='rename' THEN
   IF COALESCE(trim(p_name),'')='' THEN RAISE EXCEPTION 'Nom obligatoire.'; END IF;
   UPDATE public.cellars SET name=trim(p_name) WHERE id=p_id RETURNING * INTO equipment;
  ELSE RAISE EXCEPTION 'Action inconnue.'; END IF;
 END IF;
 RETURN to_jsonb(equipment);
END $$;


CREATE OR REPLACE FUNCTION public.cellio_guard_location() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.cellar_id IS DISTINCT FROM OLD.cellar_id OR NEW.qte>OLD.qte THEN
  PERFORM 1 FROM public.cellars WHERE id=NEW.cellar_id AND user_id=NEW.user_id AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Emplacement absent, archivé ou appartenant à un autre foyer.'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cellio_guard_location ON public.items;
CREATE TRIGGER cellio_guard_location BEFORE INSERT OR UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.cellio_guard_location();

ALTER TABLE public.cellio_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cellio_login_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cellio_notification_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cellio_operations,public.stock_movements,public.cellio_login_limits,public.cellio_notification_runs FROM anon,authenticated;
GRANT ALL ON public.cellio_operations,public.stock_movements,public.cellio_login_limits,public.cellio_notification_runs TO service_role;
REVOKE ALL ON FUNCTION public.cellio_stock_action(uuid,uuid,text,uuid,jsonb),public.cellio_equipment_action(uuid,uuid,text,text,boolean),public.cellio_login_attempt(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cellio_stock_action(uuid,uuid,text,uuid,jsonb),public.cellio_equipment_action(uuid,uuid,text,text,boolean),public.cellio_login_attempt(text) TO service_role;
REVOKE ALL ON FUNCTION public.cellio_audit_item(),public.cellio_guard_location(),public.cellio_item_version() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cellio_transfer_batch(uuid,uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cellio_transfer_batch(uuid,uuid,uuid,uuid,jsonb) TO service_role;
COMMIT;
