import { frostiServerDb, cellioServerDb } from '../lib/supabase-server'

export type StorageSource = 'frosti' | 'cellio'
export type RoutingScope = 'default' | 'category' | 'ingredient'
export type RoutingMode = 'any' | 'fridge' | 'freezer'

export interface StorageRoutingRule {
  id: string
  user_id: string
  scope: RoutingScope
  category: string | null
  ingredient_id: string | null
  location_id: string
  mode: RoutingMode
  priority: number
  is_active: boolean
}

export interface StorageLocation {
  id: string
  name: string
  is_fridge?: boolean | null
  is_secondary?: boolean | null
}

export interface RoutingIngredient {
  id: string
  nom: string
  categorie: string | null
  default_is_fridge: boolean | null
}

export interface ResolvedStorageLocation {
  source: StorageSource
  location_id: string
  location_name: string
  rule_id: string
  rule_scope: RoutingScope
  rule_label: string
}

function dbFor(source: StorageSource) {
  return source === 'frosti' ? frostiServerDb : cellioServerDb
}

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function rowToRule(row: any, source: StorageSource): StorageRoutingRule {
  if (source === 'frosti') {
    const scope: RoutingScope = row.rule_type === 'category'
      ? 'category'
      : row.rule_type === 'ingredient'
        ? 'ingredient'
        : 'default'

    const mode: RoutingMode = row.rule_type === 'default_fridge'
      ? 'fridge'
      : row.rule_type === 'default_freezer'
        ? 'freezer'
        : 'any'

    return {
      id: row.id,
      user_id: row.user_id,
      scope,
      category: row.category ?? null,
      ingredient_id: row.ingredient_id ?? null,
      location_id: row.freezer_id,
      mode,
      priority: Number(row.priority ?? 100),
      is_active: row.is_active !== false,
    }
  }

  return {
    id: row.id,
    user_id: row.user_id,
    scope: row.rule_type as RoutingScope,
    category: row.category ?? null,
    ingredient_id: row.ingredient_id ?? null,
    location_id: row.cellar_id,
    mode: 'any',
    priority: Number(row.priority ?? 100),
    is_active: row.is_active !== false,
  }
}

export async function listStorageRoutingRules(source: StorageSource, userId: string) {
  const select = source === 'frosti'
    ? 'id,user_id,rule_type,category,ingredient_id,freezer_id,priority,is_active'
    : 'id,user_id,rule_type,category,ingredient_id,cellar_id,priority,is_active'

  const { data, error } = await dbFor(source)
    .from('storage_routing_rules')
    .select(select)
    .eq('user_id', userId)
    .order('priority', { ascending: true })

  if (error) throw new Error(`Erreur lecture règles ${source} : ${error.message}`)
  return (data ?? []).map(row => rowToRule(row, source))
}

export async function listStorageLocations(source: StorageSource, userId: string): Promise<StorageLocation[]> {
  if (source === 'frosti') {
    const { data, error } = await frostiServerDb
      .from('freezers')
      .select('id,name,is_fridge')
      .eq('user_id', userId)
      .order('name', { ascending: true })
    if (error) throw new Error(`Erreur lecture emplacements Frosti : ${error.message}`)
    return (data ?? []) as StorageLocation[]
  }

  const { data, error } = await cellioServerDb
    .from('cellars')
    .select('id,name,is_secondary')
    .eq('user_id', userId)
    .order('name', { ascending: true })
  if (error) throw new Error(`Erreur lecture emplacements Cellio : ${error.message}`)
  return (data ?? []) as StorageLocation[]
}

