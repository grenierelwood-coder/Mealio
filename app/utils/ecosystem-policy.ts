import type { HouseholdStockItem } from './household-server'
import {expiryDay} from './expiry-policy'
/** Unknown legacy dates stay useful as dates to review, never as declared DLCs. */
export function consumptionDate(i:Pick<HouseholdStockItem,'date_role'|'date_peremption'|'product_type'>){return i.date_role==='apogee'||i.product_type==='wine'?null:expiryDay(i.date_peremption)}
export function fefoOrder(a:HouseholdStockItem,b:HouseholdStockItem){
 const date=(i:HouseholdStockItem)=>consumptionDate(i)??'9999-12-31';
 return date(a).localeCompare(date(b))||(a.date_entree??'9999-12-31').localeCompare(b.date_entree??'9999-12-31')||`${a.source}:${a.id}`.localeCompare(`${b.source}:${b.id}`);
}
export function stockContent(item:{qte:number,unite:string,content_quantity?:number|null,content_unit?:string|null}){
 if(item.content_quantity!=null&&Number.isFinite(item.content_quantity)&&item.content_quantity>0&&item.content_unit){return {qte:item.qte*item.content_quantity,unite:item.content_unit}}
 return {qte:item.qte,unite:item.unite};
}
export function assertSameOrigin(request:Request){
 if(request.headers.get('sec-fetch-site')==='cross-site')throw new Error('Origine non autorisée.');
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)throw new Error('Origine non autorisée.');
}
