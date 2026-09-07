import { mealioServerDb } from '../lib/supabase-server'

export type MealType = 'midi' | 'soir'

export type MealRole =
  | 'entree'
  | 'plat'
  | 'accompagnement'
  | 'dessert'
  | 'autre'

export interface MealPlan {
  id: string
  user_id: string
  recipe_id: string
  scheduled_date: string
  meal_type: MealType
  role: MealRole
  servings: number
}

export interface CreateMealPlanInput {
  recipe_id: string
  scheduled_date: string
  meal_type?: MealType
  role?: MealRole
  servings?: number
}

export interface UpdateMealPlanInput {
  recipe_id?: string
  scheduled_date?: string
  meal_type?: MealType
  role?: MealRole
  servings?: number
}

function validateDate(value: string): string {
  const date = value?.trim()

  if (!date) {
    throw new Error('La date du repas est obligatoire.')
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(
      'La date du repas doit être au format YYYY-MM-DD.'
    )
  }

  return date
}

function validateRecipeId(value: string): string {
  const recipeId = value?.trim()

  if (!recipeId) {
    throw new Error('La recette est obligatoire.')
  }

  return recipeId
}

function validateMealType(value?: string): MealType {
  if (!value) {
    return 'midi'
  }

  if (value !== 'midi' && value !== 'soir') {
    throw new Error(
      'Le moment du repas doit être "midi" ou "soir".'
    )
  }

  return value
}

function validateMealRole(value?: string): MealRole {
  if (!value) {
    return 'plat'
  }

  const allowed: MealRole[] = [
    'entree',
    'plat',
    'accompagnement',
    'dessert',
    'autre',
  ]

  if (!allowed.includes(value as MealRole)) {
    throw new Error('Rôle du repas invalide.')
  }

  return value as MealRole
}

function validateServings(value?: number): number {
  if (value === undefined || value === null) {
    return 4
  }

  const servings = Number(value)

  if (!Number.isFinite(servings)) {
    throw new Error('Le nombre de portions est invalide.')
  }

  if (servings < 1) {
    throw new Error(
      'Le nombre de portions doit être supérieur ou égal à 1.'
    )
  }

  return Math.round(servings)
}

export async function getMealPlans(
  username: string
): Promise<MealPlan[]> {
  const normalizedUsername = username.trim()

  if (!normalizedUsername) {
    throw new Error('Nom utilisateur absent.')
  }

  const { data, error } = await mealioServerDb
    .from('meal_plans')
    .select(
      `
        id,
        user_id,
        recipe_id,
        scheduled_date,
        meal_type,
        role,
        servings
      `
    )
    .eq('user_id', normalizedUsername)
    .order('scheduled_date', { ascending: true })
    .order('meal_type', { ascending: true })

  if (error) {
    throw new Error(
      `Erreur lecture planning : ${error.message}`
    )
  }

  return (data ?? []).map((plan: any) => ({
    id: plan.id,
    user_id: plan.user_id,
    recipe_id: plan.recipe_id,
    scheduled_date: plan.scheduled_date,
    meal_type: plan.meal_type ?? 'midi',
    role: plan.role ?? 'plat',
    servings: Number(plan.servings ?? 4),
  }))
}

export async function getMealPlanById(
  username: string,
  planId: string
): Promise<MealPlan> {
  const normalizedUsername = username.trim()
  const normalizedPlanId = planId.trim()

  if (!normalizedUsername) {
    throw new Error('Nom utilisateur absent.')
  }

  if (!normalizedPlanId) {
    throw new Error('Identifiant du repas absent.')
  }

  const { data, error } = await mealioServerDb
    .from('meal_plans')
    .select(
      `
        id,
        user_id,
        recipe_id,
        scheduled_date,
        meal_type,
        role,
        servings
      `
    )
    .eq('id', normalizedPlanId)
    .eq('user_id', normalizedUsername)
    .maybeSingle()

  if (error) {
    throw new Error(
      `Erreur lecture repas planifié : ${error.message}`
    )
  }

  if (!data) {
    throw new Error('Repas planifié introuvable.')
  }

  return {
    id: data.id,
    user_id: data.user_id,
    recipe_id: data.recipe_id,
    scheduled_date: data.scheduled_date,
    meal_type: data.meal_type ?? 'midi',
    role: data.role ?? 'plat',
    servings: Number(data.servings ?? 4),
  }
}

