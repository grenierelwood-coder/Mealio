import { mealioDb } from '../lib/supabase'

// ============================================================================
// MATCHER RECETTE ↔ STOCK — V3.1
//
// V3.1 = V3 + appel Claude côté serveur (Supabase Edge Function).
//
// Pipeline :
//   1. normalisation
//   2. mémoire persistante
//   3. exclusions apprises
//   4. exact
//   5. matching lexical avancé
//   6. auto-match si score + marge suffisants
//   7. Edge Function Claude uniquement si nécessaire
//   8. apprentissage de la décision IA
//   9. validation/correction humaine
//
// IMPORTANT : aucune clé Anthropic n'est utilisée dans le navigateur.
// ============================================================================

export interface MatcherStockItem {
  id?: string
  produit: string
  qte: number
  unite: string
  source?: string
  ingredient_id?: string | null
}

export interface MatchCandidate {
  stockItem: MatcherStockItem
  lexicalScore: number
  aiScore?: number
  score: number
  reason?: string
}

export interface MatchResult {
  matched: boolean
  stockItem: MatcherStockItem | null
  confidence: number
  source: 'memory' | 'human' | 'exact' | 'text' | 'ai' | 'none'
  candidates: MatchCandidate[]
  needs_review: boolean
  reason?: string
}

interface MatcherMemoryRow {
  id: string
  ingredient_key: string
  stock_item_id: string
  source: 'ai' | 'human' | 'text' | 'exact'
  confidence: number
  validated: boolean
  reason?: string | null
  usage_count: number
}

interface PreparedStockItem {
  stockItem: MatcherStockItem
  normalized: string
  tokens: string[]
}

interface MatcherContext {
  stopWords: Set<string>
  stock: MatcherStockItem[]
  preparedStock: PreparedStockItem[]
  memory: Map<string, MatcherMemoryRow[]>
  exclusions: Set<string>
}

const CONFIG = {
  AI_CANDIDATE_LIMIT: 5,
  MIN_CANDIDATE_SCORE: 0.22,
  AUTO_MATCH_SCORE: 0.93,
  AUTO_MATCH_MARGIN: 0.08,
  AI_LEARNING_THRESHOLD: 0.85,
  CANDIDATE_LIMIT: 5,
}

const BASE_STOP_WORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'a', 'au', 'aux', 'en', 'pour', 'avec',
])

let dynamicStopWords: Set<string> | null = null

export async function loadMatcherStopWords(): Promise<Set<string>> {
  if (dynamicStopWords) return dynamicStopWords

  const { data, error } = await mealioDb.from('ignored_words').select('mot')
  dynamicStopWords = new Set(BASE_STOP_WORDS)

  if (error) {
    console.error('Erreur chargement ignored_words :', error)
    return dynamicStopWords
  }

  for (const row of data ?? []) {
    const cleaned = cleanMatcherText(String(row.mot ?? ''), BASE_STOP_WORDS)
    if (cleaned) dynamicStopWords.add(cleaned)
  }

  return dynamicStopWords
}

const SINGULAR_EXCEPTIONS = new Set(['riz', 'mais', 'pois', 'jus', 'os', 'frais'])

function singularizeWord(word: string): string {
  if (!word || word.length <= 3 || SINGULAR_EXCEPTIONS.has(word)) return word
  if (word.endsWith('ufs')) return word.slice(0, -1)
  if (word.endsWith('tes') || word.endsWith('ons') || word.endsWith('res') || word.endsWith('nes') || word.endsWith('mes') || word.endsWith('des') || word.endsWith('ves')) return word.slice(0, -1)
  if (word.endsWith('es')) return word.slice(0, -1)
  if (word.endsWith('s') && !word.endsWith('ss') && word.length >= 5) return word.slice(0, -1)
  return word
}

