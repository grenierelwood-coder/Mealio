import { mealioServerDb } from '../lib/supabase-server'
import {
  getHouseholdStockServer,
  updateHouseholdStockItem,
  HouseholdStockItem,
} from './household-server'
import {
  loadReferenceData,
  resolveRecipeIngredients,
  resolveStockIngredientId,
  convertStockQuantity,
  ResolvedIngredient,
  ReferenceData,
} from './matcher'
import { getRecipeDetailsFromCookiwiki } from './cookiwiki-fetcher'
import { getMealPlans, MealPlan } from './meal-planner-server'

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
    (events ?? []).map((row: any) => String(row.meal_plan_id))
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
    const stockIngredientId = resolveStockIngredientId(refData, stock.produit)
    if (stockIngredientId === ingredientId) return true
  }

  const normalize = (value: string) =>
    value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  return normalize(stock.produit) === normalize(product)
}

async function decrementForPlan(
  username: string,
  plan: MealPlan,
): Promise<ConsumptionResult> {
  const recipe = await getRecipeDetailsFromCookiwiki(plan.recipe_id)
  const refData = await loadReferenceData()
  const resolved = await resolveRecipeIngredients(
    recipe.ingredients.map(ingredient => ({
      name: ingredient.name,
      qty: ingredient.qty,
      unit: ingredient.unit,
    })),
    refData,
    recipe.id,
    recipe.nom,
    plan.servings / recipe.baseServings,
  )

  const stock = await getHouseholdStockServer(username)
  const remaining = new Map(stock.map(item => [
    `${item.source}:${item.id}`,
    Number(item.qte || 0),
  ]))

  const consumed: ConsumptionResult['consumed'] = []
  const shortages: ConsumptionResult['shortages'] = []

  for (const need of resolved) {
    if (!need.ingredient_id || need.needs_review || !Number.isFinite(need.qte) || need.qte <= 0) {
      shortages.push({ produit: need.produit, qte: need.qte, unite: need.unite })
      continue
    }

    let remainingNeed = need.qte

    const candidates = stock.filter(item =>
      sameIngredient(refData, item, need.ingredient_id, need.produit)
    )

    for (const item of candidates) {
      if (remainingNeed <= 0) break

      const key = `${item.source}:${item.id}`
      const availableRaw = remaining.get(key) ?? 0
      if (availableRaw <= 0) continue

      const converted = convertStockQuantity(
        refData,
        need.ingredient_id,
        availableRaw,
        item.unite,
        need.unite,
      )

      if (!converted || converted.qty <= 0) continue

      const usedTarget = Math.min(remainingNeed, converted.qty)
      const rawToConsume = usedTarget * availableRaw / converted.qty
      const newRaw = Math.max(0, availableRaw - rawToConsume)

      await updateHouseholdStockItem(username, item.id, {
        source: item.source,
        qte: newRaw,
      })

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

  return {
    meal_plan_id: plan.id,
    recipe_nom: recipe.nom,
    status: 'confirmed',
    consumed,
    shortages,
  }
}

export async function confirmMealConsumption(
  username: string,
  mealPlanId: string,
  confirmed: boolean,
): Promise<ConsumptionResult> {
  const plan = (await getMealPlans(username)).find(plan => plan.id === mealPlanId)
  if (!plan) throw new Error('Repas planifié introuvable.')

  const { data: existing } = await mealioServerDb
    .from('meal_consumption_events')
    .select('meal_plan_id,status,recipe_nom')
    .eq('user_id', username)
    .eq('meal_plan_id', mealPlanId)
    .maybeSingle()

  if (existing) {
    return {
      meal_plan_id: mealPlanId,
      recipe_nom: existing.recipe_nom ?? 'Recette',
      status: existing.status === 'processing' ? 'confirmed' : existing.status,
      consumed: [],
      shortages: [],
    }
  }

  const recipe = await getRecipeDetailsFromCookiwiki(plan.recipe_id)

  if (!confirmed) {
    const { error } = await mealioServerDb
      .from('meal_consumption_events')
      .insert({
        user_id: username,
        meal_plan_id: mealPlanId,
        recipe_id: plan.recipe_id,
        recipe_nom: recipe.nom,
        scheduled_date: plan.scheduled_date,
        servings: plan.servings,
        status: 'skipped',
      })

    if (error) throw new Error(`Erreur enregistrement refus : ${error.message}`)

    return {
      meal_plan_id: mealPlanId,
      recipe_nom: recipe.nom,
      status: 'skipped',
      consumed: [],
      shortages: [],
    }
  }

  // On réserve le traitement AVANT de toucher aux stocks.
  // L'index unique (foyer, repas) empêche deux confirmations concurrentes
  // de décrémenter deux fois le même repas.
  const { data: claimed, error: claimError } = await mealioServerDb
    .from('meal_consumption_events')
    .insert({
      user_id: username,
      meal_plan_id: mealPlanId,
      recipe_id: plan.recipe_id,
      recipe_nom: recipe.nom,
      scheduled_date: plan.scheduled_date,
      servings: plan.servings,
      status: 'processing',
    })
    .select('meal_plan_id,status,recipe_nom')
    .single()

  if (claimError || !claimed) {
    const { data: concurrent } = await mealioServerDb
      .from('meal_consumption_events')
      .select('meal_plan_id,status,recipe_nom')
      .eq('user_id', username)
      .eq('meal_plan_id', mealPlanId)
      .maybeSingle()

    if (concurrent) {
      return {
        meal_plan_id: mealPlanId,
        recipe_nom: concurrent.recipe_nom ?? recipe.nom,
        status: 'confirmed',
        consumed: [],
        shortages: [],
      }
    }

    throw new Error(`Impossible de réserver la consommation : ${claimError?.message ?? 'erreur inconnue'}`)
  }

  const result = await decrementForPlan(username, plan)

  const { error: finalizeError } = await mealioServerDb
    .from('meal_consumption_events')
    .update({
      status: 'confirmed',
      consumed_items: result.consumed,
      shortages: result.shortages,
    })
    .eq('user_id', username)
    .eq('meal_plan_id', mealPlanId)

  if (finalizeError) {
    throw new Error(`Stocks décrémentés mais journal de consommation non finalisé : ${finalizeError.message}`)
  }

  return result
}
