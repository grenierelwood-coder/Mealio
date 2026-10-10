import { mealioServerDb } from '../lib/supabase-server'
import { getRecipeDetailsFromCookiwiki, type RawRecipeIngredient } from './cookiwiki-fetcher'
import { loadReferenceData, cleanText, resolveIngredientDeterministic, convertQuantityToUnit, type ReferenceData } from './matcher'
import { pantryMode } from './pantry-policy'
import { parisDate } from './pantry-history-policy'
import { analyseHistory, isPastMeal, type HistoryData, type HistoryMeal, type HistoryNeed, type HistoryPurchase, type HistoryConsumption } from './household-history-policy'

/** Stable pagination: every private query obtains ownership from the server-side session. */
async function pages(query:()=>any):Promise<any[]>{
  const rows:any[]=[]
  for(let offset=0;;offset+=500){
    const {data,error}=await query().range(offset,offset+499)
    if(error)throw Object.assign(new Error(error.message),{code:error.code})
    rows.push(...(data||[]));if(!data || data.length<500)return rows
  }
}
function mealNeeds(lines:RawRecipeIngredient[], ref:ReferenceData, ratio:number, ancestors=new Set<string>()):HistoryNeed[]{
  return lines.flatMap(line=>{
    const resolved=resolveIngredientDeterministic(line.name,ref)
    if(resolved.source==='ignored')return []
    if(!resolved.id){const memory=ref.aiResolutionMap.get(cleanText(line.name));if(memory?.statut==='valide'&&memory.ingredient_id_propose&&ref.officialById.has(memory.ingredient_id_propose))resolved.id=memory.ingredient_id_propose}
    const official=resolved.id?ref.officialById.get(resolved.id):undefined
    const preparation=resolved.id?ref.ingredientPreparations?.get(resolved.id):undefined
    if(preparation?.enabled && !ancestors.has(resolved.id!)){
      return mealNeeds(preparation.components,ref,ratio,new Set([...ancestors,resolved.id!]))
    }
    const presence=resolved.id?pantryMode(ref.pantryProducts?.get(resolved.id))==='presence':false
    const need:HistoryNeed={ingredient_id:resolved.id,produit:official?.nom||line.name,quantity:null,unite:presence?'Présence':official?.unite_reference||line.unit,presence}
    if(!official){need.warning='Association officielle absente ; exclu des moyennes.';return [need]}
    if(presence)return [need]
    if(line.preparationIssue || line.inferredFromInstructions || line.quantityEstimated || !Number.isFinite(line.qty) || line.qty<=0 || !Number.isFinite(ratio) || ratio<=0){
      need.warning='Dose absente, estimée ou à vérifier ; exclue des moyennes.';return [need]
    }
    const amount=convertQuantityToUnit(ref,official.id,line.qty*ratio,line.unit,official.unite_reference||'')
    if(!amount){need.warning='Conversion indisponible ; exclu des moyennes.';return [need]}
    need.quantity=amount.qty;return [need]
  })
}
export async function getHouseholdHistory(username:string,now=new Date()):Promise<HistoryData>{
  const today=parisDate(now)!
  const warnings:string[]=[]
  const [plans,events,lists,ref,thresholds,recurring]=await Promise.all([
    pages(()=>mealioServerDb.from('meal_plans').select('id,recipe_id,scheduled_date,meal_type,servings').eq('user_id',username).order('id')),
    pages(()=>mealioServerDb.from('meal_consumption_events').select('meal_plan_id,recipe_id,recipe_nom,scheduled_date,servings,status,consumed_items').eq('user_id',username).order('meal_plan_id')),
    pages(()=>mealioServerDb.from('shopping_lists').select('id').eq('user_id',username).order('id')),
    loadReferenceData(username),
    pages(()=>mealioServerDb.from('stock_replenishment_thresholds').select('ingredient_id').eq('user_id',username).order('id')),
    pages(()=>mealioServerDb.from('recurring_purchase_rules').select('ingredient_id,produit').eq('user_id',username).order('id')),
  ])
  const purchases:HistoryPurchase[]=[]
  for(let i=0;i<lists.length;i+=100){
    purchases.push(...await pages(()=>mealioServerDb.from('shopping_purchase_events')
      .select('id,list_id,produit,ingredient_id,quantity,unite,purchased_at,status,storage,location_name')
      .in('list_id',lists.slice(i,i+100).map(l=>l.id)).order('id')))
  }
  purchases.sort((a,b)=>b.purchased_at.localeCompare(a.purchased_at))
  let canActivate=true
  let decisions:any[]=[]
  try{decisions=await pages(()=>mealioServerDb.from('household_history_decisions').select('recommendation_key,decision,until_date').eq('user_id',username).order('recommendation_key'))}
  catch(error){if(!['42P01','PGRST205'].includes(String((error as {code?:string}).code)))throw error;canActivate=false;warnings.push('Appliquer le SQL Mealio 1.2.28 pour activer ou reporter les recommandations. L’historique reste consultable.')}
  const byPlan=new Map(events.map(e=>[e.meal_plan_id,e]))
  const meals:HistoryMeal[]=plans.filter(p=>isPastMeal(p.scheduled_date,today) && !byPlan.has(p.id)).map(p=>({
    id:p.id,recipe_id:p.recipe_id,recipe_nom:'Recette',scheduled_date:p.scheduled_date,servings:Number(p.servings),meal_type:p.meal_type||'',origin:'planning',needs:[],
  }))
  // A confirmed snapshot survives deletion of its planning entry. It is not counted again as an inferred meal.
  for(const e of events){
    if(!isPastMeal(e.scheduled_date,today))continue
    const origin=e.status==='confirmed'?'confirmed':e.status==='skipped'?'skipped':'processing'
    meals.push({id:e.meal_plan_id,recipe_id:e.recipe_id,recipe_nom:e.recipe_nom||'Recette',scheduled_date:e.scheduled_date,
      servings:Number(e.servings),meal_type:plans.find(p=>p.id===e.meal_plan_id)?.meal_type||'',origin,needs:[]})
  }
  const recipes=new Map<string,Awaited<ReturnType<typeof getRecipeDetailsFromCookiwiki>>>()
  const ids=[...new Set(meals.filter(m=>['planning','confirmed'].includes(m.origin)).map(m=>m.recipe_id))]
  // Four concurrent reads at most; no Claude, no Matcher learning, no stock mutation.
  for(let i=0;i<ids.length;i+=4){
    await Promise.all(ids.slice(i,i+4).map(async id=>{
      try{recipes.set(id,await getRecipeDetailsFromCookiwiki(id))}
      catch{warnings.push(`Recette ${id} indisponible : besoins exclus des moyennes.`)}
    }))
  }
  for(const meal of meals){
    const recipe=recipes.get(meal.recipe_id)
    if(recipe){if(meal.origin==='planning')meal.recipe_nom=recipe.nom;meal.needs=mealNeeds(recipe.ingredients,ref,meal.servings/recipe.baseServings)}
  }
  meals.sort((a,b)=>b.scheduled_date.localeCompare(a.scheduled_date)||a.id.localeCompare(b.id))
  const consumptions:HistoryConsumption[]=events.filter(e=>e.status==='confirmed').flatMap(e=>
    (Array.isArray(e.consumed_items)?e.consumed_items:[]).filter((item:any)=>Number.isFinite(Number(item.qte))&&Number(item.qte)>0).map((item:any,index:number)=>({
      id:`${e.meal_plan_id}:${index}`,date:e.scheduled_date,recipe_nom:e.recipe_nom||'Recette',produit:String(item.produit||'Produit'),
      quantity:Number(item.qte),unite:String(item.unite||''),source:String(item.source||''),
    })))
  consumptions.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id))
  const existing=new Set<string>([...thresholds,...recurring].map(r=>r.ingredient_id || (r.produit?resolveIngredientDeterministic(r.produit,ref).id:null)).filter(Boolean))
  const hidden=new Set<string>(decisions.filter(d=>d.decision==='accepted'||(d.until_date && d.until_date>=today)).map(d=>d.recommendation_key))
  const products=ref.officialList.map(p=>{
    const policy=ref.pantryProducts?.get(p.id)
    return {id:p.id,nom:p.nom,unite:p.unite_reference||'',presence:pantryMode(policy)==='presence',pack:Number(policy?.default_quantity||0),packUnit:policy?.default_unit||''}
  })
  return {household:username,today,purchases,meals,consumptions,analysis:analyseHistory(meals,purchases,today,products,existing,hidden,now),
    canActivate,warnings:[...new Set(warnings)]}
}