export function cleanMatcherText(text: string, stopWords?: Set<string>): string {
  if (!text) return ''

  const ignored = stopWords ?? BASE_STOP_WORDS
  const cleaned = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()[\],.;:/\\'"!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned
    .split(' ')
    .filter(Boolean)
    .map(singularizeWord)
    .filter(word => !ignored.has(word))
    .join(' ')
}

function tokenize(text: string, stopWords: Set<string>): string[] {
  return cleanMatcherText(text, stopWords).split(' ').filter(Boolean)
}

const DISCRIMINANT_GROUPS: string[][] = [
  ['rouge', 'vert', 'verte', 'jaune', 'orange'],
  ['cerise', 'grappe', 'concasse', 'conserve', 'seche'],
  ['coco', 'amande', 'noisette', 'noix', 'soja', 'avoine'],
  ['chevre', 'brebis', 'vache', 'bufflonne'],
  ['doux', 'sale', 'fume', 'epice', 'fort'],
  ['liquide', 'solide', 'poudre'],
]

const discriminantGroupByToken = new Map<string, number>()
DISCRIMINANT_GROUPS.forEach((group, index) => group.forEach(token => discriminantGroupByToken.set(token, index)))

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1]
    for (let j = 0; j < b.length; j++) {
      current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + (a[i] === b[j] ? 0 : 1)))
    }
    previous = current
  }
  return previous[b.length]
}

function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length))
}

function calculateDiscriminantPenalty(ingredientTokens: string[], productTokens: string[]): number {
  const ingredientGroups = new Set<number>()
  for (const token of ingredientTokens) {
    const group = discriminantGroupByToken.get(token)
    if (group !== undefined) ingredientGroups.add(group)
  }
  if (!ingredientGroups.size) return 0

  for (const token of productTokens) {
    const group = discriminantGroupByToken.get(token)
    if (group !== undefined && ingredientGroups.has(group) && !ingredientTokens.includes(token)) return 0.18
  }
  return 0
}

function calculateTextScoreFromNormalized(ingredient: string, ingredientTokens: string[], product: string, productTokens: string[]): number {
  if (!ingredient || !product) return 0
  if (ingredient === product) return 1

  const productSet = new Set(productTokens)
  const common = ingredientTokens.filter(token => productSet.has(token))
  const coverageIngredient = common.length / Math.max(ingredientTokens.length, 1)
  const coverageProduct = common.length / Math.max(productTokens.length, 1)
  const globalSimilarity = stringSimilarity(ingredient, product)
  const contradictionPenalty = calculateDiscriminantPenalty(ingredientTokens, productTokens)

  let score = coverageIngredient * 0.55 + coverageProduct * 0.20 + globalSimilarity * 0.25
  if (coverageIngredient === 1) score += 0.04
  score -= contradictionPenalty
  return Math.min(0.97, Math.max(0, score))
}

function prepareStock(stock: MatcherStockItem[], stopWords: Set<string>): PreparedStockItem[] {
  return stock.map(stockItem => {
    const normalized = cleanMatcherText(stockItem.produit, stopWords)
    return { stockItem, normalized, tokens: tokenize(normalized, stopWords) }
  })
}

export async function loadGlobalStock(): Promise<MatcherStockItem[]> {
  const { data, error } = await mealioDb
    .from('stock_items')
    .select('id, produit, qte, unite, source, ingredient_id')

  if (error) {
    console.error('Erreur récupération stock :', error)
    return []
  }
  return data ?? []
}

export function findTextCandidates(ingredientName: string, preparedStock: PreparedStockItem[], stopWords: Set<string>, limit = CONFIG.CANDIDATE_LIMIT): MatchCandidate[] {
  const ingredient = cleanMatcherText(ingredientName, stopWords)
  const ingredientTokens = tokenize(ingredient, stopWords)
  if (!ingredient || !ingredientTokens.length) return []

  return preparedStock
    .map(item => {
      const lexicalScore = calculateTextScoreFromNormalized(ingredient, ingredientTokens, item.normalized, item.tokens)
      return { stockItem: item.stockItem, lexicalScore, score: lexicalScore }
    })
    .filter(candidate => candidate.lexicalScore >= CONFIG.MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.lexicalScore - a.lexicalScore)
    .slice(0, limit)
}

