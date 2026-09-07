import { mealioServerDb } from '../lib/supabase-server'
import { matchStockWithClaude, resolveOfficialIngredientWithClaude } from '../lib/anthropic-server'

export interface RecipeIngredient {
  name: string
  qty: number
  unit: string
}

export interface StockItem {
  id: string
  produit: string
  qte: number
  unite: string
  source?: string
}

type OfficialIngredient = {
  id: string
  nom: string
  rayon: string | null
  default_storage: string | null
}

type AiResolution = {
  mot_recette: string
  proposition_ia: string | null
  ingredient_id_propose: string | null
  statut: 'en_attente' | 'valide' | 'rejete'
  created_at: string | null
}

export interface ReferenceData {
  ignoredSet: Set<string>
  synonymMap: Map<string, string>
  officialList: OfficialIngredient[]
  officialById: Map<string, OfficialIngredient>
  officialPrepared: { item: OfficialIngredient; normalized: string; tokens: string[] }[]
  unitMappings: { unite: string; abreviation: string | null; type_unite: string | null; equivalence_reference?: string | null; multiplicateur: number | null }[]
  densities: { ingredient_id: string; unite: string; poids_g_approx: number }[]
  aiResolutionMap: Map<string, AiResolution>
  aiCache: Map<string, string | null>
}

export interface MatcherTrace {
  ingredient: {
    raw: string
    normalized: string
    source:
      | 'ignored'
      | 'synonym'
      | 'exact'
      | 'lexical'
      | 'memory'
      | 'ai'
      | 'unresolved'
  }

  ingredientAiCalled: boolean
  ingredientAiCacheHit: boolean
  ingredientAiConfidence: number | null

  stock: {
    source:
      | 'memory'
      | 'exact'
      | 'lexical'
      | 'ai'
      | 'none'
      | null
    aiCalled: boolean
    memoryHit: boolean
    aiConfidence: number | null
  }

  claudeCalls: number
  events: string[]
}

export function createMatcherTrace(raw: string): MatcherTrace {
  return {
    ingredient: {
      raw,
      normalized: cleanText(raw),
      source: 'unresolved',
    },

    ingredientAiCalled: false,
    ingredientAiCacheHit: false,
    ingredientAiConfidence: null,

    stock: {
      source: null,
      aiCalled: false,
      memoryHit: false,
      aiConfidence: null,
    },

    claudeCalls: 0,
    events: [],
  }
}

const BASE_STOP_WORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'un', 'une', 'et', 'a', 'au', 'aux', 'en', 'pour', 'avec',
])

const CONFIG = {
  OFFICIAL_AUTO_SCORE: 0.93,
  OFFICIAL_AUTO_MARGIN: 0.08,
  STOCK_AUTO_SCORE: 0.93,
  STOCK_AUTO_MARGIN: 0.08,
  MIN_CANDIDATE_SCORE: 0.22,
  CANDIDATE_LIMIT: 5,
  AI_LEARNING_THRESHOLD: 0.85,
}

const DISCRIMINANT_GROUPS = [
  ['rouge', 'vert', 'jaune', 'orange'],
  ['cerise', 'grappe', 'concasse', 'conserve', 'seche'],
  ['coco', 'amande', 'noisette', 'noix', 'soja', 'avoine'],
  ['chevre', 'brebis', 'vache', 'bufflonne'],
  ['doux', 'sale', 'fume', 'epice', 'fort'],
  ['liquide', 'solide', 'poudre'],
]

const discriminantGroupByToken = new Map<string, number>()
DISCRIMINANT_GROUPS.forEach((group, index) => group.forEach(token => discriminantGroupByToken.set(token, index)))

function singularizeWord(word: string): string {
  if (!word || word.length <= 3) return word
  if (new Set(['riz', 'mais', 'pois', 'jus', 'os', 'frais']).has(word)) return word
  if (word.endsWith('ufs')) return word.slice(0, -1)
  if (word.endsWith('tes') || word.endsWith('ons') || word.endsWith('res') || word.endsWith('nes') || word.endsWith('mes') || word.endsWith('des') || word.endsWith('ves')) return word.slice(0, -1)
  if (word.endsWith('es')) return word.slice(0, -1)
  if (word.endsWith('s') && !word.endsWith('ss') && word.length >= 5) return word.slice(0, -1)
  return word
}

export function cleanText(text: string, stopWords?: Set<string>): string {
  if (!text) return ''
  const ignored = stopWords ?? BASE_STOP_WORDS
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[()[\],.;:/\\'"!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singularizeWord)
    .filter(w => !ignored.has(w))
    .join(' ')
}

function tokens(text: string, stopWords: Set<string>): string[] {
  return cleanText(text, stopWords).split(' ').filter(Boolean)
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1]
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1
      curr.push(Math.min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost))
    }
    for (let j = 0; j < curr.length; j++) prev[j] = curr[j]
  }
  return prev[b.length]
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  return Math.max(0, 1 - levenshtein(a, b) / Math.max(a.length, b.length))
}

function contradictionPenalty(aTokens: string[], bTokens: string[]): number {
  const groups = new Set<number>()
  for (const t of aTokens) {
    const g = discriminantGroupByToken.get(t)
    if (g !== undefined) groups.add(g)
  }
  for (const t of bTokens) {
    const g = discriminantGroupByToken.get(t)
    if (g !== undefined && groups.has(g) && !aTokens.includes(t)) return 0.18
  }
  return 0
}

function textScore(a: string, b: string, stopWords: Set<string>): number {
  const na = cleanText(a, stopWords)
  const nb = cleanText(b, stopWords)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const at = tokens(na, stopWords)
  const bt = tokens(nb, stopWords)
  if (!at.length || !bt.length) return 0
  const bs = new Set(bt)
  const common = at.filter(t => bs.has(t)).length
  const coverageA = common / at.length
  const coverageB = common / bt.length
  let score = coverageA * 0.55 + coverageB * 0.20 + similarity(na, nb) * 0.25
  if (coverageA === 1) score += 0.04
  score -= contradictionPenalty(at, bt)
  return Math.min(0.97, Math.max(0, score))
}

