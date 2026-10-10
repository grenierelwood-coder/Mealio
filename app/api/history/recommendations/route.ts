import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { mealioServerDb } from '../../../lib/supabase-server'
import { getHouseholdHistory } from '../../../utils/household-history-server'
import { assertOfficialIngredientUnit } from '../../../utils/official-unit-policy'
import { addCalendarDays } from '../../../utils/pantry-history-policy'
export async function POST(request:Request){
  const username=(await getAuthSession())?.username?.trim()
  if(!username)return NextResponse.json({error:'Non authentifié.'},{status:401})
  try{
    const body=await request.json()
    if(!['accept','snooze'].includes(body.action))throw new Error('Action inconnue.')
    const history=await getHouseholdHistory(username)
    if(!history.canActivate)throw new Error('Appliquer le SQL Mealio 1.2.28 avant cette action.')
    const recommendation=history.analysis.recommendations.find(r=>r.key===body.key)
    if(!recommendation)return NextResponse.json({error:'Cette proposition n’est plus disponible. Actualiser l’historique.'},{status:409})
    if(body.action==='snooze'){
      const {error}=await mealioServerDb.from('household_history_decisions').upsert({user_id:username,recommendation_key:recommendation.key,
        decision:'snoozed',until_date:addCalendarDays(history.today,30)},{onConflict:'user_id,recommendation_key'})
      if(error)throw new Error(error.message)
      return NextResponse.json({message:'Proposition reportée de 30 jours.'})
    }
    const quantity=Number(body.quantity),minimum=Number(body.minimum??recommendation.minimum),interval=Number(body.interval_days??recommendation.interval_days)
    if(!Number.isFinite(quantity)||quantity<=0||quantity>1e9)throw new Error('Quantité positive obligatoire.')
    if(recommendation.kind==='threshold'&&(!Number.isFinite(minimum)||minimum<0||minimum>=quantity))throw new Error('La cible doit être supérieure au seuil, qui doit être positif ou nul.')
    if(recommendation.kind==='recurring'&&(!Number.isInteger(interval)||interval<1||interval>366))throw new Error('Fréquence : 1 à 366 jours.')
    const unit=await assertOfficialIngredientUnit(recommendation.ingredient_id,recommendation.unite,username)
    const {data,error}=await mealioServerDb.rpc('activate_history_replenishment',{
      p_user_id:username,p_key:recommendation.key,p_kind:recommendation.kind,p_ingredient_id:recommendation.ingredient_id,
      p_produit:recommendation.produit,p_unite:unit,p_quantity:quantity,p_minimum:minimum,
      p_interval_days:interval,p_next_due_date:recommendation.next_due_date,
    })
    if(error)throw new Error(error.message)
    return NextResponse.json({message:data?.already_exists?'Une règle existe déjà : aucune règle supplémentaire créée.':'Règle activée en mode proposition. Les achats restent à votre décision.',result:data})
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Action impossible.'},{status:400})}
}
