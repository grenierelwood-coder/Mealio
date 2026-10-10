import {consumptionDate} from './ecosystem-policy'
import { parisDate,expiryDays } from './expiry-policy'
import { cookiwikiServerDb } from '../lib/supabase-server'
import { getHouseholdStockServer, type HouseholdStockItem } from './household-server'
import { cleanText, loadReferenceData, resolveStockIngredientId, type ReferenceData } from './matcher'
import { parseIngredients } from './cookiwiki-fetcher'
import { activeRecipeStructure, loadRecipeStructures } from './recipe-structure-server'

export type IngredientMatchMode = 'any' | 'all'
export interface AntiGaspiRecipeSuggestion {
  id: string; nom: string; description: string | null; image_url: string | null
  prep_time: number; cook_time: number; urgentProducts: string[]; matchedProducts: string[]; score: number
}
export interface AntiGaspiResponse {
  expiryDiagnostic?:{available:number;eligible:number;dated:number;missing:number;invalid:number;expired:number;today:string;horizonDays:number}; today: string; urgentStock: HouseholdStockItem[]; suggestions: AntiGaspiRecipeSuggestion[]; availableStock: HouseholdStockItem[]
}
export interface IngredientSearchResult {
  id: string; nom: string; categorie: string; inStock: boolean; stockLabels: string[]
}
export type RecipeSelection = { selectedIngredientIds?: string[]; selectedLabels?: string[]; selectedKeys?: string[]; matchMode?: IngredientMatchMode }
type Target = { key: string; name: string; id: string | null }
const normalize = (value: string) => cleanText(String(value ?? ''))
function labelMatchesQuery(label: string, query: string) {
  const terms = normalize(query).split(' ').filter(Boolean), words = normalize(label).split(' ')
  return terms.every(term => words.some(word => word.startsWith(term)))
}
function identity(ref: ReferenceData, name: string) { return resolveStockIngredientId(ref, name) }
async function loadRecipes() {
  const [result, structures] = await Promise.all([
    cookiwikiServerDb.from('recipes').select('id,title,description,image_url,prep_time,cook_time,ingredients').order('title', { ascending: true }).limit(2000),
    loadRecipeStructures(),
  ])
  if (result.error) throw new Error(`Impossible de rechercher les recettes : ${result.error.message}`)
  const byId = new Map(structures.map(row => [row.recipe_id, row]))
  return (result.data ?? []).map((recipe: any) => ({ ...recipe,
    names: parseIngredients(activeRecipeStructure(recipe, byId.get(recipe.id))).filter(i => !i.preparationIssue).map(i => i.name),
  }))
}
function targetsFor(ref: ReferenceData, selection: RecipeSelection, stock: HouseholdStockItem[]) {
  const targets = new Map<string, Target>()
  function addName(name: string) {
    const id = identity(ref, name), normalized = normalize(name)
    if (!normalized) return
    const key = id ? `id:${id}` : `label:${normalized}`
    if (!targets.has(key)) targets.set(key, { key, id, name: id ? ref.officialById.get(id)!.nom : name })
  }
  for (const id of selection.selectedIngredientIds ?? []) {
    const official = ref.officialById.get(id)
    if (official) addName(official.nom)
    else if (id.startsWith('label:')) addName(id.slice(6))
  }
  for (const label of selection.selectedLabels ?? []) addName(label)
  const keys = new Set(selection.selectedKeys ?? [])
  const selectedStock = stock.filter(item => keys.has(`${item.source}:${item.id}`) && item.qte > 0)
  for (const item of selectedStock) addName(item.ingredient_id?ref.officialById.get(item.ingredient_id)?.nom??item.produit:item.produit)
  return { targets: [...targets.values()], selectedStock }
}
function matches(ref: ReferenceData, target: Target, name: string) {
  const recipeId = identity(ref, name)
  if (target.id && recipeId) return target.id === recipeId
  if (!target.id) return normalize(target.name) === normalize(name)
  // Search only: an unresolved recipe label may contain a validated label.
  // A known contradictory identity above always wins (e.g. wheat vs rice flour).
  const labels = [ref.officialById.get(target.id)!.nom,
    ...[...ref.synonymMap].filter(([, id]) => id === target.id).map(([label]) => label)]
  const words = new Set(normalize(name).split(' '))
  return labels.some(label => {
    const parts = normalize(label).split(' ').filter(Boolean)
    return parts.length > 0 && parts.every(part => words.has(part))
  })
}
function rankRecipes(ref: ReferenceData, recipes: any[], targets: Target[], mode: IngredientMatchMode) {
  if (!targets.length) return []
  return recipes.flatMap((recipe): AntiGaspiRecipeSuggestion[] => {
    const matched = targets.filter(target => recipe.names.some((name: string) => matches(ref, target, name)))
    if (!matched.length || (mode === 'all' && matched.length !== targets.length)) return []
    return [{ id: String(recipe.id), nom: recipe.title || 'Recette sans nom', description: recipe.description ?? null,
      image_url: recipe.image_url ?? null, prep_time: Number(recipe.prep_time ?? 0), cook_time: Number(recipe.cook_time ?? 0),
      urgentProducts: [], matchedProducts: matched.map(t => t.name),
      score: matched.length * 1000 - Math.max(0, recipe.names.length - matched.length),
    }]
  }).sort((a, b) => b.score - a.score || a.nom.localeCompare(b.nom, 'fr')).slice(0, 12)
}
export async function searchRecipesForSelection(username: string, selection: RecipeSelection) {
  const [stock, ref, recipes] = await Promise.all([getHouseholdStockServer(username), loadReferenceData(username), loadRecipes()])
  const { targets, selectedStock } = targetsFor(ref, selection, stock)
  return { recipes: rankRecipes(ref, recipes, targets, selection.matchMode ?? 'any'), selectedStock,
    matchMode: selection.matchMode ?? 'any', selectionCount: targets.length }
}
export async function searchRecipesForSelectedIngredients(username: string, ids: string[], matchMode: IngredientMatchMode = 'any') {
  return searchRecipesForSelection(username, { selectedIngredientIds: ids, matchMode })
}
export async function searchRecipesForSelectedStock(username: string, keys: string[], matchMode: IngredientMatchMode = 'any') {
  return searchRecipesForSelection(username, { selectedKeys: keys, matchMode })
}
export async function searchRecipesForSelectedLabels(labels: string[], matchMode: IngredientMatchMode = 'any') {
  const [ref, recipes] = await Promise.all([loadReferenceData(), loadRecipes()])
  const { targets } = targetsFor(ref, { selectedLabels: labels }, [])
  return { recipes: rankRecipes(ref, recipes, targets, matchMode), selectedStock: [] }
}
export async function searchIngredientsForTonight(username: string, query: string): Promise<IngredientSearchResult[]> {
  const [stock, ref] = await Promise.all([getHouseholdStockServer(username), loadReferenceData(username)])
  const labelsById = new Map<string, string[]>()
  for (const item of stock.filter(i => i.qte > 0)) {
    const id = item.ingredient_id??identity(ref, item.produit)
    if (id) labelsById.set(id, [...new Set([...(labelsById.get(id) ?? []), item.produit])])
  }
  return ref.officialList.filter(item => labelMatchesQuery(item.nom, query) || [...ref.synonymMap].some(([label, id]) => id === item.id && labelMatchesQuery(label, query)))
    .map(item => ({ id: item.id, nom: item.nom, categorie: '', inStock: labelsById.has(item.id), stockLabels: labelsById.get(item.id) ?? [] }))
    .sort((a, b) => Number(b.inStock) - Number(a.inStock) || a.nom.localeCompare(b.nom, 'fr')).slice(0, 30)
}
export async function searchCookiwikiIngredientLabels(query: string) {
  const [ref, recipes] = await Promise.all([loadReferenceData(), loadRecipes()])
  const counts = new Map<string, number>()
  for (const recipe of recipes) for (const name of new Set<string>(recipe.names)) {
    if (labelMatchesQuery(name, query)) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts].map(([label, recipeCount]) => ({ label, officialId: identity(ref, label), recipeCount }))
    .sort((a, b) => b.recipeCount - a.recipeCount || a.label.localeCompare(b.label, 'fr')).slice(0, 30)
}
function isWine(item: HouseholdStockItem) {
  if(item.product_type)return item.product_type==='wine';
  const value = ` ${normalize(`${item.produit} ${item.categorie}`)} `
  return ['vin', 'vins', 'champagne', 'cidre', 'biere', 'wine', 'bordeaux', 'bourgogne', 'cremant'].some(term => value.includes(` ${term} `))
}
export async function getAntiGaspiTonight(username: string): Promise<AntiGaspiResponse> {
  const today = parisDate()
  const [stock, ref] = await Promise.all([getHouseholdStockServer(username), loadReferenceData(username)])
  const availableStock = stock.filter(i => i.qte > 0).map(i=>({...i,quantity_mode:ref.pantryProducts?.get(i.ingredient_id??identity(ref,i.produit)??'')?.enabled?'presence' as const:'quantity' as const}))
  const eligible=availableStock.filter(i=>!isWine(i)&&i.date_role!=='apogee')
  const deltas=eligible.map(i=>expiryDays(consumptionDate(i),today))
  const expiryDiagnostic={available:availableStock.length,eligible:eligible.length,dated:deltas.filter(d=>d!==null).length,missing:eligible.filter(i=>!i.date_peremption?.trim()).length,invalid:eligible.filter(i=>i.date_peremption?.trim()&&expiryDays(consumptionDate(i),today)===null).length,expired:deltas.filter(d=>d!==null&&d<0).length,today,horizonDays:3}
  const urgentStock = eligible.filter(i=>{const d=expiryDays(consumptionDate(i),today);return d!==null&&d<=3})
    .sort((a,b)=>expiryDays(consumptionDate(a),today)!-expiryDays(consumptionDate(b),today)!)
  if (!urgentStock.length) return { today, urgentStock, suggestions: [], availableStock,expiryDiagnostic }
  const { targets } = targetsFor(ref, { selectedLabels: urgentStock.map(i => i.ingredient_id?ref.officialById.get(i.ingredient_id)?.nom??i.produit:i.produit) }, [])
  const suggestions = rankRecipes(ref, await loadRecipes(), targets, 'any').map(recipe => ({ ...recipe, urgentProducts: recipe.matchedProducts,
    score: recipe.score + recipe.matchedProducts.reduce((sum, name) => {
      const item = urgentStock.find(i => normalize(i.produit) === normalize(name) || (identity(ref, i.produit) && identity(ref, i.produit) === identity(ref, name)))
      return sum + (item?.date_peremption ? Math.max(0, 4 - (expiryDays(item.date_peremption, today)??4)) : 0)
    }, 0),
  })).sort((a, b) => b.score - a.score).slice(0, 3)
  return { today, urgentStock, suggestions, availableStock,expiryDiagnostic }
}
