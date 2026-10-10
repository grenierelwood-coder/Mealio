import {preparedPortionAllocator} from './prepared-portions-policy'
import {createHash} from 'node:crypto'
import { findJob,reserveJob,runJob,type EcosystemAction } from './ecosystem-jobs-server'
import { fefoOrder,stockContent } from './ecosystem-policy'
import { mealioServerDb } from '../lib/supabase-server'
import {
  getHouseholdStockServer,
  operationUuid,
  type HouseholdStockItem,
} from './household-server'
import {
  loadReferenceData,
  resolveRecipeIngredients,
  resolveStockIngredientId,
  convertStockQuantity,
  type ResolvedIngredient,
  type ReferenceData,
} from './matcher'
import { getRecipeDetailsFromCookiwiki } from './cookiwiki-fetcher'
import { getMealPlans, type MealPlan } from './meal-planner-server'

export type MealConsumptionStatus = 'confirmed' | 'skipped'

export interface PendingMeal {
  plan: MealPlan
  recipe_nom: string
}

export interface ConsumptionResult {
  meal_plan_id: string
  recipe_nom: string
  status: MealConsumptionStatus
  consumed: Array<{
    produit: string
    qte: number
    unite: string
    source: 'frosti' | 'cellio'
  }>
  shortages: Array<{
    produit: string
    qte: number
    unite: string
  }>
}

function todayParis(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
  }).format(new Date())
}

async function recipeNames(ids: string[]): Promise<Map<string, string>> {
  const entries = await Promise.all(
    ids.map(async id => {
      try {
        const recipe = await getRecipeDetailsFromCookiwiki(id)
        return [id, recipe.nom] as const
      } catch {
        return [id, 'Recette inconnue'] as const
      }
    })
  )
  return new Map(entries)
}

export async function getPendingMealConsumptions(username: string): Promise<PendingMeal[]> {
  const today = todayParis()
  const plans = await getMealPlans(username)
  const past = plans.filter(plan => plan.scheduled_date < today)

  if (!past.length) return []

  const { data: events, error } = await mealioServerDb
    .from('meal_consumption_events')
    .select('meal_plan_id,status')
    .eq('user_id', username)
    .in('meal_plan_id', past.map(plan => plan.id))

  if (error) {
    throw new Error(`Erreur lecture consommations : ${error.message}`)
  }

  const handled = new Set(
    (events ?? []).filter((row:any)=>row.status==='confirmed'||row.status==='skipped').map((row: any) => String(row.meal_plan_id))
  )

  const names = await recipeNames(past.map(plan => plan.recipe_id))

  return past
    .filter(plan => !handled.has(plan.id))
    .map(plan => ({
      plan,
      recipe_nom: names.get(plan.recipe_id) ?? 'Recette inconnue',
    }))
    .sort((a, b) => a.plan.scheduled_date.localeCompare(b.plan.scheduled_date))
}

function sameIngredient(
  refData: ReferenceData,
  stock: HouseholdStockItem,
  ingredientId: string | null,
  product: string,
): boolean {
  if (ingredientId) {
    if(stock.ingredient_id)return stock.ingredient_id===ingredientId
    const stockIngredientId = resolveStockIngredientId(refData, stock.produit)
    if (stockIngredientId === ingredientId) return true
  }

  const normalize = (value: string) =>
    value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  return normalize(stock.produit) === normalize(product)
}