export async function resolveStorageLocation(
  source: StorageSource,
  userId: string,
  ingredient: RoutingIngredient,
): Promise<ResolvedStorageLocation | null> {
  const [rules, locations] = await Promise.all([
    listStorageRoutingRules(source, userId),
    listStorageLocations(source, userId),
  ])

  const locationMap = new Map(locations.map(location => [location.id, location]))
  const category = normalize(ingredient.categorie)

  let candidates = rules.filter(rule => rule.is_active)

  if (source === 'frosti') {
    // Ingredient/category exceptions are absolute: they select the exact Frosti location.
    const exactIngredient = candidates.filter(
      rule => rule.scope === 'ingredient' && rule.ingredient_id === ingredient.id,
    ).sort((a, b) => Number(a.priority) - Number(b.priority))[0]

    if (exactIngredient) return resolved(exactIngredient, locationMap, source, ingredient)

    const exactCategory = candidates.filter(
      rule => rule.scope === 'category' && normalize(rule.category) === category,
    ).sort((a, b) => Number(a.priority) - Number(b.priority))[0]

    if (exactCategory) return resolved(exactCategory, locationMap, source, ingredient)

    const defaultType = ingredient.default_is_fridge === true ? 'fridge' : 'freezer'
    const defaultRule = candidates
      .filter(rule => rule.scope === 'default' && rule.mode === defaultType)
      .sort((a, b) => Number(a.priority) - Number(b.priority))[0]

    return defaultRule ? resolved(defaultRule, locationMap, source, ingredient) : null
  }

  const exactIngredient = candidates.filter(
    rule => rule.scope === 'ingredient' && rule.ingredient_id === ingredient.id,
  ).sort((a, b) => Number(a.priority) - Number(b.priority))[0]
  if (exactIngredient) return resolved(exactIngredient, locationMap, source, ingredient)

  const exactCategory = candidates.filter(
    rule => rule.scope === 'category' && normalize(rule.category) === category,
  ).sort((a, b) => Number(a.priority) - Number(b.priority))[0]
  if (exactCategory) return resolved(exactCategory, locationMap, source, ingredient)

  const defaultRule = candidates
    .filter(rule => rule.scope === 'default')
    .sort((a, b) => Number(a.priority) - Number(b.priority))[0]

  return defaultRule ? resolved(defaultRule, locationMap, source, ingredient) : null
}

function resolved(
  rule: StorageRoutingRule,
  locationMap: Map<string, StorageLocation>,
  source: StorageSource,
  ingredient: RoutingIngredient,
): ResolvedStorageLocation | null {
  const location = locationMap.get(rule.location_id)
  if (!location) return null

  const ruleLabel = rule.scope === 'ingredient'
    ? `Exception : ${ingredient.nom}`
    : rule.scope === 'category'
      ? `Catégorie : ${rule.category ?? ingredient.categorie ?? '—'}`
      : source === 'frosti'
        ? rule.mode === 'fridge' ? 'Défaut : frigo Maison' : 'Défaut : congélateur Maison'
        : 'Défaut Cellio'

  return {
    source,
    location_id: location.id,
    location_name: location.name,
    rule_id: rule.id,
    rule_scope: rule.scope,
    rule_label: ruleLabel,
  }
}

export async function createStorageRoutingRule(
  source: StorageSource,
  userId: string,
  input: {
    scope: RoutingScope
    category?: string | null
    ingredient_id?: string | null
    location_id: string
    mode?: RoutingMode
    priority?: number
    is_active?: boolean
  },
): Promise<StorageRoutingRule> {
  validateInput(source, input)
  const locations = await listStorageLocations(source, userId)
  if (!locations.some(location => location.id === input.location_id)) {
    throw new Error('L’emplacement choisi n’appartient pas à ce foyer.')
  }

  const payload = source === 'frosti'
    ? {
        user_id: userId,
        rule_type: input.scope === 'default'
          ? (input.mode === 'fridge' ? 'default_fridge' : 'default_freezer')
          : input.scope,
        category: input.scope === 'category' ? input.category!.trim() : null,
        ingredient_id: input.scope === 'ingredient' ? input.ingredient_id : null,
        freezer_id: input.location_id,
        priority: Number(input.priority ?? 100),
        is_active: input.is_active !== false,
      }
    : {
        user_id: userId,
        rule_type: input.scope,
        category: input.scope === 'category' ? input.category!.trim() : null,
        ingredient_id: input.scope === 'ingredient' ? input.ingredient_id : null,
        cellar_id: input.location_id,
        priority: Number(input.priority ?? 100),
        is_active: input.is_active !== false,
      }

  const { data, error } = await dbFor(source)
    .from('storage_routing_rules')
    .insert(payload)
    .select(source === 'frosti'
      ? 'id,user_id,rule_type,category,ingredient_id,freezer_id,priority,is_active'
      : 'id,user_id,rule_type,category,ingredient_id,cellar_id,priority,is_active')
    .single()

  if (error) throw new Error(`Erreur création règle ${source} : ${error.message}`)
  return rowToRule(data, source)
}

