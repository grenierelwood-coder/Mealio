import { mealioServerDb } from '../lib/supabase-server'
import { isPresenceOnlyIngredient } from './quantity-policy'
import { getHouseholdStockServer } from './household-server'
import { assertOfficialIngredientUnit } from './official-unit-policy'

export type ReplenishmentMode = 'suggestion' | 'systematic'

export interface FavoriteIngredient {
  ingredient_id: string
  nom: string
  categorie: string | null
  default_storage: string | null
  purchase_count: number
  last_purchased_at: string | null
  unite: string
}

export interface ThresholdRule {
  id: string
  user_id: string
  ingredient_id: string
  min_quantity: number
  target_quantity: number
  unite: string
  active: boolean
  mode: ReplenishmentMode
}

export interface RecurringRule {
  id: string
  user_id: string
  ingredient_id: string | null
  produit: string
  quantity: number
  unite: string
  rayon: string | null
  interval_days: number
  next_due_date: string
  mode: ReplenishmentMode
  active: boolean
}

export interface ReplenishmentSuggestion {
  key: string
  source: 'threshold' | 'recurring'
  rule_id: string
  ingredient_id: string | null
  produit: string
  quantity: number
  unite: string
  reason: string
  mode: ReplenishmentMode
  stock_quantity: number | null
  stock_unit: string | null
  min_quantity: number | null
  target_quantity: number | null
  due_date: string | null
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

function unitKey(value: string | null | undefined): string {
  const key = normalize(value)
  const aliases: Record<string, string> = {
    piece: 'piece', pieces: 'piece', pieceentier: 'piece', piecesentieres: 'piece', unite: 'piece', unites: 'piece',
    g: 'g', gramme: 'g', grammes: 'g',
    kg: 'kg', kilogramme: 'kg', kilogrammes: 'kg',
    mg: 'mg', milligramme: 'mg', milligrammes: 'mg',
    ml: 'ml', millilitre: 'ml', millilitres: 'ml',
    cl: 'cl', centilitre: 'cl', centilitres: 'cl',
    l: 'l', litre: 'l', litres: 'l',
  }
  return aliases[key] ?? key
}

function round(value: number): number {
  return Number(value.toFixed(4))
}

function parisToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  const d = parts.find(p => p.type === 'day')?.value
  return `${y}-${m}-${d}`
}

async function loadCanonicalUnits() {
  const { data, error } = await mealioServerDb
    .from('unit_mappings')
    .select('unite,abreviation,type_unite')
    .order('unite', { ascending: true })
  if (error) throw new Error(`Impossible de charger les unités : ${error.message}`)
  return (data ?? []).map((row: any) => ({
    unite: String(row.unite ?? '').trim(),
    abreviation: String(row.abreviation ?? '').trim(),
    type_unite: String(row.type_unite ?? '').trim(),
  })).filter((row: any) => row.unite)
}

function canonicalUnitFromRaw(raw: string | null | undefined, units: Array<{ unite: string; abreviation: string; type_unite: string }>): string {
  const value = String(raw ?? '').trim()
  if (!value) return 'Pièce'
  const direct = units.find(u => unitKey(u.unite) === unitKey(value) || (u.abreviation && unitKey(u.abreviation) === unitKey(value)))
  if (direct) return direct.unite

  // Some historical purchase events may contain a quantity in the unit field
  // (e.g. "1 mg" / "1mL"). Keep only the unit suffix before resolving it.
  const suffix = value.replace(/^[-+]?\d+(?:[.,]\d+)?\s*/, '').trim()
  const stripped = units.find(u => unitKey(u.unite) === unitKey(suffix) || (u.abreviation && unitKey(u.abreviation) === unitKey(suffix)))
  return stripped?.unite ?? 'Pièce'
}