export async function prepareConsumptionForPlan(
  username: string,
  plan: MealPlan,
): Promise<{result:ConsumptionResult,actions:EcosystemAction[]}> {
  const stock=await getHouseholdStockServer(username)
  const {data:link,error:linkError}=await mealioServerDb.from('meal_preparation_links').select('preparation_id,recipe_id').eq('user_id',username).eq('meal_plan_id',plan.id).maybeSingle();if(linkError)throw new Error(linkError.message)
  if(link){const preparation=await findJob(username,link.preparation_id);if(!preparation||preparation.status!=='completed')throw new Error('La préparation liée à ce repas est interrompue. Reprenez-la dans Écosystème ; aucun ingrédient supplémentaire ne sera déduit.')}
  const allocation=preparedPortionAllocator(stock).allocate(plan.recipe_id,plan.servings,link?.preparation_id)
  const remainingServings=allocation.missing
  const preparedActions:EcosystemAction[]=allocation.used.map(({lot,amount})=>({source:lot.source,action:'use',item_id:lot.id,payload:{amount,version:lot.version}}))
  const preparedConsumed:ConsumptionResult['consumed']=allocation.used.map(({lot,amount})=>({produit:lot.produit,qte:amount,unite:lot.unite,source:lot.source}))
  if(link||remainingServings<=1e-9){return {actions:preparedActions,result:{meal_plan_id:plan.id,recipe_nom:stock.find(i=>i.recipe_id===plan.recipe_id)?.produit??'Préparation maison',status:'confirmed',consumed:preparedConsumed,shortages:remainingServings>1e-9?[{produit:'Portions de la préparation liée',qte:remainingServings,unite:'portion(s)'}]:[]}}}
  const recipe = await getRecipeDetailsFromCookiwiki(plan.recipe_id)
  const refData = await loadReferenceData(username)
  const resolved = await resolveRecipeIngredients(recipe.ingredients.map(ingredient => ({name:ingredient.name,qty:ingredient.qty,unit:ingredient.unit,inferredFromInstructions:ingredient.inferredFromInstructions,preparationIssue:ingredient.preparationIssue})),refData,recipe.id,recipe.nom,remainingServings / recipe.baseServings)
  const remaining = new Map(stock.map(item => [
    `${item.source}:${item.id}`,
    Number(item.qte || 0),
  ]))

  const actions:EcosystemAction[]=[...preparedActions]
  const consumed: ConsumptionResult['consumed'] = [...preparedConsumed]
  const shortages: ConsumptionResult['shortages'] = []

  for (const need of resolved) {
    // Presence is a household choice, not a virtual quantity to consume.
    if (need.quantity_mode === 'presence') continue
    if (!need.ingredient_id || need.needs_review || !Number.isFinite(need.qte) || need.qte <= 0) {
      shortages.push({ produit: need.produit, qte: need.qte, unite: need.unite })
      continue
    }

    let remainingNeed = need.qte

    const candidates = stock.filter(item =>
      item.recipe_id!==plan.recipe_id && sameIngredient(refData, item, need.ingredient_id, need.produit)
    ).sort(fefoOrder)

    for (const item of candidates) {
      if (remainingNeed <= 0) break

      const key = `${item.source}:${item.id}`
      const availableRaw = remaining.get(key) ?? 0
      if (availableRaw <= 0) continue

      const converted = convertStockQuantity(
        refData,
        need.ingredient_id,
        stockContent({...item,qte:availableRaw}).qte,
        stockContent(item).unite,
        need.unite,
      )

      if (!converted || converted.qty <= 0) continue

      const usedTarget = Math.min(remainingNeed, converted.qty)
      const rawToConsume = usedTarget >= converted.qty ? availableRaw : Math.min(availableRaw,usedTarget * availableRaw / converted.qty)
      const newRaw = Math.max(0, availableRaw - rawToConsume)

      const existingAction=actions.find(a=>a.item_id===item.id&&a.source===item.source);
      if(existingAction) existingAction.payload.amount=Math.min(item.qte,Number(existingAction.payload.amount)+rawToConsume);
      else actions.push({source:item.source,action:'use',item_id:item.id,payload:{amount:rawToConsume,version:item.version}});

      remaining.set(key, newRaw)
      remainingNeed -= usedTarget

      consumed.push({
        produit: item.produit,
        qte: rawToConsume,
        unite: item.unite,
        source: item.source,
      })
    }

    if (remainingNeed > 1e-9) {
      shortages.push({
        produit: need.produit,
        qte: remainingNeed,
        unite: need.unite,
      })
    }
  }

  return {actions,result:{
    meal_plan_id: plan.id,
    recipe_nom: recipe.nom,
    status: 'confirmed',
    consumed,
    shortages,
  }}
}