function bestIsSafe<T extends { score: number }>(candidates: T[], minScore: number, minMargin: number): boolean {
  if (!candidates.length || candidates[0].score < minScore) return false
  const margin = candidates.length > 1 ? candidates[0].score - candidates[1].score : candidates[0].score
  return margin >= minMargin
}

export async function loadReferenceData(): Promise<ReferenceData> {
  const [ignored, synonyms, official, units, densities, aiLogs] = await Promise.all([
    mealioServerDb.from('ignored_words').select('mot'),
    mealioServerDb.from('ingredient_synonyms').select('mot_recette, ingredient_id'),
    mealioServerDb.from('official_ingredients').select('id, nom, rayon, default_storage'),
    mealioServerDb.from('unit_mappings').select('unite, abreviation, type_unite, equivalence_reference, multiplicateur'),
    mealioServerDb.from('ingredient_densities').select('ingredient_id, unite, poids_g_approx'),
    mealioServerDb.from('ai_resolution_log').select('mot_recette, proposition_ia, ingredient_id_propose, statut, created_at').order('created_at', { ascending: false }),
  ])

  if (ignored.error) console.error('ignored_words:', ignored.error.message)
  if (synonyms.error) console.error('ingredient_synonyms:', synonyms.error.message)
  if (official.error) console.error('official_ingredients:', official.error.message)
  if (units.error) console.error('unit_mappings:', units.error.message)
  if (densities.error) console.error('ingredient_densities:', densities.error.message)
  if (aiLogs.error) console.error('ai_resolution_log:', aiLogs.error.message)

  const officialList = (official.data ?? []) as OfficialIngredient[]
  const ignoredSet = new Set(BASE_STOP_WORDS)
  for (const row of ignored.data ?? []) {
    const value = cleanText(String(row.mot ?? ''), BASE_STOP_WORDS)
    if (value) ignoredSet.add(value)
  }

  const aiResolutionMap = new Map<string, AiResolution>()
  for (const row of aiLogs.data ?? []) {
    const key = cleanText(String(row.mot_recette ?? ''))
    if (key && !aiResolutionMap.has(key)) aiResolutionMap.set(key, row as AiResolution)
  }

  return {
    ignoredSet,
    synonymMap: new Map((synonyms.data ?? []).map(s => [cleanText(s.mot_recette), s.ingredient_id])),
    officialList,
    officialById: new Map(officialList.map(o => [o.id, o])),
    officialPrepared: officialList.map(item => ({ item, normalized: cleanText(item.nom, ignoredSet), tokens: tokens(item.nom, ignoredSet) })),
    unitMappings: units.data ?? [],
    densities: densities.data ?? [],
    aiResolutionMap,
    aiCache: new Map(),
  }
}

/**
 * Normalise les unités de cuisine avant de consulter le référentiel.
 *
 * Important V3.3 :
 * `cleanText("c.à.s")` produit naturellement `c a s`, alors que le
 * référentiel contient `cs`. On traite donc les alias AVANT la recherche.
 */
function normalizeUnitKey(unit: string): string {
  const raw = String(unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/\(s\)/g, '')
    .replace(/\s+/g, ' ')

  const aliases: Record<string, string> = {
    'c.à.s': 'cs',
    'c.a.s': 'cs',
    'càs': 'cs',
    'cas': 'cs',
    'c à s': 'cs',
    'c a s': 'cs',
    'c.s': 'cs',
    'cs': 'cs',
    'cuillere a soupe': 'cs',
    'cuillère à soupe': 'cs',

    'c.à.c': 'cc',
    'c.a.c': 'cc',
    'càc': 'cc',
    'cac': 'cc',
    'c à c': 'cc',
    'c a c': 'cc',
    'c.c': 'cc',
    'cc': 'cc',
    'cuillere a cafe': 'cc',
    'cuillère à café': 'cc',

    'ml': 'ml',
    'millilitre': 'ml',
    'millilitres': 'ml',
    'cl': 'cl',
    'centilitre': 'cl',
    'centilitres': 'cl',
    'dl': 'dl',
    'decilitre': 'dl',
    'decilitres': 'dl',
    'l': 'l',
    'litre': 'l',
    'litres': 'l',

    'g': 'g',
    'gr': 'g',
    'gramme': 'g',
    'grammes': 'g',
    'kg': 'kg',
    'kilogramme': 'kg',
    'kilogrammes': 'kg',

    'piece': 'piece',
    'pièce': 'piece',
    'pièces': 'piece',
    'pieces': 'piece',
    'piece s': 'piece',
    'pièce s': 'piece',
    'pièces s': 'piece',
    'unite': 'piece',
    'unité': 'piece',
    'unités': 'piece',
    'unite s': 'piece',
    'unité s': 'piece',

    'tranche': 'tranche',
    'tranches': 'tranche',
    'tranche s': 'tranche',
    'gousse': 'gousse',
    'gousses': 'gousse',
    'sachet': 'sachet',
    'sachets': 'sachet',
    'boite': 'boite',
    'boîte': 'boite',
    'boites': 'boite',
    'boîtes': 'boite',
  }

  if (aliases[raw]) return aliases[raw]

  const cleaned = cleanText(raw)
  return aliases[cleaned] ?? cleaned
}

function parseReferenceFactor(reference: string | null | undefined, type: string | null): number {
  if (!reference) return 1

  // Le référentiel Mealio exprime les équivalences dans l'unité canonique.
  // Exemples : "1000 g", "15 mL", "453.6 g", "~0.5 mL / ~0.3 g".
  const targetUnit =
    type === 'poids' ? /(\d+(?:[.,]\d+)?)\s*g\b/i :
    type === 'volume' ? /(\d+(?:[.,]\d+)?)\s*ml\b/i :
    null

  if (!targetUnit) return 1

  const match = reference.replace(',', '.').match(targetUnit)
  if (!match) return 1

  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : 1
}