export async function listFavorites(username: string): Promise<FavoriteIngredient[]> {
  const [eventsResult, preferencesResult, units] = await Promise.all([
    mealioServerDb
      .from('shopping_purchase_events')
      .select('ingredient_id,purchased_at,unite')
      .in(
        'list_id',
        (await mealioServerDb.from('shopping_lists').select('id').eq('user_id', username)).data?.map(r => r.id) ?? [],
      )
      .not('ingredient_id', 'is', null)
      .order('purchased_at', { ascending: false })
      .limit(2000),
    mealioServerDb
      .from('favorite_preferences')
      .select('ingredient_id,unite')
      .eq('user_id', username),
    loadCanonicalUnits(),
  ])

  if (eventsResult.error) throw new Error(`Impossible de calculer les favoris : ${eventsResult.error.message}`)
  if (preferencesResult.error) throw new Error(`Impossible de charger les préférences des favoris : ${preferencesResult.error.message}`)

  const preferences = new Map<string, string>()
  for (const row of preferencesResult.data ?? []) {
    if (row.ingredient_id && row.unite) preferences.set(String(row.ingredient_id), canonicalUnitFromRaw(row.unite, units))
  }

  const counts = new Map<string, { count: number; last: string | null; unit: string }>()
  for (const row of eventsResult.data ?? []) {
    if (!row.ingredient_id) continue
    const id = String(row.ingredient_id)
    const current = counts.get(id) ?? { count: 0, last: null, unit: 'Pièce' }
    current.count += 1
    if (!current.last || String(row.purchased_at) > current.last) {
      current.last = String(row.purchased_at)
      current.unit = canonicalUnitFromRaw(row.unite, units)
    }
    counts.set(id, current)
  }

  const ids = Array.from(counts.keys())
  if (!ids.length) return []

  const { data: ingredients, error: ingredientError } = await mealioServerDb
    .from('official_ingredients')
    .select('id,nom,categorie,default_storage')
    .in('id', ids)

  if (ingredientError) throw new Error(`Impossible de charger les ingrédients favoris : ${ingredientError.message}`)

  return (ingredients ?? [])
    .map(row => ({
      ingredient_id: row.id,
      nom: row.nom,
      categorie: row.categorie ?? null,
      default_storage: row.default_storage ?? null,
      purchase_count: counts.get(row.id)?.count ?? 0,
      last_purchased_at: counts.get(row.id)?.last ?? null,
      unite: preferences.get(row.id) ?? counts.get(row.id)?.unit ?? 'Pièce',
    }))
    .sort((a, b) => b.purchase_count - a.purchase_count || String(b.last_purchased_at).localeCompare(String(a.last_purchased_at)))
    .slice(0, 15)
}

export async function updateFavoriteUnit(username: string, ingredientId: string, unite: string) {
  const canonical = await assertOfficialIngredientUnit(ingredientId, unite)

  const { data, error } = await mealioServerDb
    .from('favorite_preferences')
    .upsert({ user_id: username, ingredient_id: ingredientId, unite: canonical }, { onConflict: 'user_id,ingredient_id' })
    .select('ingredient_id,unite')
    .single()
  if (error) throw new Error(`Impossible d'enregistrer l'unité du favori : ${error.message}`)
  return data
}

export async function listFavoriteUnits() {
  return loadCanonicalUnits()
}

export async function listThresholdRules(username: string): Promise<ThresholdRule[]> {
  const { data, error } = await mealioServerDb
    .from('stock_replenishment_thresholds')
    .select('id,user_id,ingredient_id,min_quantity,target_quantity,unite,active,mode')
    .eq('user_id', username)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`Impossible de charger les seuils : ${error.message}`)
  return (data ?? []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    ingredient_id: row.ingredient_id,
    min_quantity: Number(row.min_quantity),
    target_quantity: Number(row.target_quantity),
    unite: row.unite,
    active: row.active !== false,
    mode: row.mode === 'systematic' ? 'systematic' : 'suggestion',
  }))
}