export async function updateStorageRoutingRule(
  source: StorageSource,
  userId: string,
  id: string,
  input: Partial<{
    scope: RoutingScope
    category: string | null
    ingredient_id: string | null
    location_id: string
    mode: RoutingMode
    priority: number
    is_active: boolean
  }>,
): Promise<StorageRoutingRule> {
  const currentRules = await listStorageRoutingRules(source, userId)
  const current = currentRules.find(rule => rule.id === id)
  if (!current) throw new Error('Règle introuvable.')

  const scope = input.scope ?? current.scope
  const category = input.category !== undefined ? input.category : current.category
  const ingredientId = input.ingredient_id !== undefined ? input.ingredient_id : current.ingredient_id
  const locationId = input.location_id ?? current.location_id
  const mode = input.mode ?? current.mode

  validateInput(source, { scope, category, ingredient_id: ingredientId, location_id: locationId, mode })
  const locations = await listStorageLocations(source, userId)
  if (!locations.some(location => location.id === locationId)) {
    throw new Error('L’emplacement choisi n’appartient pas à ce foyer.')
  }

  const payload = source === 'frosti'
    ? {
        rule_type: scope === 'default' ? (mode === 'fridge' ? 'default_fridge' : 'default_freezer') : scope,
        category: scope === 'category' ? category!.trim() : null,
        ingredient_id: scope === 'ingredient' ? ingredientId : null,
        freezer_id: locationId,
        priority: Number(input.priority ?? current.priority),
        is_active: input.is_active ?? current.is_active,
      }
    : {
        rule_type: scope,
        category: scope === 'category' ? category!.trim() : null,
        ingredient_id: scope === 'ingredient' ? ingredientId : null,
        cellar_id: locationId,
        priority: Number(input.priority ?? current.priority),
        is_active: input.is_active ?? current.is_active,
      }

  const { data, error } = await dbFor(source)
    .from('storage_routing_rules')
    .update(payload)
    .eq('id', id)
    .eq('user_id', userId)
    .select(source === 'frosti'
      ? 'id,user_id,rule_type,category,ingredient_id,freezer_id,priority,is_active'
      : 'id,user_id,rule_type,category,ingredient_id,cellar_id,priority,is_active')
    .single()

  if (error) throw new Error(`Erreur modification règle ${source} : ${error.message}`)
  return rowToRule(data, source)
}

export async function deleteStorageRoutingRule(source: StorageSource, userId: string, id: string) {
  const { error } = await dbFor(source)
    .from('storage_routing_rules')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
  if (error) throw new Error(`Erreur suppression règle ${source} : ${error.message}`)
}

function validateInput(
  source: StorageSource,
  input: { scope: RoutingScope; category?: string | null; ingredient_id?: string | null; location_id: string; mode?: RoutingMode },
) {
  if (!['default', 'category', 'ingredient'].includes(input.scope)) throw new Error('Type de règle invalide.')
  if (!input.location_id) throw new Error('L’emplacement est obligatoire.')
  if (input.scope === 'category' && !input.category?.trim()) throw new Error('La catégorie est obligatoire.')
  if (input.scope === 'ingredient' && !input.ingredient_id) throw new Error('L’ingrédient est obligatoire.')
  if (source === 'frosti' && input.scope === 'default' && !['fridge', 'freezer'].includes(input.mode ?? '')) {
    throw new Error('Une règle Frosti par défaut doit être Frigo ou Congélateur.')
  }
}
