import {fefoOrder} from './ecosystem-policy'
import type {HouseholdStockItem} from './household-server'
/** Read-only allocation: a prepared lot is counted once across the planning period. */
export function preparedPortionAllocator(stock:HouseholdStockItem[]){
 const remaining=new Map(stock.map(l=>[`${l.source}:${l.id}`,l.qte]));
 return {remaining,allocate(recipe:string,servings:number,preparation?:string){
  const used:Array<{lot:HouseholdStockItem,amount:number}>=[];let missing=servings;
  for(const lot of stock.filter(l=>l.recipe_id===recipe&&l.preparation_origin==='homemade'&&Number(l.portions_per_unit)>0&&(!preparation||l.preparation_id===preparation)).sort(fefoOrder)){
   if(missing<=1e-9)break;const key=`${lot.source}:${lot.id}`;const available=remaining.get(key)??0;const portions=Math.min(missing,available*lot.portions_per_unit!);if(portions<=0)continue;
   const amount=Math.min(available,portions/lot.portions_per_unit!);remaining.set(key,Math.max(0,available-amount));missing-=portions;used.push({lot,amount});
  }
  return {used,missing:Math.max(0,missing)}
 }}
}