export async function listRecurringRules(username: string): Promise<RecurringRule[]> {
  const { data, error } = await mealioServerDb
    .from('recurring_purchase_rules')
    .select('id,user_id,ingredient_id,produit,quantity,unite,rayon,interval_days,next_due_date,mode,active')
    .eq('user_id', username)
    .order('next_due_date', { ascending: true })
  if (error) throw new Error(`Impossible de charger les récurrents : ${error.message}`)
  return (data ?? []).map((row: any) => ({
    id: row.id,
    user_id: row.user_id,
    ingredient_id: row.ingredient_id ?? null,
    produit: row.produit,
    quantity: Number(row.quantity),
    unite: row.unite,
    rayon: row.rayon ?? null,
    interval_days: Number(row.interval_days),
    next_due_date: row.next_due_date,
    mode: row.mode,
    active: row.active !== false,
  }))
}

async function ingredientMap() {
  const [{ data: ingredients, error: ingredientsError }, { data: synonyms, error: synonymsError }] = await Promise.all([
    mealioServerDb.from('official_ingredients').select('id,nom,categorie,default_storage'),
    mealioServerDb.from('ingredient_synonyms').select('mot_recette,ingredient_id'),
  ])
  if (ingredientsError) throw new Error(`Impossible de charger le référentiel : ${ingredientsError.message}`)
  if (synonymsError) throw new Error(`Impossible de charger les synonymes : ${synonymsError.message}`)

  const byKey = new Map<string, string>()
  for (const row of ingredients ?? []) byKey.set(normalize(row.nom), row.id)
  for (const row of synonyms ?? []) byKey.set(normalize(row.mot_recette), row.ingredient_id)
  return { ingredients: ingredients ?? [], byKey }
}

async function stockByIngredient(username: string) {
  const [stock, maps] = await Promise.all([getHouseholdStockServer(username), ingredientMap()])
  const result = new Map<string, { quantity: number; unit: string; compatible: boolean }>()
  for (const item of stock) {
    const ingredientId = maps.byKey.get(normalize(item.produit))
    if (!ingredientId) continue
    const ingredient = maps.ingredients.find((i: any) => i.id === ingredientId)
    const presenceOnly = ingredient ? isPresenceOnlyIngredient(ingredient) : false
    const unit = String(item.unite ?? '').trim()
    const current = result.get(ingredientId)

    if (presenceOnly) {
      // Pour les épices/assaisonnements, le stock est binaire :
      // une ligne présente suffit à considérer l'ingrédient disponible.
      result.set(ingredientId, { quantity: 1, unit: 'Pièce', compatible: true })
      continue
    }

    if (!current) {
      result.set(ingredientId, { quantity: Number(item.qte ?? 0), unit, compatible: true })
      continue
    }
    if (unitKey(current.unit) === unitKey(unit)) {
      current.quantity += Number(item.qte ?? 0)
    } else {
      current.compatible = false
    }
  }
  return result
}