async function loadMatcherMemory(ingredientKeys: string[]): Promise<{ memory: Map<string, MatcherMemoryRow[]>; exclusions: Set<string> }> {
  const memory = new Map<string, MatcherMemoryRow[]>()
  const exclusions = new Set<string>()
  const uniqueKeys = [...new Set(ingredientKeys.filter(Boolean))]
  if (!uniqueKeys.length) return { memory, exclusions }

  const [memoryResult, exclusionResult] = await Promise.all([
    mealioDb.from('matcher_memory').select('*').in('ingredient_key', uniqueKeys),
    mealioDb.from('matcher_exclusions').select('ingredient_key, stock_item_id').in('ingredient_key', uniqueKeys),
  ])

  if (memoryResult.error) console.error('Erreur chargement matcher_memory :', memoryResult.error)
  if (exclusionResult.error) console.error('Erreur chargement matcher_exclusions :', exclusionResult.error)

  for (const row of memoryResult.data ?? []) {
    const list = memory.get(row.ingredient_key) ?? []
    list.push(row as MatcherMemoryRow)
    memory.set(row.ingredient_key, list)
  }

  for (const row of exclusionResult.data ?? []) exclusions.add(`${row.ingredient_key}::${row.stock_item_id}`)

  for (const [key, rows] of memory) {
    rows.sort((a, b) => Number(b.validated) - Number(a.validated) || Number(b.confidence) - Number(a.confidence))
    memory.set(key, rows)
  }

  return { memory, exclusions }
}

async function saveMatcherMemory(ingredientKey: string, stockItem: MatcherStockItem, source: 'ai' | 'human' | 'text' | 'exact', confidence: number, reason: string, validated: boolean): Promise<void> {
  if (!stockItem.id) return

  const { error } = await mealioDb.from('matcher_memory').upsert({
    ingredient_key: ingredientKey,
    stock_item_id: String(stockItem.id),
    source,
    confidence,
    validated,
    reason,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'ingredient_key,stock_item_id' })

  if (error) console.error('Erreur sauvegarde matcher_memory :', error)
}

export async function validateMatcherDecision(ingredientName: string, stockItem: MatcherStockItem, reason = 'Validation utilisateur'): Promise<void> {
  const stopWords = await loadMatcherStopWords()
  const ingredientKey = cleanMatcherText(ingredientName, stopWords)
  if (!ingredientKey || !stockItem.id) return

  await saveMatcherMemory(ingredientKey, stockItem, 'human', 1, reason, true)

  await mealioDb.from('matcher_exclusions')
    .delete()
    .eq('ingredient_key', ingredientKey)
    .eq('stock_item_id', String(stockItem.id))
}

export async function rejectMatcherDecision(ingredientName: string, stockItem: MatcherStockItem, reason = 'Refus utilisateur'): Promise<void> {
  const stopWords = await loadMatcherStopWords()
  const ingredientKey = cleanMatcherText(ingredientName, stopWords)
  if (!ingredientKey || !stockItem.id) return

  await mealioDb.from('matcher_exclusions').upsert({
    ingredient_key: ingredientKey,
    stock_item_id: String(stockItem.id),
    reason,
  }, { onConflict: 'ingredient_key,stock_item_id' })
}

export async function forgetMatcherDecision(ingredientName: string, stockItem: MatcherStockItem): Promise<void> {
  const stopWords = await loadMatcherStopWords()
  const ingredientKey = cleanMatcherText(ingredientName, stopWords)
  if (!ingredientKey || !stockItem.id) return

  await mealioDb.from('matcher_memory').delete().eq('ingredient_key', ingredientKey).eq('stock_item_id', String(stockItem.id))
  await mealioDb.from('matcher_exclusions').delete().eq('ingredient_key', ingredientKey).eq('stock_item_id', String(stockItem.id))
}

