import { mealioServerDb } from '../lib/supabase-server'
import { loadPantryProducts } from './pantry-server'
import { addCalendarDays, parisDate, type PantryPurchase, type PantrySignal } from './pantry-history-policy'

export async function loadPantrySignals(username: string): Promise<PantrySignal[]> {
  const {data,error}=await mealioServerDb.from('household_pantry_signals')
    .select('ingredient_id,kind,signaled_at,until_date').eq('user_id',username)
  if(error) throw new Error(`Signaux épicerie indisponibles : ${error.message}`)
  return data ?? []
}
export async function loadHouseholdPurchases(username: string): Promise<PantryPurchase[]> {
  const lists: Array<{id:string}>=[]
  for(let offset=0;;offset+=1000){
    const {data,error}=await mealioServerDb.from('shopping_lists').select('id').eq('user_id',username)
      .order('id').range(offset,offset+999)
    if(error) throw new Error(`Historique des listes indisponible : ${error.message}`)
    lists.push(...(data ?? []));if(!data || data.length<1000) break
  }
  if(!lists.length) return []
  // No user-supplied list IDs: ownership is established server-side first.
  const events: PantryPurchase[]=[]
  const ids=lists.map((l:any)=>l.id)
  for(let start=0;start<ids.length;start+=100){
    for(let offset=0;;offset+=1000){
      const {data,error}=await mealioServerDb.from('shopping_purchase_events')
        .select('ingredient_id,quantity,unite,purchased_at,status').in('list_id',ids.slice(start,start+100))
        .order('purchased_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+999)
      if(error) throw new Error(`Historique des achats indisponible : ${error.message}`)
      events.push(...(data ?? []));if(!data || data.length<1000) break
    }
  }
  return events
}
export async function setPantrySignal(username: string, id: string, action: 'almost_finished'|'cancel'|'snooze') {
  const product=(await loadPantryProducts(username)).get(id)
  if(!product?.enabled) throw new Error('Ce produit doit être géré en présence pour votre foyer.')
  if(action==='cancel'){
    const {error}=await mealioServerDb.from('household_pantry_signals').delete()
      .eq('user_id',username).eq('ingredient_id',id).eq('kind','almost_finished')
    if(error) throw new Error(error.message)
    return
  }
  const {error}=await mealioServerDb.from('household_pantry_signals').upsert({user_id:username,ingredient_id:id,
    kind:action==='snooze'?'history_snooze':'almost_finished',signaled_at:new Date().toISOString(),
    until_date:action==='snooze'?addCalendarDays(parisDate(new Date())!,7):null,
  },{onConflict:'user_id,ingredient_id,kind'})
  if(error) throw new Error(error.message)
}