export async function getReplenishmentSuggestions(username: string): Promise<ReplenishmentSuggestion[]> {
  const [thresholds, recurring, stocks, maps] = await Promise.all([
    listThresholdRules(username),
    listRecurringRules(username),
    stockByIngredient(username),
    ingredientMap(),
  ])

  const suggestions: ReplenishmentSuggestion[] = []
  const today = parisToday()
  const ingredientNames = new Map<string, string>((maps.ingredients ?? []).map((i: any) => [i.id, i.nom]))

  for (const rule of thresholds.filter(r => r.active)) {
    const ingredient = maps.ingredients.find((i: any) => i.id === rule.ingredient_id)
    const presenceOnly = ingredient ? isPresenceOnlyIngredient(ingredient) : false
    const stock = stocks.get(rule.ingredient_id)

    if (presenceOnly) {
      // Une épice/assaisonnement ne se réapprovisionne pas en grammes/ml :
      // on vérifie seulement sa présence.
      if (stock) continue
      suggestions.push({
        key: `threshold:${rule.id}`,
        source: 'threshold',
        rule_id: rule.id,
        ingredient_id: rule.ingredient_id,
        produit: ingredientNames.get(rule.ingredient_id) ?? 'Ingrédient',
        quantity: 1,
        unite: 'Pièce',
        reason: 'Ingrédient absent du stock : présence requise.',
        mode: rule.mode,
        stock_quantity: null,
        stock_unit: null,
        min_quantity: null,
        target_quantity: null,
        due_date: null,
      })
      continue
    }

    const stockQty = stock?.quantity ?? 0
    const compatible = !stock || stock.compatible
    if (!compatible) continue
    if (stock && unitKey(stock.unit) !== unitKey(rule.unite)) continue
    if (stockQty >= rule.min_quantity) continue
    const quantity = Math.max(rule.target_quantity - stockQty, 0)
    if (quantity <= 0) continue
    suggestions.push({
      key: `threshold:${rule.id}`,
      source: 'threshold',
      rule_id: rule.id,
      ingredient_id: rule.ingredient_id,
      produit: ingredientNames.get(rule.ingredient_id) ?? 'Ingrédient',
      quantity: round(quantity),
      unite: rule.unite,
      reason: `Stock ${round(stockQty)} ${rule.unite} sous le seuil de ${round(rule.min_quantity)} ${rule.unite}`,
      mode: rule.mode,
      stock_quantity: round(stockQty),
      stock_unit: stock?.unit ?? rule.unite,
      min_quantity: rule.min_quantity,
      target_quantity: rule.target_quantity,
      due_date: null,
    })
  }

  for (const rule of recurring.filter(r => r.active && r.next_due_date <= today)) {
    const ingredient = rule.ingredient_id ? maps.ingredients.find((i: any) => i.id === rule.ingredient_id) : null
    const presenceOnly = ingredient ? isPresenceOnlyIngredient(ingredient) : false
    suggestions.push({
      key: `recurring:${rule.id}`,
      source: 'recurring',
      rule_id: rule.id,
      ingredient_id: rule.ingredient_id,
      produit: rule.produit,
      quantity: presenceOnly ? 1 : rule.quantity,
      unite: presenceOnly ? 'Pièce' : rule.unite,
      reason: presenceOnly
        ? `Présence requise · réapprovisionnement récurrent prévu le ${rule.next_due_date}`
        : `Réapprovisionnement récurrent prévu le ${rule.next_due_date}`,
      mode: rule.mode,
      stock_quantity: rule.ingredient_id ? stocks.get(rule.ingredient_id)?.quantity ?? null : null,
      stock_unit: rule.ingredient_id ? stocks.get(rule.ingredient_id)?.unit ?? null : null,
      min_quantity: null,
      target_quantity: null,
      due_date: rule.next_due_date,
    })
  }

  return suggestions
}

export async function processReplenishmentForCourses(username: string) {
  const suggestions = await getReplenishmentSuggestions(username)
  const systematic = suggestions.filter(s => s.mode === 'systematic')

  const { data: existingList } = await mealioServerDb
    .from('shopping_lists')
    .select('id')
    .eq('user_id', username)
    .eq('status', 'en_cours')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  let activeItems: Array<{ produit: string; ingredient_id: string | null }> = []
  if (existingList?.id) {
    const { data, error } = await mealioServerDb
      .from('shopping_items')
      .select('produit,ingredient_id')
      .eq('list_id', existingList.id)
    if (error) throw new Error(error.message)
    activeItems = (data ?? []).map((item: any) => ({
      produit: String(item.produit ?? ''),
      ingredient_id: item.ingredient_id ?? null,
    }))
  }

  const systematicAdded: string[] = []
  for (const suggestion of systematic) {
    const alreadyInCourses = activeItems.some(item =>
      (suggestion.ingredient_id && item.ingredient_id === suggestion.ingredient_id) ||
      (!suggestion.ingredient_id && normalize(item.produit) === normalize(suggestion.produit))
    )

    if (alreadyInCourses) {
      // A recurring rule already present in the active list has already been
      // consumed by the Courses cockpit. Do not increase its quantity again.
      if (suggestion.source === 'recurring') {
        await markRecurringAdded(suggestion.rule_id, username)
      }
      systematicAdded.push(suggestion.produit)
      continue
    }

    try {
      await addReplenishmentToActiveList(username, {
        produit: suggestion.produit,
        ingredient_id: suggestion.ingredient_id,
        quantity: suggestion.quantity,
        unite: suggestion.unite,
        source: suggestion.source,
        rule_id: suggestion.rule_id,
      })
      systematicAdded.push(suggestion.produit)
      activeItems.push({ produit: suggestion.produit, ingredient_id: suggestion.ingredient_id })
    } catch (error) {
      console.error(`⚠️ Réappro automatique « ${suggestion.produit} » non ajouté :`, error)
    }
  }

  const pendingSuggestions = suggestions
    .filter(s => s.mode !== 'systematic')
    .filter(s => !activeItems.some(item =>
      (s.ingredient_id && item.ingredient_id === s.ingredient_id) ||
      (!s.ingredient_id && normalize(item.produit) === normalize(s.produit))
    ))

  return {
    systematicAdded,
    suggestions: pendingSuggestions,
  }
}

