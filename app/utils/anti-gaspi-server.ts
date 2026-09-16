import { cookiwikiServerDb } from '../lib/supabase-server'
import { getHouseholdStockServer, HouseholdStockItem } from './household-server'
import { loadReferenceData, resolveStockIngredientId, getIngredientSemanticLabels, ReferenceData } from './matcher'

export interface AntiGaspiRecipeSuggestion {
  id: string
  nom: string
  description: string | null
  image_url: string | null
  prep_time: number
  cook_time: number
  urgentProducts: string[]
  matchedProducts: string[]
  score: number
}

export interface AntiGaspiResponse {
  today: string
  urgentStock: HouseholdStockItem[]
  suggestions: AntiGaspiRecipeSuggestion[]
  availableStock: HouseholdStockItem[]
}

function todayParis(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date())
}

function daysUntil(date: string, today: string): number {
  const a = new Date(`${today}T12:00:00`)
  const b = new Date(`${date}T12:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

function ingredientIdForRecipeName(refData: ReferenceData, name: string): string | null {
  const normalized = name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const exact = refData.officialList.find(i =>
    i.nom.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') === normalized
  )
  if (exact) return exact.id

  for (const [synonym, id] of refData.synonymMap.entries()) {
    const key = synonym.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    if (key === normalized) return id
  }
  return null
}

export async function getAntiGaspiTonight(username: string): Promise<AntiGaspiResponse> {
  const today = todayParis()
  const [stock, refData] = await Promise.all([
    getHouseholdStockServer(username),
    loadReferenceData(),
  ])

  const urgentStock = stock
    .filter(item => Number(item.qte || 0) > 0 && item.date_peremption && daysUntil(item.date_peremption, today) <= 3)
    .sort((a, b) => String(a.date_peremption).localeCompare(String(b.date_peremption)))

  if (!urgentStock.length) {
    return { today, urgentStock: [], suggestions: [], availableStock: stock.filter(item => Number(item.qte || 0) > 0) }
  }

  const urgentIds = new Set(
    urgentStock
      .map(item => resolveStockIngredientId(refData, item.produit))
      .filter(Boolean) as string[]
  )

  const urgentNames = new Map<string, string>()
  urgentStock.forEach(item => {
    const id = resolveStockIngredientId(refData, item.produit)
    if (id) urgentNames.set(id, item.produit)
  })

  const { data, error } = await cookiwikiServerDb
    .from('recipes')
    .select('id,title,description,image_url,prep_time,cook_time,ingredients')
    .order('title', { ascending: true })
    .limit(1000)

  if (error) throw new Error(`Impossible de rechercher les recettes Anti-Gaspi : ${error.message}`)

  const suggestions = ((data ?? []) as any[])
    .map(recipe => {
      const ingredientNames = Array.isArray(recipe.ingredients)
        ? recipe.ingredients.map((i: any) => String(i?.name ?? i?.nom ?? i?.ingredient ?? '').trim()).filter(Boolean)
        : []

      const matchedIds = new Set<string>()
      const matchedProducts: string[] = []

      for (const name of ingredientNames) {
        const id = ingredientIdForRecipeName(refData, name)
        if (id && urgentIds.has(id) && !matchedIds.has(id)) {
          matchedIds.add(id)
          matchedProducts.push(urgentNames.get(id) ?? name)
        }
      }

      if (!matchedProducts.length) return null

      const urgency = matchedProducts.reduce((sum, product) => {
        const item = urgentStock.find(s => s.produit === product)
        return sum + (item?.date_peremption ? Math.max(0, 4 - daysUntil(item.date_peremption, today)) : 0)
      }, 0)

      return {
        id: String(recipe.id),
        nom: recipe.title ?? 'Recette sans nom',
        description: recipe.description ?? null,
        image_url: recipe.image_url ?? null,
        prep_time: Number(recipe.prep_time ?? 0),
        cook_time: Number(recipe.cook_time ?? 0),
        urgentProducts: matchedProducts,
        matchedProducts,
        score: matchedProducts.length * 100 + urgency,
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score || a.nom.localeCompare(b.nom))
    .slice(0, 3) as AntiGaspiRecipeSuggestion[]

  return { today, urgentStock, suggestions, availableStock: stock.filter(item => Number(item.qte || 0) > 0) }
}

function normalizeLabel(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function singularToken(value: string): string {
  if (value.length > 4 && value.endsWith('s')) return value.slice(0, -1)
  if (value.length > 5 && value.endsWith('x')) return value.slice(0, -1)
  return value
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeLabel(value).split(' ').filter(Boolean).map(singularToken))
}

function labelMatchesQuery(label: string, query: string): boolean {
  const q = normalizeLabel(query)
  if (!q) return true
  const nq = q.split(' ').filter(Boolean).map(singularToken)
  const text = normalizeLabel(label)
  const tokens = tokenSet(label)
  return nq.every(part => text.includes(part) || Array.from(tokens).some(t => t.startsWith(part) || part.startsWith(t)))
}

function ingredientLabelMatchesRecipeIngredient(label: string, recipeIngredient: string): boolean {
  const labelTokens = tokenSet(label)
  const recipeTokens = tokenSet(recipeIngredient)
  if (!labelTokens.size || !recipeTokens.size) return false

  // Recherche précise : tous les termes significatifs du libellé officiel/synonyme
  // doivent être présents dans l'ingrédient Cookiwiki, après normalisation singulier/pluriel.
  return Array.from(labelTokens).every(token => recipeTokens.has(token))
}

function recipeIngredientMatchesSelected(
  refData: ReferenceData,
  recipeName: string,
  selectedIds: Set<string>
): string | null {
  for (const selectedId of selectedIds) {
    const labels = getIngredientSemanticLabels(selectedId, refData)
    for (const label of labels) {
      if (ingredientLabelMatchesRecipeIngredient(label, recipeName)) {
        return selectedId
      }
    }
  }
  return null
}

export interface IngredientSearchResult {
  id: string
  nom: string
  categorie: string
  inStock: boolean
  stockLabels: string[]
}

export async function searchIngredientsForTonight(
  username: string,
  query: string
): Promise<IngredientSearchResult[]> {
  const [stock, refData] = await Promise.all([
    getHouseholdStockServer(username),
    loadReferenceData(),
  ])

  const stockByIngredient = new Map<string, string[]>()
  for (const item of stock.filter(item => Number(item.qte || 0) > 0)) {
    const id = resolveStockIngredientId(refData, item.produit)
    if (!id) continue
    const labels = stockByIngredient.get(id) ?? []
    if (!labels.includes(item.produit)) labels.push(item.produit)
    stockByIngredient.set(id, labels)
  }

  const synonymLabelsById = new Map<string, string[]>()
  for (const [label, id] of refData.synonymMap.entries()) {
    const labels = synonymLabelsById.get(id) ?? []
    labels.push(label)
    synonymLabelsById.set(id, labels)
  }

  const results = refData.officialList
    .filter(item => labelMatchesQuery(item.nom, query) || (synonymLabelsById.get(item.id) ?? []).some(label => labelMatchesQuery(label, query)))
    .map(item => ({
      id: item.id,
      nom: item.nom,
      categorie: '',
      inStock: stockByIngredient.has(item.id),
      stockLabels: stockByIngredient.get(item.id) ?? [],
    }))
    .sort((a, b) => {
      if (a.inStock !== b.inStock) return a.inStock ? -1 : 1
      const exactA = normalizeLabel(a.nom) === normalizeLabel(query) ? 1 : 0
      const exactB = normalizeLabel(b.nom) === normalizeLabel(query) ? 1 : 0
      return exactB - exactA || a.nom.localeCompare(b.nom, 'fr')
    })
    .slice(0, 30)

  return results
}

async function loadCookiwikiRecipesForSearch() {
  const { data, error } = await cookiwikiServerDb
    .from('recipes')
    .select('id,title,description,image_url,prep_time,cook_time,ingredients')
    .order('title', { ascending: true })
    .limit(2000)
  if (error) throw new Error(`Impossible de rechercher les recettes : ${error.message}`)
  return (data ?? []) as any[]
}

export async function searchCookiwikiIngredientLabels(
  query: string
): Promise<Array<{ label: string; officialId: string | null; recipeCount: number }>> {
  const [refData, recipes] = await Promise.all([loadReferenceData(), loadCookiwikiRecipesForSearch()])
  const counts = new Map<string, number>()
  for (const recipe of recipes) {
    const names: string[] = Array.isArray(recipe.ingredients)
      ? recipe.ingredients
          .map((i: any) => String(i?.name ?? i?.nom ?? i?.ingredient ?? '').trim())
          .filter((name: string) => Boolean(name))
      : []
    for (const name of new Set(names)) {
      if (labelMatchesQuery(name, query)) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  const officialByLabel = new Map<string, string>()
  for (const item of refData.officialList) officialByLabel.set(normalizeLabel(item.nom), item.id)
  for (const [synonym, id] of refData.synonymMap.entries()) officialByLabel.set(normalizeLabel(synonym), id)
  return Array.from(counts.entries())
    .map(([label, recipeCount]) => ({ label, officialId: officialByLabel.get(normalizeLabel(label)) ?? null, recipeCount }))
    .sort((a, b) => b.recipeCount - a.recipeCount || a.label.localeCompare(b.label, 'fr'))
    .slice(0, 30)
}

export async function searchRecipesForSelectedLabels(
  labels: string[]
): Promise<{ recipes: AntiGaspiRecipeSuggestion[]; selectedStock: HouseholdStockItem[] }> {
  const refData = await loadReferenceData()
  const selectedIds = new Set<string>()
  for (const rawLabel of labels) {
    const label = String(rawLabel ?? '').trim()
    const direct = ingredientIdForRecipeName(refData, label)
    if (direct) selectedIds.add(direct)
  }

  if (!selectedIds.size) return { recipes: [], selectedStock: [] }
  return searchRecipesForSelectedIngredientsByReference(refData, selectedIds)
}

async function searchRecipesForSelectedIngredientsByReference(
  refData: ReferenceData,
  selectedIds: Set<string>
): Promise<{ recipes: AntiGaspiRecipeSuggestion[]; selectedStock: HouseholdStockItem[] }> {
  const { data, error } = await cookiwikiServerDb
    .from('recipes')
    .select('id,title,description,image_url,prep_time,cook_time,ingredients')
    .order('title', { ascending: true })
    .limit(2000)

  if (error) throw new Error(`Impossible de rechercher les recettes : ${error.message}`)

  const recipes = ((data ?? []) as any[])
    .map(recipe => {
      const ingredientNames = Array.isArray(recipe.ingredients)
        ? recipe.ingredients
            .map((i: any) => String(i?.name ?? i?.nom ?? i?.ingredient ?? '').trim())
            .filter(Boolean)
        : []

      const matchedIds = new Set<string>()
      for (const name of ingredientNames) {
        const matchedId = recipeIngredientMatchesSelected(refData, name, selectedIds)
        if (matchedId) matchedIds.add(matchedId)
      }
      if (!matchedIds.size) return null

      const matchedProducts = Array.from(matchedIds)
        .map(id => refData.officialById.get(id)?.nom)
        .filter(Boolean) as string[]

      const coverage = Math.round((matchedIds.size / Math.max(selectedIds.size, 1)) * 100)
      const score = matchedIds.size * 1000 + coverage * 10 - Math.max(0, ingredientNames.length - matchedIds.size)

      return {
        id: String(recipe.id),
        nom: recipe.title ?? 'Recette sans nom',
        description: recipe.description ?? null,
        image_url: recipe.image_url ?? null,
        prep_time: Number(recipe.prep_time ?? 0),
        cook_time: Number(recipe.cook_time ?? 0),
        urgentProducts: [],
        matchedProducts,
        score,
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score || a.nom.localeCompare(b.nom, 'fr'))
    .slice(0, 12) as AntiGaspiRecipeSuggestion[]

  return { recipes, selectedStock: [] }
}

export async function searchRecipesForSelectedIngredients(
  username: string,
  selectedIngredientIds: string[]
): Promise<{ recipes: AntiGaspiRecipeSuggestion[]; selectedStock: HouseholdStockItem[] }> {
  const [stock, refData] = await Promise.all([getHouseholdStockServer(username), loadReferenceData()])
  const selectedIds = new Set(selectedIngredientIds.map(String).filter(id => refData.officialById.has(id)))
  if (!selectedIds.size) return { recipes: [], selectedStock: [] }

  const selectedStock = stock.filter(item => {
    const id = resolveStockIngredientId(refData, item.produit)
    return Number(item.qte || 0) > 0 && !!id && selectedIds.has(id)
  })

  const result = await searchRecipesForSelectedIngredientsByReference(refData, selectedIds)
  const selectedById = new Map<string, string>()
  selectedStock.forEach(item => {
    const id = resolveStockIngredientId(refData, item.produit)
    if (id && !selectedById.has(id)) selectedById.set(id, item.produit)
  })

  result.recipes = result.recipes.map(recipe => ({
    ...recipe,
    matchedProducts: recipe.matchedProducts.map(name => {
      const id = refData.officialList.find(item => item.nom === name)?.id
      return (id && selectedById.get(id)) || name
    }),
  }))

  return { ...result, selectedStock }
}

export async function searchRecipesForSelectedStock(
  username: string,
  selectedKeys: string[]
): Promise<{ recipes: AntiGaspiRecipeSuggestion[]; selectedStock: HouseholdStockItem[] }> {
  const [stock, refData] = await Promise.all([getHouseholdStockServer(username), loadReferenceData()])
  const keySet = new Set(selectedKeys.map(value => String(value).trim()).filter(Boolean))
  const selectedStock = stock.filter(item => keySet.has(`${item.source}:${item.id}`) && Number(item.qte || 0) > 0)
  const selectedIds = selectedStock.map(item => resolveStockIngredientId(refData, item.produit)).filter(Boolean) as string[]
  return searchRecipesForSelectedIngredients(username, selectedIds)
}