// ============================================================================
// CLAUDE — APPEL SERVEUR
// ============================================================================
// La clé Anthropic n'est jamais présente dans le bundle navigateur.
// La fonction Supabase reçoit uniquement l'ingrédient et les candidats.
// ============================================================================

async function askClaudeToMatch(ingredientName: string, candidates: MatchCandidate[]): Promise<{ matchedProduct: string | null; confidence: number; reason: string }> {
  const payload = {
    ingredientName,
    candidates: candidates.slice(0, CONFIG.AI_CANDIDATE_LIMIT).map(candidate => ({
      id: String(candidate.stockItem.id ?? ''),
      product: candidate.stockItem.produit,
      lexical_score: Number(candidate.lexicalScore.toFixed(3)),
    })),
  }

  const { data, error } = await mealioDb.functions.invoke('matcher-claude', {
    body: payload,
  })

  if (error) {
    console.error('Erreur Edge Function matcher-claude :', error)
    return { matchedProduct: null, confidence: 0, reason: 'Erreur appel serveur IA' }
  }

  if (!data || typeof data !== 'object') {
    return { matchedProduct: null, confidence: 0, reason: 'Réponse serveur IA invalide' }
  }

  return {
    matchedProduct: typeof data.match === 'string' && data.match.toUpperCase() !== 'AUCUN' ? data.match : null,
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
    reason: String(data.reason ?? (data.match === 'AUCUN' ? 'Aucun produit correspondant' : '')),
  }
}

function findMemoryMatch(ingredientKey: string, rows: MatcherMemoryRow[], stockById: Map<string, MatcherStockItem>, exclusions: Set<string>) {
  for (const row of rows) {
    const stockItem = stockById.get(String(row.stock_item_id))
    if (!stockItem) continue
    if (exclusions.has(`${ingredientKey}::${row.stock_item_id}`)) continue
    return { row, stockItem }
  }
  return null
}

