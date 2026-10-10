-- Additive migration. Execute before deploying Frosti V1.0. No existing rows removed.
BEGIN;
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;
ALTER TABLE public.freezers ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS dlc_warning_days integer NOT NULL DEFAULT 3;
CREATE TABLE IF NOT EXISTS public.frosti_operations (
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
CREATE INDEX IF NOT EXISTS items_household_location ON public.items(user_id,congelo_id);
CREATE TABLE IF NOT EXISTS public.frosti_login_limits (
 key text PRIMARY KEY, attempts integer NOT NULL, window_start timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.frosti_notification_runs (
 user_id uuid NOT NULL, day date NOT NULL, status text NOT NULL,
 claimed_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, error text,
 PRIMARY KEY(user_id,day)
);
-- NOT VALID preserves existing legacy rows but rejects invalid new writes.
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='frosti_items_quantity_check' AND conrelid='public.items'::regclass) THEN
  ALTER TABLE public.items ADD CONSTRAINT frosti_items_quantity_check CHECK(qte>=0 AND qte<'Infinity'::numeric) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='frosti_items_owner_check' AND conrelid='public.items'::regclass) THEN
  ALTER TABLE public.items ADD CONSTRAINT frosti_items_owner_check CHECK(user_id IS NOT NULL AND congelo_id IS NOT NULL) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='frosti_items_location_owner' AND conrelid='public.items'::regclass) THEN
  ALTER TABLE public.items ADD CONSTRAINT frosti_items_location_owner FOREIGN KEY(congelo_id,user_id) REFERENCES public.freezers(id,user_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='frosti_routing_location_owner' AND conrelid='public.storage_routing_rules'::regclass) THEN
  ALTER TABLE public.storage_routing_rules ADD CONSTRAINT frosti_routing_location_owner FOREIGN KEY(freezer_id,user_id) REFERENCES public.freezers(id,user_id) NOT VALID;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='frosti_alert_positive_days' AND conrelid='public.alert_rules'::regclass) THEN
  ALTER TABLE public.alert_rules ADD CONSTRAINT frosti_alert_positive_days CHECK((fridge_days IS NULL OR fridge_days>0) AND (freezer_days IS NULL OR freezer_days>0)) NOT VALID;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.frosti_item_version() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN NEW.version:=OLD.version+1; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS frosti_item_version ON public.items;
CREATE TRIGGER frosti_item_version BEFORE UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.frosti_item_version();

CREATE OR REPLACE FUNCTION public.frosti_audit_item() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE owner_id uuid; op uuid; kind_value text; origin_value text;
BEGIN
 IF TG_OP='DELETE' THEN owner_id:=OLD.user_id; ELSE owner_id:=NEW.user_id; END IF;
 IF TG_OP='UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id THEN
  RAISE EXCEPTION 'Le propriétaire du lot ne peut pas être changé.';
 END IF;
 IF owner_id IS NULL THEN RETURN NULL; END IF;
 op:=COALESCE(NULLIF(current_setting('frosti.operation_id',true),'')::uuid,gen_random_uuid());
 kind_value:=COALESCE(NULLIF(current_setting('frosti.kind',true),''),lower(TG_OP));
 origin_value:=COALESCE(NULLIF(current_setting('frosti.origin',true),''),'mealio_ou_externe');
 INSERT INTO public.stock_movements(user_id,operation_id,kind,origin,item_id,before_row,after_row)
 VALUES(owner_id,op,kind_value,origin_value,CASE WHEN TG_OP='DELETE' THEN OLD.id ELSE NEW.id END,
 CASE WHEN TG_OP='INSERT' THEN NULL ELSE to_jsonb(OLD) END,
 CASE WHEN TG_OP='DELETE' THEN NULL ELSE to_jsonb(NEW) END);
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS frosti_audit_item ON public.items;
CREATE TRIGGER frosti_audit_item AFTER INSERT OR UPDATE OR DELETE ON public.items FOR EACH ROW EXECUTE FUNCTION public.frosti_audit_item();

