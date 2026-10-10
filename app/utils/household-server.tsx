import { createHash, randomUUID } from 'node:crypto'

import {
  frostiServerDb,
  cellioServerDb,
} from '../lib/supabase-server'

/**
 * Représentation minimale commune des utilisateurs
 * Frosti / Cellio.
 */
export interface HouseholdUser {
  id: string
  username: string
}

/**
 * Références du foyer dans les deux bases.
 *
 * IMPORTANT :
 * Frosti et Cellio ont chacun leur propre app_users.
 * On ne réutilise donc jamais l'UUID d'une base dans l'autre.
 */
export interface HouseholdContext {
  username: string
  frostiUserId: string | null
  cellioUserId: string | null
}

/**
 * Ligne d'un stock.
 *
 * On conserve volontairement les champs communs utilisés
 * par Mealio et le Matcher.
 */
export interface HouseholdStockItem {
  id: string
  produit: string
  qte: number
  unite: string
  categorie: string
  source: 'frosti' | 'cellio'
  date_entree?: string | null
  date_peremption?: string | null
  notes?: string | null
  congelo_id?: string | null
  cellar_id?: string | null
  version?: number
  preparation_id?: string | null
  recipe_id?: string | null
  portions_per_unit?: number | null
  ingredient_id?: string | null
  ingredient_name?: string | null
  content_quantity?: number | null
  content_unit?: string | null
  product_type?: 'food'|'beverage'|'wine'|null
  preparation_origin?: 'bought'|'homemade'|null
  date_role?: 'unknown'|'dlc'|'ddm'|'apogee'|'indicative'
  date_kind?: 'declared'|'estimated'
  date_fabrication?: string|null
  millesime?: string|null
  domaine?: string|null
  format?: string|null
}

/**
 * Résout un username dans Frosti ET Cellio.
 *
 * Les deux bases possèdent leur propre table app_users.
 */
export async function resolveHousehold(
  username: string
): Promise<HouseholdContext> {
  const normalizedUsername = username.trim()

  if (!normalizedUsername) {
    throw new Error('Nom utilisateur absent.')
  }

  const [frostiResult, cellioResult] = await Promise.all([
    frostiServerDb
      .from('app_users')
      .select('id, username')
      .eq('username', normalizedUsername)
      .maybeSingle(),

    cellioServerDb
      .from('app_users')
      .select('id, username')
      .eq('username', normalizedUsername)
      .maybeSingle(),
  ])

  if (frostiResult.error) {
    throw new Error(
      `Erreur résolution utilisateur Frosti : ${frostiResult.error.message}`
    )
  }

  if (cellioResult.error) {
    throw new Error(
      `Erreur résolution utilisateur Cellio : ${cellioResult.error.message}`
    )
  }

  return {
    username: normalizedUsername,
    frostiUserId: frostiResult.data?.id ?? null,
    cellioUserId: cellioResult.data?.id ?? null,
  }
}

/**
 * Vérifie qu'un foyer existe au moins dans l'une des deux bases.
 */
export async function requireHousehold(
  username: string
): Promise<HouseholdContext> {
  const household = await resolveHousehold(username)

  if (!household.frostiUserId && !household.cellioUserId) {
    throw new Error(
      `Utilisateur "${household.username}" introuvable dans Frosti et Cellio.`
    )
  }

  return household
}