export async function confirmMealConsumption(username:string,mealPlanId:string,confirmed:boolean,previewKey?:string):Promise<ConsumptionResult>{
 const plan=(await getMealPlans(username)).find(p=>p.id===mealPlanId);if(!plan)throw new Error('Repas planifié introuvable.');
 const {data:existing,error:readError}=await mealioServerDb.from('meal_consumption_events').select('*').eq('user_id',username).eq('meal_plan_id',mealPlanId).maybeSingle();if(readError)throw new Error(readError.message);
 if(existing&&['confirmed','skipped'].includes(existing.status))return {meal_plan_id:mealPlanId,recipe_nom:existing.recipe_nom??'Recette',status:existing.status,consumed:existing.consumed_items??[],shortages:existing.shortages??[]};
 const id=operationUuid(`consumption:${username}:${mealPlanId}`);let job=await findJob(username,id);
 if(existing?.status==='processing'&&!job&&!existing.ecosystem_version)throw new Error('Ancienne consommation interrompue : vérifiez l’inventaire avant une correction. Aucune nouvelle déduction automatique.');
 if(!confirmed){
  if(job)throw new Error('Une consommation est déjà engagée. Reprenez l’opération dans Écosystème ou choisissez Plus tard.')
  const {error}=await mealioServerDb.from('meal_consumption_events').upsert({user_id:username,meal_plan_id:mealPlanId,recipe_id:plan.recipe_id,recipe_nom:existing?.recipe_nom??'Repas non cuisiné',scheduled_date:plan.scheduled_date,servings:plan.servings,status:'skipped',ecosystem_version:1},{onConflict:'user_id,meal_plan_id',ignoreDuplicates:true});if(error)throw new Error(error.message)
  return {meal_plan_id:mealPlanId,recipe_nom:existing?.recipe_nom??'Repas non cuisiné',status:'skipped',consumed:[],shortages:[]}
 }
 let recipeName=existing?.recipe_nom??'Préparation maison';try{recipeName=(await getRecipeDetailsFromCookiwiki(plan.recipe_id)).nom}catch{/* prepared stock may still be consumable */}
 const recipe={nom:recipeName}
 const event={ecosystem_version:1,user_id:username,meal_plan_id:mealPlanId,recipe_id:plan.recipe_id,recipe_nom:recipe.nom,scheduled_date:plan.scheduled_date,servings:plan.servings}
 if(!job){
  const prepared=await prepareConsumptionForPlan(username,plan);
  if(previewKey&&previewKey!==consumptionPreviewKey(prepared.actions))throw new Error("Le stock a changé depuis la proposition. Vérifiez à nouveau les quantités.");
  const {error:claimError}=await mealioServerDb.from('meal_consumption_events').upsert({...event,status:'processing'},{onConflict:'user_id,meal_plan_id',ignoreDuplicates:true});if(claimError)throw new Error(claimError.message);
  const {data:claimed,error:claimRead}=await mealioServerDb.from('meal_consumption_events').select('*').eq('user_id',username).eq('meal_plan_id',mealPlanId).maybeSingle();if(claimRead)throw new Error(claimRead.message);
  if(claimed?.status==='confirmed')return {meal_plan_id:mealPlanId,recipe_nom:recipe.nom,status:'confirmed',consumed:claimed.consumed_items??[],shortages:claimed.shortages??[]};
  if(claimed?.status==='processing'&&!claimed.ecosystem_version)throw new Error('Ancienne consommation engagée : vérifiez l’inventaire.');
  if(claimed?.status==='skipped')return {meal_plan_id:mealPlanId,recipe_nom:recipe.nom,status:'skipped',consumed:[],shortages:[]};
  job=await reserveJob(username,id,'consumption',{meal_plan_id:mealPlanId},prepared.actions,prepared.result);
 }
 job=await runJob(username,id);
 return job.result;
}

export function consumptionPreviewKey(actions:EcosystemAction[]){return createHash('sha256').update(JSON.stringify(actions)).digest('hex')}