function findUnitMapping(refData: ReferenceData, unit: string) {
  const key = normalizeUnitKey(unit)

  return refData.unitMappings.find(u => {
    const uniteKey = normalizeUnitKey(u.unite)
    const abbreviationKey = normalizeUnitKey(u.abreviation ?? '')
    return uniteKey === key || abbreviationKey === key
  })
}

function findDensity(refData: ReferenceData, ingredientId: string, unit: string) {
  const key = normalizeUnitKey(unit)

  return refData.densities.find(d =>
    d.ingredient_id === ingredientId &&
    normalizeUnitKey(d.unite) === key
  )
}

/**
 * Trouve une densité compatible avec la famille d'unité demandée.
 * Cela permet par exemple d'utiliser une densité enregistrée en càs
 * pour convertir une quantité exprimée en mL.
 */
function findDensityForType(
  refData: ReferenceData,
  ingredientId: string,
  type: 'poids' | 'volume'
) {
  return refData.densities.find(d => {
    if (d.ingredient_id !== ingredientId) return false
    const mapping = findUnitMapping(refData, d.unite)
    return mapping?.type_unite === type
  })
}

async function saveAiResolution(rawName: string, proposition: string | null, ingredientId: string | null): Promise<void> {
  const { error } = await mealioServerDb.from('ai_resolution_log').insert({
    mot_recette: rawName,
    proposition_ia: proposition ?? 'AUCUN',
    ingredient_id_propose: ingredientId,
    statut: 'en_attente',
  })
  if (error) console.error('ai_resolution_log insert:', error.message)
}