export async function matchIngredientToStock(ingredientName: string, stock: MatcherStockItem[], context?: MatcherContext): Promise<MatchResult> {
  const stopWords = context?.stopWords ?? await loadMatcherStopWords()
  const preparedStock = context?.preparedStock ?? prepareStock(stock, stopWords)
  const memory = context?.memory ?? new Map<string, MatcherMemoryRow[]>()
  const exclusions = context?.exclusions ?? new Set<string>()
  const ingredientKey = cleanMatcherText(ingredientName, stopWords)

  if (!ingredientKey) {
    return { matched: false, stockItem: null, confidence: 0, source: 'none', candidates: [], needs_review: false, reason: 'Ingrédient vide après normalisation' }
  }

  const stockById = new Map<string, MatcherStockItem>()
  for (const item of stock) if (item.id) stockById.set(String(item.id), item)

  // 1. Mémoire persistante.
  const memoryMatch = findMemoryMatch(ingredientKey, memory.get(ingredientKey) ?? [], stockById, exclusions)
  if (memoryMatch) {
    return {
      matched: true,
      stockItem: memoryMatch.stockItem,
      confidence: Number(memoryMatch.row.confidence),
      source: memoryMatch.row.validated ? 'human' : 'memory',
      candidates: [{ stockItem: memoryMatch.stockItem, lexicalScore: Number(memoryMatch.row.confidence), score: Number(memoryMatch.row.confidence), reason: memoryMatch.row.reason ?? 'Correspondance apprise' }],
      needs_review: !memoryMatch.row.validated && Number(memoryMatch.row.confidence) < 0.90,
      reason: memoryMatch.row.validated ? 'Correspondance validée par utilisateur' : 'Correspondance apprise',
    }
  }

  // 2. Exact après normalisation.
  const exactMatch = preparedStock.find(item => item.normalized === ingredientKey)
  if (exactMatch) {
    const reason = 'Correspondance exacte après normalisation'
    await saveMatcherMemory(ingredientKey, exactMatch.stockItem, 'exact', 1, reason, true)
    return {
      matched: true,
      stockItem: exactMatch.stockItem,
      confidence: 1,
      source: 'exact',
      candidates: [{ stockItem: exactMatch.stockItem, lexicalScore: 1, score: 1, reason }],
      needs_review: false,
      reason,
    }
  }

  // 3. Candidats textuels.
  const candidates = findTextCandidates(ingredientName, preparedStock, stopWords)
  if (!candidates.length) {
    return { matched: false, stockItem: null, confidence: 0, source: 'none', candidates: [], needs_review: false, reason: 'Aucun candidat suffisamment proche' }
  }

  // 4. Auto-match uniquement si score ET marge sont solides.
  const best = candidates[0]
  const second = candidates[1]
  const margin = second ? best.lexicalScore - second.lexicalScore : best.lexicalScore

  if (best.lexicalScore >= CONFIG.AUTO_MATCH_SCORE && margin >= CONFIG.AUTO_MATCH_MARGIN) {
    const reason = `Match automatique : score ${best.lexicalScore.toFixed(2)}, marge ${margin.toFixed(2)}`
    await saveMatcherMemory(ingredientKey, best.stockItem, 'text', best.lexicalScore, reason, true)
    return { matched: true, stockItem: best.stockItem, confidence: best.lexicalScore, source: 'text', candidates, needs_review: false, reason }
  }

  // 5. Claude côté serveur.
  const aiResult = await askClaudeToMatch(ingredientName, candidates)
  if (aiResult.matchedProduct) {
    const selected = candidates.find(candidate => candidate.stockItem.produit === aiResult.matchedProduct)
    if (selected) {
      selected.aiScore = aiResult.confidence
      selected.score = aiResult.confidence
      selected.reason = aiResult.reason

      if (aiResult.confidence >= CONFIG.AI_LEARNING_THRESHOLD) {
        await saveMatcherMemory(ingredientKey, selected.stockItem, 'ai', aiResult.confidence, aiResult.reason, false)
      }

      return {
        matched: true,
        stockItem: selected.stockItem,
        confidence: aiResult.confidence,
        source: 'ai',
        candidates,
        needs_review: aiResult.confidence < 0.85,
        reason: aiResult.reason,
      }
    }
  }

  return { matched: false, stockItem: null, confidence: 0, source: 'none', candidates, needs_review: true, reason: aiResult.reason || 'Aucun produit suffisamment fiable' }
}

export async function matchIngredientsToStock(ingredients: string[], stock: MatcherStockItem[]): Promise<Record<string, MatchResult>> {
  const results: Record<string, MatchResult> = {}
  const stopWords = await loadMatcherStopWords()
  const uniqueIngredients = new Map<string, string>()

  for (const ingredient of ingredients) {
    const key = cleanMatcherText(ingredient, stopWords)
    if (key && !uniqueIngredients.has(key)) uniqueIngredients.set(key, ingredient)
  }

  const preparedStock = prepareStock(stock, stopWords)
  const { memory, exclusions } = await loadMatcherMemory([...uniqueIngredients.keys()])
  const context: MatcherContext = { stopWords, stock, preparedStock, memory, exclusions }
  const localCache = new Map<string, MatchResult>()

  for (const ingredient of ingredients) {
    const key = cleanMatcherText(ingredient, stopWords)
    if (!key) continue

    if (localCache.has(key)) {
      results[ingredient] = localCache.get(key)!
      continue
    }

    const result = await matchIngredientToStock(ingredient, stock, context)
    localCache.set(key, result)
    results[ingredient] = result
  }

  return results
}