export async function addReplenishmentToActiveList(
  username: string,
  input: {
    produit: string
    ingredient_id?: string | null
    quantity: number
    unite: string
    source: 'threshold' | 'recurring' | 'favorite'
    rule_id?: string | null
  },
) {
  let { data: list, error: listError } = await mealioServerDb
    .from('shopping_lists')
    .select('id')
    .eq('user_id', username)
    .eq('status', 'en_cours')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (listError) throw new Error(listError.message)
  if (!list) {
    const created = await mealioServerDb
      .from('shopping_lists')
      .insert({ user_id: username, name: 'Courses', status: 'en_cours' })
      .select('id')
      .single()
    if (created.error || !created.data) throw new Error(created.error?.message ?? 'Impossible de créer la liste active.')
    list = created.data
  }

  const ingredientId = input.ingredient_id ?? null
  if (ingredientId) {
    await assertOfficialIngredientUnit(ingredientId, input.unite)
  }

  const { data: candidates, error: candidateError } = await mealioServerDb
    .from('shopping_items')
    .select('id,produit,ingredient_id,qte,qte_achat')
    .eq('list_id', list.id)
  if (candidateError) throw new Error(candidateError.message)

  const existing = (candidates ?? []).find((item: any) => {
    if (ingredientId && item.ingredient_id === ingredientId) return true
    return !ingredientId && normalize(item.produit) === normalize(input.produit)
  })

  if (existing) {
    const { data, error } = await mealioServerDb
      .from('shopping_items')
      .update({
        qte: Number(existing.qte ?? 0) + input.quantity,
        qte_achat: Number(existing.qte_achat ?? 0) + input.quantity,
        is_checked: false,
      })
      .eq('id', existing.id)
      .select('id,produit,qte,qte_achat')
      .single()
    if (error) throw new Error(error.message)
    if (input.source === 'recurring' && input.rule_id) await markRecurringAdded(input.rule_id, username)
    return { item: data, merged: true }
  }

  const { data, error } = await mealioServerDb
    .from('shopping_items')
    .insert({
      list_id: list.id,
      produit: input.produit,
      ingredient_id: ingredientId,
      qte: input.quantity,
      qte_achat: input.quantity,
      qte_achetee: 0,
      unite: input.unite,
      is_checked: false,
      is_manual: !ingredientId,
      ai_status: input.source === 'recurring' ? 'recurrent' : null,
    })
    .select('id,produit,qte,qte_achat')
    .single()
  if (error) throw new Error(error.message)
  if (input.source === 'recurring' && input.rule_id) await markRecurringAdded(input.rule_id, username)
  return { item: data, merged: false }
}

export async function markRecurringAdded(ruleId: string, username: string) {
  const { data: rule, error: readError } = await mealioServerDb
    .from('recurring_purchase_rules')
    .select('id,interval_days,next_due_date')
    .eq('id', ruleId)
    .eq('user_id', username)
    .maybeSingle()
  if (readError) throw new Error(readError.message)
  if (!rule) return

  const current = new Date(`${rule.next_due_date}T12:00:00`)
  current.setDate(current.getDate() + Number(rule.interval_days))
  const next = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`

  const { error } = await mealioServerDb
    .from('recurring_purchase_rules')
    .update({ next_due_date: next })
    .eq('id', ruleId)
    .eq('user_id', username)
  if (error) throw new Error(`Impossible de recalculer la prochaine échéance : ${error.message}`)
}