CREATE OR REPLACE FUNCTION public.frosti_login_attempt(p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n integer;
BEGIN
 DELETE FROM public.frosti_login_limits WHERE window_start<now()-interval '1 day';
 INSERT INTO public.frosti_login_limits(key,attempts,window_start) VALUES(p_key,1,now())
 ON CONFLICT(key) DO UPDATE SET
 attempts=CASE WHEN frosti_login_limits.window_start<now()-interval '15 minutes' THEN 1 ELSE frosti_login_limits.attempts+1 END,
 window_start=CASE WHEN frosti_login_limits.window_start<now()-interval '15 minutes' THEN now() ELSE frosti_login_limits.window_start END
 RETURNING attempts INTO n;
 RETURN n<=10;
END $$;

-- Single transactional stock entry point, service_role only. Caller authenticates p_user.
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
     INSERT INTO public.items(id,created_at,user_id,congelo_id,categorie,produit,qte,unite,date_entree,date_peremption,notes,version)
     VALUES(snapshot.id,snapshot.created_at,p_user,snapshot.congelo_id,snapshot.categorie,snapshot.produit,snapshot.qte,snapshot.unite,snapshot.date_entree,snapshot.date_peremption,snapshot.notes,snapshot.version+1);
    ELSE
     UPDATE public.items SET congelo_id=snapshot.congelo_id,categorie=snapshot.categorie,produit=snapshot.produit,qte=snapshot.qte,unite=snapshot.unite,date_entree=snapshot.date_entree,date_peremption=snapshot.date_peremption,notes=snapshot.notes
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
  INSERT INTO public.items(user_id,congelo_id,produit,categorie,qte,unite,date_entree,date_peremption,notes)
  VALUES(p_user,target.id,trim(p_payload->>'produit'),trim(p_payload->>'categorie'),amount,COALESCE(NULLIF(trim(p_payload->>'unite'),''),'pièce(s)'),COALESCE((p_payload->>'date_entree')::date,CURRENT_DATE),(p_payload->>'date_peremption')::date,p_payload->>'notes') RETURNING * INTO item;
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
    INSERT INTO public.items(user_id,congelo_id,categorie,produit,qte,unite,date_entree,date_peremption,notes)
    VALUES(p_user,target.id,item.categorie,item.produit,amount,item.unite,item.date_entree,item.date_peremption,item.notes);
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
   UPDATE public.items SET produit=trim(p_payload->>'produit'),categorie=trim(p_payload->>'categorie'),qte=(p_payload->>'qte')::numeric,unite=trim(p_payload->>'unite'),date_entree=(p_payload->>'date_entree')::date,date_peremption=(p_payload->>'date_peremption')::date,notes=p_payload->>'notes' WHERE id=item.id RETURNING * INTO item;
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
  ELSIF p_action='restore' THEN
   UPDATE public.freezers SET archived_at=NULL WHERE id=p_id RETURNING * INTO equipment;
  ELSIF p_action='rename' THEN
   IF COALESCE(trim(p_name),'')='' THEN RAISE EXCEPTION 'Nom obligatoire.'; END IF;
   UPDATE public.freezers SET name=trim(p_name) WHERE id=p_id RETURNING * INTO equipment;
  ELSE RAISE EXCEPTION 'Action inconnue.'; END IF;
 END IF;
 RETURN to_jsonb(equipment);
END $$;

CREATE OR REPLACE FUNCTION public.frosti_guard_location() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' OR NEW.congelo_id IS DISTINCT FROM OLD.congelo_id OR NEW.qte>OLD.qte THEN
  PERFORM 1 FROM public.freezers WHERE id=NEW.congelo_id AND user_id=NEW.user_id AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Emplacement absent, archivé ou appartenant à un autre foyer.'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS frosti_guard_location ON public.items;
CREATE TRIGGER frosti_guard_location BEFORE INSERT OR UPDATE ON public.items FOR EACH ROW EXECUTE FUNCTION public.frosti_guard_location();

ALTER TABLE public.frosti_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frosti_login_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.frosti_notification_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.frosti_operations,public.stock_movements,public.frosti_login_limits,public.frosti_notification_runs FROM anon,authenticated;
GRANT ALL ON public.frosti_operations,public.stock_movements,public.frosti_login_limits,public.frosti_notification_runs TO service_role;
REVOKE ALL ON FUNCTION public.frosti_stock_action(uuid,uuid,text,uuid,jsonb),public.frosti_equipment_action(uuid,uuid,text,text,boolean),public.frosti_login_attempt(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.frosti_stock_action(uuid,uuid,text,uuid,jsonb),public.frosti_equipment_action(uuid,uuid,text,text,boolean),public.frosti_login_attempt(text) TO service_role;
REVOKE ALL ON FUNCTION public.frosti_audit_item(),public.frosti_guard_location(),public.frosti_item_version() FROM PUBLIC,anon,authenticated;
COMMIT;