export function operationUuid(key: string): string {
 const hex = createHash('sha256').update('mealio:v1:'+key).digest('hex');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
function sourceDb(source: 'frosti'|'cellio') {
 if(source!=='frosti'&&source!=='cellio') throw new Error('Source invalide.');
 return source==='frosti'?frostiServerDb:cellioServerDb;
}
function ownerFor(household: HouseholdContext, source: 'frosti'|'cellio') {
 const owner=source==='frosti'?household.frostiUserId:household.cellioUserId;
 if(!owner) throw new Error(`Foyer absent de ${source}.`); return owner;
}
function stockItem(row:any,source:'frosti'|'cellio'):HouseholdStockItem {
 return {...row,source,qte:Number(row.qte),version:Number(row.version),content_quantity:row.content_quantity==null?null:Number(row.content_quantity),portions_per_unit:row.portions_per_unit==null?null:Number(row.portions_per_unit)};
}
async function pagedStockRows(source:'frosti'|'cellio',userId:string){
 const rows:HouseholdStockItem[]=[];
 for(let offset=0;offset<100000;offset+=500){
  const {data,error}=await sourceDb(source).from('items').select('*').eq('user_id',userId).order('id').range(offset,offset+499);
  if(error)throw new Error(`Erreur lecture stock ${source==='frosti'?'Frosti':'Cellio'} : ${error.message}`);
  rows.push(...(data||[]).map((row:any)=>stockItem(row,source))); if((data||[]).length<500)return rows;
 }
 throw new Error('Stock supérieur à 100 000 lignes.');
}
export async function getFrostiStock(userId:string){return pagedStockRows('frosti',userId)}
export async function getCellioStock(userId:string){return pagedStockRows('cellio',userId)}
export async function getHouseholdStockServer(username:string,context?:HouseholdContext):Promise<HouseholdStockItem[]>{
 const h=context??await requireHousehold(username);
 if(h.username!==username.trim())throw new Error('Le contexte ne correspond pas au foyer.');
 const [a,b]=await Promise.all([h.frostiUserId?getFrostiStock(h.frostiUserId):[],h.cellioUserId?getCellioStock(h.cellioUserId):[]]);return [...a,...b];
}
export interface CreateStockItemInput extends Partial<Omit<HouseholdStockItem,'id'|'source'>> {
 source:'frosti'|'cellio'; produit:string; categorie:string; operation_id?:string; merge_exact?:boolean; apply_default_expiry?:boolean;
}
export interface UpdateStockItemInput extends Partial<Omit<HouseholdStockItem,'id'|'source'>> {
 source:'frosti'|'cellio'; operation_id?:string; expected_version?:number;
}
export async function stockAction(username:string,source:'frosti'|'cellio',operation:string,action:string,itemId:string|null,payload:Record<string,unknown>,context?:HouseholdContext){
 const h=context??await requireHousehold(username);if(h.username!==username.trim())throw new Error('Foyer incompatible.');
 let query=sourceDb(source).rpc(`${source}_stock_action`,{p_user:ownerFor(h,source),p_operation:operation,p_action:action,p_item:itemId,p_payload:{...payload,origin:'mealio'}});if(typeof query.abortSignal==='function')query=query.abortSignal(AbortSignal.timeout(30000));const {data,error}=await query;
 if(error)throw new Error(error.message);return data;
}
export async function createHouseholdStockItem(username:string,input:CreateStockItemInput):Promise<HouseholdStockItem>{
 const {source,operation_id,...payload}=input;
 const operation=operation_id??(input.notes?.startsWith('mealio:')?operationUuid(input.notes):randomUUID());
 const row=await stockAction(username,source,operation,'add',null,{...payload,qte:input.qte??1,unite:input.unite?.trim()||'pièce(s)'});
 return stockItem(row,source);
}
export async function updateHouseholdStockItem(username:string,itemId:string,input:UpdateStockItemInput):Promise<HouseholdStockItem>{
 const h=await requireHousehold(username);const db=sourceDb(input.source);
 const {data:current,error}=await db.from('items').select('*').eq('id',itemId).eq('user_id',ownerFor(h,input.source)).maybeSingle();
 if(error)throw new Error(error.message);if(!current)throw new Error('Article introuvable.');
 if(current.content_quantity!=null&&input.unite!==undefined&&input.unite!==current.unite)throw new Error('Ce lot possède un contenu par unité. Modifiez son conditionnement dans '+input.source+' avant de changer son unité.');
 const {source,operation_id,expected_version,...changes}=input;
 const row=await stockAction(username,source,operation_id??randomUUID(),'edit',itemId,{...current,...Object.fromEntries(Object.entries(changes).filter(([,v])=>v!==undefined)),version:expected_version??current.version});
 return stockItem(row,source);
}
export async function consumeHouseholdStockItem(username:string,itemId:string,source:'frosti'|'cellio',amount:number,operation:string,version?:number){
 if(!Number.isFinite(amount)||amount<=0)throw new Error('Quantité invalide.');
 return stockAction(username,source,operation,'use',itemId,{amount,...(version===undefined?{}:{version})});
}
export async function inventoryHouseholdBatch(username:string,source:'frosti'|'cellio',rows:Array<{id:string,qte:number,unite:string,version:number}>,operation:string){
 const h=await requireHousehold(username);
 const {data,error}=await sourceDb(source).rpc(`${source}_inventory_batch`,{p_user:ownerFor(h,source),p_operation:operation,p_rows:rows});
 if(error)throw new Error(error.message);return data;
}
export async function deleteHouseholdStockItem(username:string,itemId:string,source:'frosti'|'cellio'):Promise<void>{
 const h=await requireHousehold(username);const {data,error}=await sourceDb(source).from('items').select('id,qte,version').eq('id',itemId).eq('user_id',ownerFor(h,source)).maybeSingle();
 if(error)throw new Error(error.message);if(!data)throw new Error('Article introuvable.');
 if(Number(data.qte)===0){await stockAction(username,source,randomUUID(),'inventory',itemId,{qte:0,version:data.version});}
 else await stockAction(username,source,randomUUID(),'discard',itemId,{amount:Number(data.qte),version:data.version});
}
/** Receipt lookup is owned by the household and verified against the submitted corrections. */
export async function inventoryReceipt(username:string,source:'frosti'|'cellio',operation:string,rows:Array<{id:string,qte:number,unite:string}>){
 const h=await requireHousehold(username);const {data,error}=await sourceDb(source).from(`${source}_operations`).select('request,result').eq('user_id',ownerFor(h,source)).eq('operation_id',operation).maybeSingle();
 if(error)throw new Error(error.message);if(!data)return null;
 const saved=data.request?.rows;if(data.request?.action!=='inventory_batch'||!Array.isArray(saved)||saved.length!==rows.length||saved.some((r:any)=>!rows.some(i=>i.id===r.id&&i.qte===r.qte&&i.unite.trim()===r.unite)))throw new Error('Identifiant déjà utilisé pour une autre correction.');
 return data.result;
}
