import {mealioServerDb,frostiServerDb,cellioServerDb} from '../lib/supabase-server'
import {createHouseholdStockItem,operationUuid,requireHousehold,type CreateStockItemInput} from './household-server'
import {type ResolvedStorageLocation,type StorageSource} from './storage-routing-server'
import {parisDate} from './expiry-policy'
export function completedQuantity(id:string,rows:Array<{shopping_item_id:string;quantity:number|null;status:string|null}>){return rows.filter(r=>r.shopping_item_id===id&&r.status==='completed').reduce((sum,r)=>sum+Math.max(0,Number(r.quantity)||0),0)}
export function storedQuantityFor(item:{id:string;stock_stored_quantity:number|null},rows:Array<{shopping_item_id:string;quantity:number|null;status:string|null}>){return rows.some(r=>r.shopping_item_id===item.id)?completedQuantity(item.id,rows):Math.max(0,Number(item.stock_stored_quantity)||0)}
/** One frozen reservation for both normal shopping and administrative repair. */
export async function storePurchaseLot(username:string,item:{id:string;produit:string;ingredient_id:string|null;unite:string|null},ingredient:{nom:string;categorie:string|null},source:StorageSource,location:ResolvedStorageLocation){
 const draft={source,produit:item.produit,categorie:ingredient.categorie?.trim()||'Autre',unite:item.unite?.trim()||'pièce(s)',date_entree:parisDate(),date_peremption:null,notes:null,merge_exact:true,ingredient_id:item.ingredient_id,ingredient_name:ingredient.nom,product_type:'food',preparation_origin:'bought',apply_default_expiry:true};
 const {data:reservation,error}=await mealioServerDb.rpc('mealio_reserve_purchase_stock',{p_user:username,p_item:item.id,p_source:source,p_location:location.location_id,p_location_name:location.location_name,p_rule:location.rule_label,p_request:draft});
 if(error)throw new Error(error.message);if(!reservation)throw new Error('Réservation de rangement indisponible.');
 if(reservation.status==='nothing')return {stock_item_id:null,stored_quantity:Number(reservation.stored_quantity),quantity:0,source,location_name:location.location_name,location_id:location.location_id,rule_label:location.rule_label};
 const storage=reservation.storage as StorageSource;if(!['frosti','cellio'].includes(storage))throw new Error('Destination réservée invalide.');
 const household=await requireHousehold(username);const db=storage==='frosti'?frostiServerDb:cellioServerDb;const owner=storage==='frosti'?household.frostiUserId:household.cellioUserId;
 const operation=operationUuid(reservation.operation_key);let stockId=reservation.stock_item_id;
 // A committed source receipt remains proof even if the lot has since been consumed.
 const {data:receipt,error:receiptError}=await db.from(`${storage}_operations`).select('result').eq('user_id',owner).eq('operation_id',operation).maybeSingle();if(receiptError)throw new Error(receiptError.message);
 if(receipt)stockId=receipt.result?.id;
 if(!stockId){const {data:legacy,error:legacyError}=await db.from('items').select('id').eq('user_id',owner).eq('notes',reservation.operation_key).limit(1).maybeSingle();if(legacyError)throw new Error(legacyError.message);stockId=legacy?.id;}
 if(!stockId){
  let frozen=reservation.request_payload;
  if(!frozen){
   frozen={...draft,source:storage,qte:Number(reservation.quantity),date_entree:reservation.attempted_at?parisDate(new Date(reservation.attempted_at)):parisDate(),[storage==='frosti'?'congelo_id':'cellar_id']:reservation.location_id};
   const {error:freezeError}=await mealioServerDb.from('shopping_item_stock_transfers').update({request_payload:frozen}).eq('operation_key',reservation.operation_key).is('request_payload',null);if(freezeError)throw new Error(freezeError.message);
   const {data:stored,error:readError}=await mealioServerDb.from('shopping_item_stock_transfers').select('request_payload').eq('operation_key',reservation.operation_key).single();if(readError||!stored?.request_payload)throw new Error('Reprise ancienne : demande impossible à figer.');frozen=stored.request_payload;
  }
  const lot=await createHouseholdStockItem(username,{...frozen,operation_id:operation} as CreateStockItemInput);stockId=lot.id;
 }
 if(!stockId)throw new Error('Le reçu source ne contient pas de lot.');
 const {error:completeError}=await mealioServerDb.from('shopping_item_stock_transfers').update({stock_item_id:stockId,status:'completed',attempted_at:new Date().toISOString()}).eq('operation_key',reservation.operation_key);if(completeError)throw new Error(`Stock traité ; journal à finaliser : ${completeError.message}`);
 const {data:rows,error:readError}=await mealioServerDb.from('shopping_item_stock_transfers').select('shopping_item_id,quantity,status').eq('shopping_item_id',item.id);if(readError)throw new Error(readError.message);
 return {stock_item_id:stockId,stored_quantity:completedQuantity(item.id,rows??[]),quantity:Number(reservation.quantity),source:storage,location_id:reservation.location_id,location_name:reservation.location_name,rule_label:reservation.rule_label};
}