export async function createMealPlan(
  username: string,
  input: CreateMealPlanInput
): Promise<MealPlan> {
  const normalizedUsername = username.trim()

  if (!normalizedUsername) {
    throw new Error('Nom utilisateur absent.')
  }

  const recipeId = validateRecipeId(input.recipe_id)
  const scheduledDate = validateDate(input.scheduled_date)
  const mealType = validateMealType(input.meal_type)
  const role = validateMealRole(input.role)
  const servings = validateServings(input.servings)

  const payload = {
    user_id: normalizedUsername,
    recipe_id: recipeId,
    scheduled_date: scheduledDate,
    meal_type: mealType,
    role,
    servings,
  }

  const { data, error } = await mealioServerDb
    .from('meal_plans')
    .insert(payload)
    .select(
      `
        id,
        user_id,
        recipe_id,
        scheduled_date,
        meal_type,
        role,
        servings
      `
    )
    .single()

  if (error) {
    throw new Error(
      `Erreur création repas planifié : ${error.message}`
    )
  }

  return {
    id: data.id,
    user_id: data.user_id,
    recipe_id: data.recipe_id,
    scheduled_date: data.scheduled_date,
    meal_type: data.meal_type ?? 'midi',
    role: data.role ?? 'plat',
    servings: Number(data.servings ?? 4),
  }
}

export async function updateMealPlan(
  username: string,
  planId: string,
  input: UpdateMealPlanInput
): Promise<MealPlan> {
  const normalizedUsername = username.trim()
  const normalizedPlanId = planId.trim()

  if (!normalizedUsername) {
    throw new Error('Nom utilisateur absent.')
  }

  if (!normalizedPlanId) {
    throw new Error('Identifiant du repas absent.')
  }

  const payload: Record<string, unknown> = {}

  if (input.recipe_id !== undefined) {
    payload.recipe_id = validateRecipeId(input.recipe_id)
  }

  if (input.scheduled_date !== undefined) {
    payload.scheduled_date = validateDate(input.scheduled_date)
  }

  if (input.meal_type !== undefined) {
    payload.meal_type = validateMealType(input.meal_type)
  }

  if (input.role !== undefined) {
    payload.role = validateMealRole(input.role)
  }

  if (input.servings !== undefined) {
    payload.servings = validateServings(input.servings)
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('Aucune modification demandée.')
  }

  const { data, error } = await mealioServerDb
    .from('meal_plans')
    .update(payload)
    .eq('id', normalizedPlanId)
    .eq('user_id', normalizedUsername)
    .select(
      `
        id,
        user_id,
        recipe_id,
        scheduled_date,
        meal_type,
        role,
        servings
      `
    )
    .maybeSingle()

  if (error) {
    throw new Error(
      `Erreur modification repas planifié : ${error.message}`
    )
  }

  if (!data) {
    throw new Error('Repas planifié introuvable.')
  }

  return {
    id: data.id,
    user_id: data.user_id,
    recipe_id: data.recipe_id,
    scheduled_date: data.scheduled_date,
    meal_type: data.meal_type ?? 'midi',
    role: data.role ?? 'plat',
    servings: Number(data.servings ?? 4),
  }
}

export async function deleteMealPlan(
  username: string,
  planId: string
): Promise<void> {
  const normalizedUsername = username.trim()
  const normalizedPlanId = planId.trim()

  if (!normalizedUsername) {
    throw new Error('Nom utilisateur absent.')
  }

  if (!normalizedPlanId) {
    throw new Error('Identifiant du repas absent.')
  }

  const { data, error } = await mealioServerDb
    .from('meal_plans')
    .delete()
    .eq('id', normalizedPlanId)
    .eq('user_id', normalizedUsername)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(
      `Erreur suppression repas planifié : ${error.message}`
    )
  }

  if (!data) {
    throw new Error('Repas planifié introuvable.')
  }
}