async function resolveOfficialIngredient(
  rawName: string,
  refData: ReferenceData,
  trace?: MatcherTrace
): Promise<{ id: string | null; name: string | null; aiProposed: boolean }> {
  const key = cleanText(rawName)
  if (!key || refData.ignoredSet.has(key)) {
    return { id: null, name: null, aiProposed: false }
  }

  // 1. Synonyme explicite : priorité maximale.
  const synonymId = refData.synonymMap.get(key)
  if (synonymId) {
    const official = refData.officialById.get(synonymId)
    if (official) {
      if (trace) {
        trace.ingredient.source = 'synonym'
        trace.events.push(`Synonyme trouvé : ${official.nom}`)
      }
      refData.aiCache.set(key, official.id)
      return { id: official.id, name: official.nom, aiProposed: false }
    }
  }

  // 2. Correspondance exacte dans le référentiel officiel.
  const normalizedRaw = cleanText(rawName, refData.ignoredSet)
  const exact = refData.officialPrepared.find(
    o => o.normalized === normalizedRaw
  )

  if (exact) {
    if (trace) {
      trace.ingredient.source = 'exact'
      trace.events.push(`Correspondance exacte : ${exact.item.nom}`)
    }
    refData.aiCache.set(key, exact.item.id)
    return {
      id: exact.item.id,
      name: exact.item.nom,
      aiProposed: false,
    }
  }

  // 3. Mémoire IA persistante : avant tout appel IA et avant un nouveau
  // rapprochement lexical ambigu. Une décision déjà apprise est prioritaire.
  const previous = refData.aiResolutionMap.get(key)

  if (previous) {
    if (trace) {
      trace.ingredientAiCacheHit = true
      trace.ingredient.source = 'memory'
      trace.events.push(
        `Mémoire IA utilisée : ${previous.proposition_ia ?? 'AUCUN'} (${previous.statut})`
      )
    }

    if (previous.statut === 'rejete') {
      // On ignore la décision rejetée et on continue vers le moteur.
    } else if (previous.ingredient_id_propose) {
      const official = refData.officialById.get(previous.ingredient_id_propose)
      if (official) {
        refData.aiCache.set(key, official.id)
        return {
          id: official.id,
          name: official.nom,
          aiProposed: previous.statut !== 'valide',
        }
      }
    } else if (previous.proposition_ia === 'AUCUN') {
      refData.aiCache.set(key, null)
      return { id: null, name: null, aiProposed: false }
    }
  }

  // 4. Cache intra-requête : utile si le même ingrédient apparaît plusieurs
  // fois dans une recette avant qu'une nouvelle lecture DB ne soit nécessaire.
  if (refData.aiCache.has(key)) {
    const cachedId = refData.aiCache.get(key) ?? null
    const official = cachedId ? refData.officialById.get(cachedId) : null
    if (official) {
      if (trace) {
        trace.ingredient.source = 'memory'
        trace.ingredientAiCacheHit = true
        trace.events.push(`Cache IA utilisé : ${official.nom}`)
      }
      return {
        id: official.id,
        name: official.nom,
        aiProposed: false,
      }
    }
    if (cachedId === null) {
      return { id: null, name: null, aiProposed: false }
    }
  }

  // 5. Moteur lexical déterministe.
  const candidates = refData.officialPrepared
    .map(o => ({
      ...o,
      score: textScore(rawName, o.item.nom, refData.ignoredSet),
    }))
    .filter(o => o.score >= CONFIG.MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.CANDIDATE_LIMIT)

  if (bestIsSafe(
    candidates,
    CONFIG.OFFICIAL_AUTO_SCORE,
    CONFIG.OFFICIAL_AUTO_MARGIN
  )) {
    if (trace) {
      trace.ingredient.source = 'lexical'
      trace.events.push(
        `Match lexical automatique : ${candidates[0].item.nom} (${candidates[0].score.toFixed(2)})`
      )
    }

    refData.aiCache.set(key, candidates[0].item.id)
    return {
      id: candidates[0].item.id,
      name: candidates[0].item.nom,
      aiProposed: false,
    }
  }

  // 6. Claude fallback : même sans candidat lexical exploitable, l'IA doit
  // pouvoir chercher dans le référentiel officiel complet (candidats faibles
  // inclus). On limite néanmoins la liste transmise à Claude.
  const aiCandidates = candidates.length
    ? candidates
    : refData.officialPrepared
        .map(o => ({
          ...o,
          score: textScore(rawName, o.item.nom, refData.ignoredSet),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, CONFIG.CANDIDATE_LIMIT)

  if (!aiCandidates.length) {
    await saveAiResolution(rawName, null, null)
    refData.aiResolutionMap.set(key, {
      mot_recette: rawName,
      proposition_ia: 'AUCUN',
      ingredient_id_propose: null,
      statut: 'en_attente',
      created_at: new Date().toISOString(),
    })
    refData.aiCache.set(key, null)

    if (trace) {
      trace.ingredient.source = 'unresolved'
      trace.events.push('Référentiel officiel vide : impossible de consulter Claude')
    }

    return { id: null, name: null, aiProposed: false }
  }

  // 7. Claude uniquement lorsque le moteur déterministe n'est pas suffisamment
  // sûr. Les candidats sont limités pour réduire le coût et le bruit.
  if (trace) {
    trace.ingredientAiCalled = true
    trace.claudeCalls += 1
    trace.events.push('Claude appelé pour résoudre l’ingrédient')
  }

  const ai = await resolveOfficialIngredientWithClaude(
    rawName,
    aiCandidates.map(c => ({
      id: c.item.id,
      label: c.item.nom,
      lexicalScore: c.score,
    }))
  )

  if (trace) {
    trace.ingredientAiConfidence = ai.confidence ?? null
    trace.ingredient.source = 'ai'
    trace.events.push(
      `Claude a proposé : ${ai.matched ?? 'aucune correspondance'}`
    )
  }

  const selected = ai.matched
    ? refData.officialById.get(ai.matched)
    : null

  await saveAiResolution(
    rawName,
    selected?.nom ?? null,
    selected?.id ?? null
  )

  refData.aiResolutionMap.set(key, {
    mot_recette: rawName,
    proposition_ia: selected?.nom ?? 'AUCUN',
    ingredient_id_propose: selected?.id ?? null,
    statut: 'en_attente',
    created_at: new Date().toISOString(),
  })

  refData.aiCache.set(key, selected?.id ?? null)

  return selected
    ? { id: selected.id, name: selected.nom, aiProposed: true }
    : { id: null, name: null, aiProposed: false }
}

export interface ResolvedIngredient {
  produit: string
  ingredient_id: string | null
  qte: number
  unite: string
  needs_review: boolean
  source_recipe_id: string
  source_recipe_nom: string
}

export async function resolveRecipeIngredients(
  recipeIngredients: RecipeIngredient[],
  refData: ReferenceData,
  recipeId: string,
  recipeNom: string,
  servingsRatio = 1,
  trace?: MatcherTrace,
): Promise<ResolvedIngredient[]> {
  const resolved: ResolvedIngredient[] = []

  for (const ing of recipeIngredients) {
    const rawName = cleanText(ing.name)
    if (!rawName || refData.ignoredSet.has(rawName)) continue

    const official = await resolveOfficialIngredient(
      ing.name,
      refData,
      trace
    )
    const ingredientId = official.id
    const standardProduct = official.name ?? ing.name
    let requiredQty = Number(ing.qty) * servingsRatio
    let requiredUnit = normalizeUnitKey(ing.unit)
    let unitResolved = false

    // V3.3 : on convertit immédiatement les unités de recette vers une
    // unité canonique. Une densité spécifique à l'ingrédient reste prioritaire.
    if (ingredientId) {
      const density = findDensity(refData, ingredientId, ing.unit)

      if (density) {
        const densityUnit = canonicalUnit(refData, density.unite)
        const gramsPerDensityUnit = Number(density.poids_g_approx)

        if (
          densityUnit?.type === 'volume' &&
          Number.isFinite(gramsPerDensityUnit) &&
          gramsPerDensityUnit > 0
        ) {
          const inputUnit = canonicalUnit(refData, ing.unit)

          if (inputUnit?.type === 'volume') {
            const quantityInDensityUnits =
              requiredQty * inputUnit.factor / densityUnit.factor

            requiredQty =
              quantityInDensityUnits * gramsPerDensityUnit
            requiredUnit = 'g'
            unitResolved = true
          }
        }
      }
    }

    if (!unitResolved) {
      const mapping = canonicalUnit(refData, ing.unit)

      if (mapping) {
        requiredQty *= mapping.factor
        requiredUnit = mapping.unit
        unitResolved = true
      }
    }

    resolved.push({
      produit: standardProduct,
      ingredient_id: ingredientId,
      qte: requiredQty,
      unite: requiredUnit,
      needs_review: official.aiProposed || !unitResolved || !ingredientId,
      source_recipe_id: recipeId,
      source_recipe_nom: recipeNom,
    })
  }

  return resolved
}

export interface AggregatedRequirement {
  produit: string
  ingredient_id: string | null
  qte: number
  unite: string
  needs_review: boolean
  contributions: { recipe_id: string; recipe_nom: string; qte_contribuee: number }[]
}

export function aggregateRequirements(resolvedLists: ResolvedIngredient[][]): AggregatedRequirement[] {
  const map = new Map<string, AggregatedRequirement>()
  for (const list of resolvedLists) {
    for (const item of list) {
      const key = `${item.ingredient_id ?? cleanText(item.produit)}::${cleanText(item.unite)}`
      const existing = map.get(key)
      const contribution = { recipe_id: item.source_recipe_id, recipe_nom: item.source_recipe_nom, qte_contribuee: item.qte }
      if (existing) {
        existing.qte += item.qte
        existing.needs_review ||= item.needs_review
        existing.contributions.push(contribution)
      } else {
        map.set(key, { produit: item.produit, ingredient_id: item.ingredient_id, qte: item.qte, unite: item.unite, needs_review: item.needs_review, contributions: [contribution] })
      }
    }
  }
  return Array.from(map.values())
}

interface PreparedStock {
  item: StockItem
  normalized: string
  tokens: string[]
}

interface MemoryRow {
  ingredient_key: string
  stock_item_id: string
  source: 'ai' | 'human' | 'text' | 'exact'
  confidence: number
  validated: boolean
  reason: string | null
}

async function loadStockMemory(keys: string[]) {
  const unique = [...new Set(keys.filter(Boolean))]
  if (!unique.length) return { memory: new Map<string, MemoryRow[]>(), exclusions: new Set<string>() }

  const [memoryResult, exclusionResult] = await Promise.all([
    mealioServerDb.from('matcher_memory').select('ingredient_key, stock_item_id, source, confidence, validated, reason').in('ingredient_key', unique),
    mealioServerDb.from('matcher_exclusions').select('ingredient_key, stock_item_id').in('ingredient_key', unique),
  ])

  if (memoryResult.error) console.error('matcher_memory:', memoryResult.error.message)
  if (exclusionResult.error) console.error('matcher_exclusions:', exclusionResult.error.message)

  const memory = new Map<string, MemoryRow[]>()
  for (const row of (memoryResult.data ?? []) as MemoryRow[]) {
    const list = memory.get(row.ingredient_key) ?? []
    list.push(row)
    memory.set(row.ingredient_key, list)
  }
  for (const list of memory.values()) list.sort((a, b) => Number(b.validated) - Number(a.validated) || Number(b.confidence) - Number(a.confidence))

  const exclusions = new Set<string>()
  for (const row of exclusionResult.data ?? []) exclusions.add(`${row.ingredient_key}::${row.stock_item_id}`)
  return { memory, exclusions }
}

async function saveStockMemory(
  ingredientKey: string,
  stockItem: StockItem,
  source: 'ai' | 'human' | 'text' | 'exact',
  confidence: number,
  reason: string,
  validated: boolean
) {
  const stockItemId = String(stockItem.id)
  const now = new Date().toISOString()

  // V3.3 : la table actuelle n'impose pas de contrainte UNIQUE sur
  // (ingredient_key, stock_item_id). On évite donc un upsert `onConflict`
  // qui échouerait sur une base sans cet index.
  const existing = await mealioServerDb
    .from('matcher_memory')
    .select('id, usage_count')
    .eq('ingredient_key', ingredientKey)
    .eq('stock_item_id', stockItemId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existing.error) {
    console.error('matcher_memory lookup:', existing.error.message)
    return
  }

  if (existing.data?.id) {
    const { error } = await mealioServerDb
      .from('matcher_memory')
      .update({
        source,
        confidence,
        validated,
        reason,
        usage_count: Number(existing.data.usage_count ?? 0) + 1,
        updated_at: now,
      })
      .eq('id', existing.data.id)

    if (error) console.error('matcher_memory update:', error.message)
    return
  }

  const { error } = await mealioServerDb.from('matcher_memory').insert({
    ingredient_key: ingredientKey,
    stock_item_id: stockItemId,
    source,
    confidence,
    validated,
    reason,
    usage_count: 1,
    updated_at: now,
  })

  if (error) console.error('matcher_memory insert:', error.message)
}

export async function validateMatcherDecision(ingredientName: string, stockItem: StockItem, reason = 'Validation utilisateur') {
  const key = cleanText(ingredientName)
  if (!key || !stockItem.id) return
  await saveStockMemory(key, stockItem, 'human', 1, reason, true)
  await mealioServerDb.from('matcher_exclusions').delete().eq('ingredient_key', key).eq('stock_item_id', String(stockItem.id))
}

export async function rejectMatcherDecision(ingredientName: string, stockItem: StockItem, reason = 'Refus utilisateur') {
  const key = cleanText(ingredientName)
  const stockItemId = String(stockItem.id ?? '')
  if (!key || !stockItemId) return

  const existing = await mealioServerDb
    .from('matcher_exclusions')
    .select('id')
    .eq('ingredient_key', key)
    .eq('stock_item_id', stockItemId)
    .limit(1)
    .maybeSingle()

  if (existing.error) {
    console.error('matcher_exclusions lookup:', existing.error.message)
    return
  }

  if (existing.data?.id) {
    const { error } = await mealioServerDb
      .from('matcher_exclusions')
      .update({ reason })
      .eq('id', existing.data.id)
    if (error) console.error('matcher_exclusions update:', error.message)
    return
  }

  const { error } = await mealioServerDb
    .from('matcher_exclusions')
    .insert({ ingredient_key: key, stock_item_id: stockItemId, reason })
  if (error) console.error('matcher_exclusions insert:', error.message)
}

export async function forgetMatcherDecision(ingredientName: string, stockItem: StockItem) {
  const key = cleanText(ingredientName)
  if (!key || !stockItem.id) return
  await Promise.all([
    mealioServerDb.from('matcher_memory').delete().eq('ingredient_key', key).eq('stock_item_id', String(stockItem.id)),
    mealioServerDb.from('matcher_exclusions').delete().eq('ingredient_key', key).eq('stock_item_id', String(stockItem.id)),
  ])
}

async function matchOneRequirement(
  item: AggregatedRequirement,
  preparedStock: PreparedStock[],
  memory: Map<string, MemoryRow[]>,
  exclusions: Set<string>,
  stopWords: Set<string>,
  trace?: MatcherTrace
): Promise<{ matchedItems: StockItem[]; needsReview: boolean }> {

  const key = cleanText(item.produit, stopWords)

  if (!key) {
    return {
      matchedItems: [],
      needsReview: item.needs_review,
    }
  }

  // ============================================================
  // 1. MÉMOIRE PERSISTANTE
  // ============================================================

  const remembered = memory.get(key) ?? []

  if (remembered.length && trace) {
    trace.stock.memoryHit = true
    trace.stock.source = 'memory'

    trace.events.push(
      `Mémoire stock trouvée : ${remembered.length} rapprochement(s)`
    )
  }

  for (const row of remembered) {

    const found = preparedStock.find(
      p => p.item.id === row.stock_item_id
    )

    if (!found) continue

    if (
      exclusions.has(
        `${key}::${row.stock_item_id}`
      )
    ) {
      continue
    }

    if (trace) {
      trace.stock.source = 'memory'

      trace.events.push(
        `Mémoire stock utilisée : ${found.item.produit} (${row.source}, confiance ${Number(row.confidence).toFixed(2)})`
      )
    }

    const exactSameProduct = preparedStock.filter(
      p =>
        p.normalized === found.normalized &&
        !exclusions.has(
          `${key}::${p.item.id}`
        )
    )

    return {
      matchedItems: exactSameProduct.map(
        p => p.item
      ),

      needsReview:
        !row.validated &&
        row.confidence < 0.9,
    }
  }


  // ============================================================
  // 2. CORRESPONDANCE EXACTE
  // ============================================================

  const exact = preparedStock.filter(
    p =>
      p.normalized === key &&
      !exclusions.has(
        `${key}::${p.item.id}`
      )
  )

  if (exact.length) {

    if (trace) {
      trace.stock.source = 'exact'

      trace.events.push(
        `Correspondance stock exacte : ${exact[0].item.produit}`
      )
    }

    for (const prepared of exact) {
      await saveStockMemory(
        key,
        prepared.item,
        'exact',
        1,
        'Correspondance exacte après normalisation',
        true
      )
    }

    return {
      matchedItems: exact.map(
        p => p.item
      ),
      needsReview: item.needs_review,
    }
  }


  // ============================================================
  // 3. SCORE LEXICAL
  // ============================================================

  const candidates = preparedStock
    .map(p => ({
      ...p,
      score: textScore(
        item.produit,
        p.item.produit,
        stopWords
      ),
    }))
    .filter(
      p =>
        p.score >= CONFIG.MIN_CANDIDATE_SCORE &&
        !exclusions.has(
          `${key}::${p.item.id}`
        )
    )
    .sort(
      (a, b) =>
        b.score - a.score
    )
    .slice(
      0,
      CONFIG.CANDIDATE_LIMIT
    )

  // Même lorsqu'aucun candidat ne dépasse le seuil lexical, Claude reçoit
  // les meilleurs candidats faibles afin de pouvoir reconnaître les libellés
  // réels de stock (ex. "tomates" / "tomate fraîche").
  const aiCandidates = candidates.length
    ? candidates
    : preparedStock
        .map(p => ({
          ...p,
          score: textScore(item.produit, p.item.produit, stopWords),
        }))
        .filter(p => !exclusions.has(`${key}::${p.item.id}`))
        .sort((a, b) => b.score - a.score)
        .slice(0, CONFIG.CANDIDATE_LIMIT)

  if (!aiCandidates.length) {
    if (trace) {
      trace.stock.source = 'none'
      trace.events.push('Aucun article stock disponible pour le rapprochement')
    }
    return { matchedItems: [], needsReview: item.needs_review }
  }


  // ============================================================
  // 4. MATCH LEXICAL SÛR
  // ============================================================

  if (
    bestIsSafe(
      candidates,
      CONFIG.STOCK_AUTO_SCORE,
      CONFIG.STOCK_AUTO_MARGIN
    )
  ) {

    const selected = candidates[0]

    if (trace) {
      trace.stock.source = 'lexical'

      trace.events.push(
        `Match stock lexical automatique : ${selected.item.produit} (${selected.score.toFixed(2)})`
      )
    }

    await saveStockMemory(
      key,
      selected.item,
      'text',
      selected.score,
      `Match automatique : score ${selected.score.toFixed(2)}`,
      true
    )

    return {
      matchedItems:
        preparedStock
          .filter(
            p =>
              p.normalized ===
                selected.normalized &&
              !exclusions.has(
                `${key}::${p.item.id}`
              )
          )
          .map(
            p => p.item
          ),

      needsReview:
        item.needs_review,
    }
  }


  // ============================================================
  // 5. CLAUDE — UNIQUEMENT SI AMBIGU
  // ============================================================

  if (trace) {
    trace.stock.aiCalled = true
    trace.stock.source = 'ai'
    trace.claudeCalls += 1

    trace.events.push(
      'Claude appelé pour le rapprochement stock'
    )
  }

  const ai =
    await matchStockWithClaude(
      item.produit,
      aiCandidates.map(
        c => ({
          id: c.item.id,
          label: c.item.produit,
          lexicalScore: c.score,
          metadata: {
            source: c.item.source,
          },
        })
      )
    )

  if (trace) {
    trace.stock.aiConfidence =
      ai.confidence ?? null

    trace.events.push(
      `Claude : ${ai.matched ? 'match trouvé' : 'aucun match'} — confiance ${Number(ai.confidence ?? 0).toFixed(2)}`
    )
  }

  if (!ai.matched) {

    return {
      matchedItems: [],
      needsReview: true,
    }
  }

  const selected =
    aiCandidates.find(
      c => c.item.id === ai.matched
    )

  if (!selected) {

    return {
      matchedItems: [],
      needsReview: true,
    }
  }


  // ============================================================
  // 6. APPRENTISSAGE
  // ============================================================

  if (
    ai.confidence >=
    CONFIG.AI_LEARNING_THRESHOLD
  ) {

    await saveStockMemory(
      key,
      selected.item,
      'ai',
      ai.confidence,
      ai.reason,
      false
    )
  }


  return {
    matchedItems:
      preparedStock
        .filter(
          p =>
            p.normalized ===
              selected.normalized &&
            !exclusions.has(
              `${key}::${p.item.id}`
            )
        )
        .map(
          p => p.item
        ),

    needsReview:
      item.needs_review ||
      ai.confidence < 0.85,
  }
}

type ConvertedStock = {
  qty: number
  unit: string
  converted: boolean
  reason: string
}

function getUnitMapping(refData: ReferenceData, unit: string) {
  return findUnitMapping(refData, unit)
}

function canonicalUnit(refData: ReferenceData, unit: string): {
  unit: 'g' | 'mL' | 'pièce'
  factor: number
  type: 'poids' | 'volume' | 'unité'
} | null {
  const cleaned = normalizeUnitKey(unit)

  if (cleaned === 'g') return { unit: 'g', factor: 1, type: 'poids' }
  if (cleaned === 'kg') return { unit: 'g', factor: 1000, type: 'poids' }
  if (cleaned === 'ml') return { unit: 'mL', factor: 1, type: 'volume' }
  if (cleaned === 'cl') return { unit: 'mL', factor: 10, type: 'volume' }
  if (cleaned === 'dl') return { unit: 'mL', factor: 100, type: 'volume' }
  if (cleaned === 'l') return { unit: 'mL', factor: 1000, type: 'volume' }
  if (cleaned === 'piece') return { unit: 'pièce', factor: 1, type: 'unité' }

  const mapping = getUnitMapping(refData, unit)
  if (!mapping) return null

  const type = mapping.type_unite as 'poids' | 'volume' | 'unité' | null
  if (!type) return null

  // V3.3 : `multiplicateur` vaut actuellement 1 dans la base.
  // L'équivalence_reference est donc utilisée pour les conversions
  // physiques (kg, càs, cc, etc.).
  let factor = parseReferenceFactor(mapping.equivalence_reference, type)

  // Si aucune équivalence exploitable n'est fournie, on conserve
  // le multiplicateur existant pour permettre son évolution future.
  if (factor === 1) {
    const configured = Number(mapping.multiplicateur ?? 1)
    if (Number.isFinite(configured) && configured > 0) factor = configured
  }

  if (type === 'poids') return { unit: 'g', factor, type }
  if (type === 'volume') return { unit: 'mL', factor, type }
  if (type === 'unité') return { unit: 'pièce', factor: 1, type }

  return null
}

/**
 * Convertit une quantité de stock vers l'unité canonique du besoin.
 *
 * Règles :
 * - poids -> g
 * - volume -> mL
 * - unités -> pièce
 * - volume <-> poids uniquement si ingredient_densities fournit une densité.
 *
 * Claude n'intervient jamais dans cette conversion.
 */
function convertStockQuantity(
  refData: ReferenceData,
  ingredientId: string | null,
  qty: number,
  fromUnit: string,
  targetUnit: string
): ConvertedStock | null {
  if (!Number.isFinite(qty)) return null

  const from = canonicalUnit(refData, fromUnit)
  const target = canonicalUnit(refData, targetUnit)

  if (!from || !target) return null

  if (from.unit === target.unit) {
    return {
      qty: qty * from.factor / target.factor,
      unit: target.unit,
      converted: cleanText(fromUnit) !== cleanText(targetUnit),
      reason:
        cleanText(fromUnit) === cleanText(targetUnit)
          ? 'Même unité'
          : `${fromUnit} → ${targetUnit}`,
    }
  }

  // Volume -> poids via densité de l'ingrédient.
  if (
    from.type === 'volume' &&
    target.type === 'poids' &&
    ingredientId
  ) {
    const density =
      findDensity(refData, ingredientId, fromUnit) ??
      findDensity(refData, ingredientId, from.unit) ??
      findDensityForType(refData, ingredientId, 'volume')

    if (!density) return null

    const densityUnit = canonicalUnit(refData, density.unite)
    const gramsPerDensityUnit = Number(density.poids_g_approx)

    if (
      !densityUnit ||
      densityUnit.type !== 'volume' ||
      !Number.isFinite(gramsPerDensityUnit) ||
      gramsPerDensityUnit <= 0
    ) {
      return null
    }

    const qtyMl = qty * from.factor
    const densityUnits = qtyMl / densityUnit.factor
    const grams = densityUnits * gramsPerDensityUnit

    if (!Number.isFinite(grams)) return null

    return {
      qty: grams,
      unit: 'g',
      converted: true,
      reason: `${fromUnit} → g via densité`,
    }
  }

  // Poids -> volume via densité de l'ingrédient.
  if (
    from.type === 'poids' &&
    target.type === 'volume' &&
    ingredientId
  ) {
    const density =
      findDensity(refData, ingredientId, targetUnit) ??
      findDensity(refData, ingredientId, target.unit) ??
      findDensityForType(refData, ingredientId, 'volume')

    if (!density) return null

    const densityUnit = canonicalUnit(refData, density.unite)
    const gramsPerDensityUnit = Number(density.poids_g_approx)

    if (
      !densityUnit ||
      densityUnit.type !== 'volume' ||
      !Number.isFinite(gramsPerDensityUnit) ||
      gramsPerDensityUnit <= 0
    ) {
      return null
    }

    const grams = qty * from.factor
    const densityUnits = grams / gramsPerDensityUnit
    const targetVolumeMl = densityUnits * densityUnit.factor

    return {
      qty: targetVolumeMl / target.factor,
      unit: target.unit,
      converted: true,
      reason: `${fromUnit} → ${targetUnit} via densité`,
    }
  }

  return null
}

export interface StockComparisonDetail {
  produit: string
  qte_stock: number
  unite_stock: string
  qte_convertie: number | null
  unite_comparee: string
  conversion: string | null
}

export interface ComparedRequirement extends AggregatedRequirement {
  qte_a_acheter: number
  ai_status: 'green' | 'orange' | 'red'
  qte_stock?: number
  stock_details?: StockComparisonDetail[]
}

export async function compareToStock(
  aggregated: AggregatedRequirement[],
  globalStock: StockItem[],
  refData: ReferenceData,
  trace?: MatcherTrace
): Promise<ComparedRequirement[]> {
  const stopWords = await loadMatcherStopWords()

  const preparedStock = globalStock.map(item => ({
    item,
    normalized: cleanText(item.produit, stopWords),
    tokens: tokens(item.produit, stopWords),
  }))

  const keys = aggregated.map(item => cleanText(item.produit, stopWords))
  const { memory, exclusions } = await loadStockMemory(keys)

  const results: ComparedRequirement[] = []

  for (const item of aggregated) {
    const match = await matchOneRequirement(
      item,
      preparedStock,
      memory,
      exclusions,
      stopWords,
      trace
    )

    let totalStockQty = 0
    let hasUnitMismatch = false
    const stockDetails: StockComparisonDetail[] = []

    for (const stock of match.matchedItems) {
      const converted = convertStockQuantity(
        refData,
        item.ingredient_id,
        Number(stock.qte || 0),
        stock.unite,
        item.unite
      )

      if (!converted) {
        hasUnitMismatch = true
        stockDetails.push({
          produit: stock.produit,
          qte_stock: Number(stock.qte || 0),
          unite_stock: stock.unite,
          qte_convertie: null,
          unite_comparee: item.unite,
          conversion: null,
        })
        continue
      }

      totalStockQty += converted.qty

      stockDetails.push({
        produit: stock.produit,
        qte_stock: Number(stock.qte || 0),
        unite_stock: stock.unite,
        qte_convertie: converted.qty,
        unite_comparee: converted.unit,
        conversion: converted.converted ? converted.reason : null,
      })
    }

    const qte_a_acheter = Math.max(0, item.qte - totalStockQty)

    let ai_status: 'green' | 'orange' | 'red' = 'red'

    if (totalStockQty >= item.qte) {
      ai_status = 'green'
    } else if (totalStockQty > 0) {
      ai_status = 'orange'
    } else if (hasUnitMismatch || match.needsReview) {
      ai_status = 'orange'
    }

    if (trace && stockDetails.length) {
      trace.events.push(
        `Stock quantifié : ${totalStockQty.toFixed(2)} ${item.unite} disponible(s) pour ${item.qte} ${item.unite}`
      )

      if (hasUnitMismatch) {
        trace.events.push(
          'Une partie du stock n’a pas pu être convertie dans l’unité du besoin'
        )
      }
    }

    results.push({
      ...item,
      qte_a_acheter,
      ai_status,
      needs_review: item.needs_review || match.needsReview,
      qte_stock: totalStockQty,
      stock_details: stockDetails,
    })
  }

  return results
}


export interface RecipeAnalysisInput {
  id: string
  nom: string
  baseServings: number
  servings?: number
  ingredients: RecipeIngredient[]
}

export interface RecipeAnalysisResult {
  recipe: { id: string; nom: string; baseServings: number; servings: number }
  resolved: ResolvedIngredient[]
  aggregated: AggregatedRequirement[]
  compared: ComparedRequirement[]
}

/**
 * Orchestration backend V3.4 : une recette Cookiwiki -> résolution ->
 * agrégation -> croisement avec le stock réel.
 * Cette fonction est volontairement indépendante de Next.js pour être
 * réutilisable par le test Matcher puis par le Meal Planner.
 */
export async function analyzeRecipe(
  recipe: RecipeAnalysisInput,
  globalStock: StockItem[],
  refData?: ReferenceData,
  trace?: MatcherTrace
): Promise<RecipeAnalysisResult> {
  const data = refData ?? await loadReferenceData()
  const servings = Number(recipe.servings ?? recipe.baseServings)
  const base = Number(recipe.baseServings) > 0 ? Number(recipe.baseServings) : 4
  const ratio = Number.isFinite(servings) && servings > 0 ? servings / base : 1

  const resolved = await resolveRecipeIngredients(
    recipe.ingredients,
    data,
    recipe.id,
    recipe.nom,
    ratio,
    trace
  )
  const aggregated = aggregateRequirements([resolved])
  const compared = await compareToStock(aggregated, globalStock, data, trace)

  return {
    recipe: {
      id: recipe.id,
      nom: recipe.nom,
      baseServings: base,
      servings: Number.isFinite(servings) && servings > 0 ? servings : base,
    },
    resolved,
    aggregated,
    compared,
  }
}

export async function analyzeRecipes(
  recipes: RecipeAnalysisInput[],
  globalStock: StockItem[],
  refData?: ReferenceData,
  trace?: MatcherTrace
): Promise<{
  recipes: RecipeAnalysisResult[]
  aggregated: AggregatedRequirement[]
  compared: ComparedRequirement[]
}> {
  const data = refData ?? await loadReferenceData()
  const results: RecipeAnalysisResult[] = []
  const resolvedLists: ResolvedIngredient[][] = []

  for (const recipe of recipes) {
    const servings = Number(recipe.servings ?? recipe.baseServings)
    const base = Number(recipe.baseServings) > 0 ? Number(recipe.baseServings) : 4
    const ratio = Number.isFinite(servings) && servings > 0 ? servings / base : 1
    const resolved = await resolveRecipeIngredients(
      recipe.ingredients,
      data,
      recipe.id,
      recipe.nom,
      ratio,
      trace
    )
    resolvedLists.push(resolved)
    results.push({
      recipe: {
        id: recipe.id,
        nom: recipe.nom,
        baseServings: base,
        servings: Number.isFinite(servings) && servings > 0 ? servings : base,
      },
      resolved,
      aggregated: aggregateRequirements([resolved]),
      compared: [],
    })
  }

  const aggregated = aggregateRequirements(resolvedLists)
  const compared = await compareToStock(aggregated, globalStock, data, trace)

  return { recipes: results, aggregated, compared }
}

export async function loadMatcherStopWords(): Promise<Set<string>> {
  const { data, error } = await mealioServerDb.from('ignored_words').select('mot')
  const set = new Set(BASE_STOP_WORDS)
  if (error) console.error('ignored_words:', error.message)
  for (const row of data ?? []) {
    const value = cleanText(String(row.mot ?? ''), BASE_STOP_WORDS)
    if (value) set.add(value)
  }
  return set
}
