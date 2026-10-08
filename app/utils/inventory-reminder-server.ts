import { mealioServerDb,frostiServerDb,cellioServerDb } from '../lib/supabase-server'
import { requireHousehold } from './household-server'
import { inventoryDeadline,type InventoryReminder } from './inventory-reminder-policy'
export async function householdInventoryPlaces(username:string){
 const h=await requireHousehold(username)
 const [f,c]=await Promise.all([h.frostiUserId?frostiServerDb.from('freezers').select('id,name').eq('user_id',h.frostiUserId):Promise.resolve({data:[],error:null}),h.cellioUserId?cellioServerDb.from('cellars').select('id,name').eq('user_id',h.cellioUserId):Promise.resolve({data:[],error:null})])
 if(f.error||c.error)throw new Error('Lecture des lieux Frosti/Cellio impossible.')
 return [...(f.data||[]).map(r=>({source:'frosti' as const,location_id:r.id,name:r.name})),...(c.data||[]).map(r=>({source:'cellio' as const,location_id:r.id,name:r.name}))]
}
export async function loadInventoryReminders(username:string):Promise<{locations:InventoryReminder[];warning?:string}>{
 const [places,result]=await Promise.all([householdInventoryPlaces(username),mealioServerDb.from('household_inventory_reminders').select('source,location_id,interval_weeks,last_completed_at,configured_at').eq('user_id',username)])
 if(result.error){if(['42P01','PGRST205'].includes(result.error.code))return {locations:[],warning:'Rappels d’inventaire : exécuter le SQL Mealio 1.2.22 pour activer leur paramétrage.'};throw new Error(result.error.message)}
 return {locations:places.map(p=>{const row=(result.data||[]).find(r=>r.source===p.source&&r.location_id===p.location_id);const setting={interval_weeks:row?.interval_weeks??null,last_completed_at:row?.last_completed_at??null,configured_at:row?.configured_at??null};return {...p,...setting,...inventoryDeadline(setting)}})}
}
