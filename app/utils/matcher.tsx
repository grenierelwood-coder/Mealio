import { mealioServerDb } from '../lib/supabase-server'
import {
  matchStockWithClaude,
  resolveOfficialIngredientWithClaude,
} from '../lib/anthropic-server'
import { getQuantityMode, type QuantityMode } from './quantity-policy'

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
  /** Ingredient officiel associé à la ligne de stock lorsqu'il est connu. */
  ingredient_id?: string | null
}

type OfficialIngredient = {
  id: string
  nom: string
  rayon: string | null
  default_storage: string | null
  categorie: string | null
  unite_reference: string | null
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
  officialPrepared: {
    item: OfficialIngredient
    normalized: string
    tokens: string[]
  }[]
  unitMappings: {
    unite: string
    abreviation: string | null
    type_unite: string | null
    equivalence_reference?: string | null
    multiplicateur: number | null
  }[]
  densities: {
    ingredient_id: string
    unite: string
    poids_g_approx: number
  }[]
  aiResolutionMap: Map<string, AiResolution>
  aiCache: Map<string, string | null>
}

export interface MatcherDecision {
  kind: 'ingredient' | 'stock'
  source: 'ignored' | 'synonym' | 'exact' | 'lexical' | 'memory' | 'ai' | 'unresolved' | 'none'
  confidence: number | null
  reason: string
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
  ingredientCandidates?: Array<{ id: string; name: string; score: number }>
  stockCandidates?: Array<{ id: string; name: string; score: number; source?: string }>
  ingredientDecision?: MatcherDecision
  stockDecision?: MatcherDecision
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
    ingredientCandidates: [],
    stockCandidates: [],
    ingredientDecision: {
      kind: 'ingredient',
      source: 'unresolved',
      confidence: null,
      reason: 'Aucune décision prise',
    },
  }
}

const BASE_STOP_WORDS = new Set([
  'de',
  'du',
  'des',
  'la',
  'le',
  'les',
  'un',
  'une',
  'et',
  'a',
  'au',
  'aux',
  'en',
  'pour',
  'avec',
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

DISCRIMINANT_GROUPS.forEach((group, index) =>
  group.forEach(token =>
    discriminantGroupByToken.set(token, index)
  )
)

function singularizeWord(word: string): string {
  if (!word || word.length <= 3) return word

  if (
    new Set([
      'riz',
      'mais',
      'pois',
      'jus',
      'os',
      'frais',
    ]).has(word)
  ) {
    return word
  }

  if (word.endsWith('ufs')) return word.slice(0, -1)

  if (
    word.endsWith('tes') ||
    word.endsWith('ons') ||
    word.endsWith('res') ||
    word.endsWith('nes') ||
    word.endsWith('mes') ||
    word.endsWith('des') ||
    word.endsWith('ves')
  ) {
    return word.slice(0, -1)
  }

  if (word.endsWith('es')) return word.slice(0, -1)

  if (
    word.endsWith('s') &&
    !word.endsWith('ss') &&
    word.length >= 5
  ) {
    return word.slice(0, -1)
  }

  return word
}

export function cleanText(
  text: string,
  stopWords?: Set<string>
): string {
  if (!text) return ''

  const ignored =
    stopWords ?? BASE_STOP_WORDS

  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()[\],.;:/\\'"!?-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singularizeWord)
    .filter(w => !ignored.has(w))
    .join(' ')
}

function tokens(
  text: string,
  stopWords: Set<string>
): string[] {
  return cleanText(text, stopWords)
    .split(' ')
    .filter(Boolean)
}

function levenshtein(
  a: string,
  b: string
): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  const prev = Array.from(
    { length: b.length + 1 },
    (_, i) => i
  )

  for (let i = 0; i < a.length; i++) {
    const curr = [i + 1]

    for (let j = 0; j < b.length; j++) {
      const cost =
        a[i] === b[j] ? 0 : 1

      curr.push(
        Math.min(
          curr[j] + 1,
          prev[j + 1] + 1,
          prev[j] + cost
        )
      )
    }

    for (let j = 0; j < curr.length; j++) {
      prev[j] = curr[j]
    }
  }

  return prev[b.length]
}

function similarity(
  a: string,
  b: string
): number {
  if (!a || !b) return 0
  if (a === b) return 1

  return Math.max(
    0,
    1 -
      levenshtein(a, b) /
        Math.max(a.length, b.length)
  )
}

function contradictionPenalty(
  aTokens: string[],
  bTokens: string[]
): number {
  const groups = new Set<number>()

  for (const t of aTokens) {
    const g =
      discriminantGroupByToken.get(t)

    if (g !== undefined) {
      groups.add(g)
    }
  }

  for (const t of bTokens) {
    const g =
      discriminantGroupByToken.get(t)

    if (
      g !== undefined &&
      groups.has(g) &&
      !aTokens.includes(t)
    ) {
      return 0.18
    }
  }

  return 0
}

function textScore(
  a: string,
  b: string,
  stopWords: Set<string>
): number {
  const na = cleanText(a, stopWords)
  const nb = cleanText(b, stopWords)

  if (!na || !nb) return 0
  if (na === nb) return 1

  const at = tokens(na, stopWords)
  const bt = tokens(nb, stopWords)

  if (!at.length || !bt.length) return 0

  const bs = new Set(bt)

  const common =
    at.filter(t => bs.has(t)).length

  const coverageA =
    common / at.length

  const coverageB =
    common / bt.length

  let score =
    coverageA * 0.55 +
    coverageB * 0.20 +
    similarity(na, nb) * 0.25

  if (coverageA === 1) {
    score += 0.04
  }

  score -= contradictionPenalty(
    at,
    bt
  )

  return Math.min(
    0.97,
    Math.max(0, score)
  )
}

function tokenCoverage(
  source: string,
  candidate: string,
  stopWords: Set<string>
): { sourceCoverage: number; candidateCoverage: number; common: string[] } {
  const sourceTokens = tokens(source, stopWords)
  const candidateTokens = tokens(candidate, stopWords)

  if (!sourceTokens.length || !candidateTokens.length) {
    return { sourceCoverage: 0, candidateCoverage: 0, common: [] }
  }

  const candidateSet = new Set(candidateTokens)
  const common = sourceTokens.filter(t => candidateSet.has(t))
  const sourceSet = new Set(sourceTokens)
  const commonUnique = candidateTokens.filter(t => sourceSet.has(t))

  return {
    sourceCoverage: new Set(common).size / new Set(sourceTokens).size,
    candidateCoverage: new Set(commonUnique).size / new Set(candidateTokens).size,
    common: Array.from(new Set(common)),
  }
}

/**
 * Equivalences sémantiques métier utilisées uniquement pour le
 * filtrage des candidats stock.
 *
 * Elles ne remplacent pas ingredient_synonyms : elles évitent simplement
 * qu'une relation alimentaire évidente soit rejetée avant Claude lorsque
 * le libellé du stock emploie un terme différent.
 *
 * À terme, ces relations pourront être migrées dans une table de référence.
 */
const STOCK_SEMANTIC_EQUIVALENCES: Record<string, string[]> = {
  gambas: ['crevette'],
  gamba: ['crevette'],
  crevette: ['gambas'],
}

const STOCK_NON_DISCRIMINANT_TOKENS = new Set([
  'hache',
  'hachee',
  'haches',
  'hachees',
  'frais',
  'fraiche',
  'frais',
  'fraiches',
  'surgelé',
  'surgele',
  'surgeles',
  'surgelées',
  'surgelees',
  'decoupe',
  'decoupee',
  'decoupes',
  'decoupees',
  'tranche',
  'tranchee',
  'tranches',
  'tranchees',
  'emince',
  'emincee',
  'eminces',
  'emincees',
  'rape',
  'rapee',
  'rapes',
  'rapees',
  'cuit',
  'cuite',
  'cuits',
  'cuites',
  'cru',
  'crue',
  'crus',
  'crues',
  'sec',
  'seche',
  'secs',
  'seches',
])

export function getIngredientSemanticLabels(
  ingredientId: string,
  refData: ReferenceData
): string[] {
  const official =
    refData.officialById.get(ingredientId)

  const labels = new Set<string>()

  if (official?.nom) {
    labels.add(cleanText(official.nom))
  }

  for (const [synonym, mappedId] of refData.synonymMap.entries()) {
    if (mappedId === ingredientId && synonym) {
      labels.add(cleanText(synonym))
    }
  }

  // Ajoute les équivalences métier connues pour la garde stock.
  // Exemple : Gambas -> crevette -> permet de reconnaître
  // « Crevettes roses » sans appeler Claude.
  const seedLabels = Array.from(labels)
  for (const label of seedLabels) {
    const labelTokens = tokens(label, BASE_STOP_WORDS)

    for (const token of labelTokens) {
      for (const equivalent of STOCK_SEMANTIC_EQUIVALENCES[token] ?? []) {
        labels.add(equivalent)
      }
    }
  }

  return Array.from(labels)
}

function hasSemanticStockEvidence(
  ingredientId: string | null,
  candidateName: string,
  refData: ReferenceData,
  stopWords: Set<string>
): {
  matched: boolean
  label?: string
  common?: string[]
} {
  if (!ingredientId) {
    return { matched: true }
  }

  const labels = getIngredientSemanticLabels(
    ingredientId,
    refData
  )

  const candidateTokens = new Set(
    tokens(candidateName, stopWords)
  )

  for (const label of labels) {
    const coverage = tokenCoverage(
      label,
      candidateName,
      stopWords
    )

    const meaningfulCommon = coverage.common.filter(
      token => !STOCK_NON_DISCRIMINANT_TOKENS.has(token)
    )

    if (meaningfulCommon.length > 0) {
      return {
        matched: true,
        label,
        common: meaningfulCommon,
      }
    }

    const labelNormalized = cleanText(
      label,
      stopWords
    )

    if (
      labelNormalized &&
      candidateTokens.has(labelNormalized)
    ) {
      return {
        matched: true,
        label,
        common: [labelNormalized],
      }
    }
  }

  return { matched: false }
}

function bestIsSafe<T extends { score: number }>(
  candidates: T[],
  minScore: number,
  minMargin: number
): boolean {
  if (
    !candidates.length ||
    candidates[0].score < minScore
  ) {
    return false
  }

  const margin =
    candidates.length > 1
      ? candidates[0].score -
        candidates[1].score
      : candidates[0].score

  return margin >= minMargin
}

export async function loadReferenceData(): Promise<ReferenceData> {
  const [
    ignored,
    synonyms,
    official,
    units,
    densities,
    aiLogs,
  ] = await Promise.all([
    mealioServerDb
      .from('ignored_words')
      .select('mot'),

    mealioServerDb
      .from('ingredient_synonyms')
      .select(
        'mot_recette, ingredient_id'
      ),

    mealioServerDb
      .from('official_ingredients')
      .select(
        'id, nom, rayon, default_storage, categorie, unite_reference'
      ),

    mealioServerDb
      .from('unit_mappings')
      .select(
        'unite, abreviation, type_unite, equivalence_reference, multiplicateur'
      ),

    mealioServerDb
      .from('ingredient_densities')
      .select(
        'ingredient_id, unite, poids_g_approx'
      ),

    mealioServerDb
      .from('ai_resolution_log')
      .select(
        'mot_recette, proposition_ia, ingredient_id_propose, statut, created_at'
      )
      .order('created_at', {
        ascending: false,
      }),
  ])

  if (ignored.error) {
    console.error(
      'ignored_words:',
      ignored.error.message
    )
  }

  if (synonyms.error) {
    console.error(
      'ingredient_synonyms:',
      synonyms.error.message
    )
  }

  if (official.error) {
    console.error(
      'official_ingredients:',
      official.error.message
    )
  }

  if (units.error) {
    console.error(
      'unit_mappings:',
      units.error.message
    )
  }

  if (densities.error) {
    console.error(
      'ingredient_densities:',
      densities.error.message
    )
  }

  if (aiLogs.error) {
    console.error(
      'ai_resolution_log:',
      aiLogs.error.message
    )
  }

  const officialList =
    (official.data ??
      []) as OfficialIngredient[]

  const ignoredSet =
    new Set(BASE_STOP_WORDS)

  for (const row of ignored.data ?? []) {
    const value = cleanText(
      String(row.mot ?? ''),
      BASE_STOP_WORDS
    )

    if (value) {
      ignoredSet.add(value)
    }
  }

  const aiResolutionMap =
    new Map<string, AiResolution>()

  for (const row of aiLogs.data ?? []) {
    const key = cleanText(
      String(row.mot_recette ?? '')
    )

    if (
      key &&
      !aiResolutionMap.has(key)
    ) {
      aiResolutionMap.set(
        key,
        row as AiResolution
      )
    }
  }

  return {
    ignoredSet,

    synonymMap: new Map(
      (synonyms.data ?? []).map(s => [
        cleanText(s.mot_recette),
        s.ingredient_id,
      ])
    ),

    officialList,

    officialById:
      new Map(
        officialList.map(o => [
          o.id,
          o,
        ])
      ),

    officialPrepared:
      officialList.map(item => ({
        item,
        normalized: cleanText(
          item.nom,
          ignoredSet
        ),
        tokens: tokens(
          item.nom,
          ignoredSet
        ),
      })),

    unitMappings:
      units.data ?? [],

    densities:
      densities.data ?? [],

    aiResolutionMap,

    aiCache:
      new Map(),
  }
}

/**
 * Normalise les unités de cuisine avant
 * consultation du référentiel.
 */
function normalizeUnitKey(
  unit: string
): string {
  const raw = String(unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/\(s\)/g, '')
    .replace(/\s+/g, ' ')

  const aliases: Record<
    string,
    string
  > = {
    'c.à.s': 'cs',
    'c.a.s': 'cs',
    'càs': 'cs',
    cas: 'cs',
    'c à s': 'cs',
    'c a s': 'cs',
    'c.s': 'cs',
    cs: 'cs',
    'cuillere a soupe': 'cs',
    'cuillère à soupe': 'cs',

    'c.à.c': 'cc',
    'c.a.c': 'cc',
    'càc': 'cc',
    cac: 'cc',
    'c à c': 'cc',
    'c a c': 'cc',
    'c.c': 'cc',
    cc: 'cc',
    'cuillere a cafe': 'cc',
    'cuillère à café': 'cc',

    ml: 'ml',
    millilitre: 'ml',
    millilitres: 'ml',

    cl: 'cl',
    centilitre: 'cl',
    centilitres: 'cl',

    dl: 'dl',
    decilitre: 'dl',
    decilitres: 'dl',

    l: 'l',
    litre: 'l',
    litres: 'l',

    g: 'g',
    gr: 'g',
    gramme: 'g',
    grammes: 'g',

    mg: 'mg',
    milligramme: 'mg',
    milligrammes: 'mg',

    kg: 'kg',
    kilogramme: 'kg',
    kilogrammes: 'kg',

    piece: 'piece',
    pièce: 'piece',
    pièces: 'piece',
    pieces: 'piece',
    'piece s': 'piece',
    'pièce s': 'piece',
    'pièces s': 'piece',
    unite: 'piece',
    unité: 'piece',
    unités: 'piece',
    'unite s': 'piece',
    'unité s': 'piece',

    tranche: 'tranche',
    tranches: 'tranche',
    'tranche s': 'tranche',

    gousse: 'gousse',
    gousses: 'gousse',

    sachet: 'sachet',
    sachets: 'sachet',

    paquet: 'paquet',
    paquets: 'paquet',

    boite: 'boite',
    boîte: 'boite',
    boites: 'boite',
    boîtes: 'boite',
  }

  if (aliases[raw]) {
    return aliases[raw]
  }

  const cleaned =
    cleanText(raw)

  return aliases[cleaned] ?? cleaned
}

function parseReferenceFactor(
  reference:
    | string
    | null
    | undefined,
  type: string | null
): number {
  if (!reference) return 1

  const targetUnit =
    type === 'poids'
      ? /(\d+(?:[.,]\d+)?)\s*g\b/i
      : type === 'volume'
        ? /(\d+(?:[.,]\d+)?)\s*ml\b/i
        : null

  if (!targetUnit) return 1

  const match =
    reference
      .replace(',', '.')
      .match(targetUnit)

  if (!match) return 1

  const value =
    Number(match[1])

  return Number.isFinite(value) &&
    value > 0
    ? value
    : 1
}

function findUnitMapping(
  refData: ReferenceData,
  unit: string
) {
  const key =
    normalizeUnitKey(unit)

  return refData.unitMappings.find(
    u => {
      const uniteKey =
        normalizeUnitKey(u.unite)

      const abbreviationKey =
        normalizeUnitKey(
          u.abreviation ?? ''
        )

      return (
        uniteKey === key ||
        abbreviationKey === key
      )
    }
  )
}

function findDensity(
  refData: ReferenceData,
  ingredientId: string,
  unit: string
) {
  const ingredient = refData.officialById.get(ingredientId)

  // Verrou central : un ingrédient en mode « Présence » ne peut jamais
  // exploiter une densité, même si une vieille ligne existe encore en DB.
  if (ingredient && getQuantityMode(ingredient) === 'presence') {
    return undefined
  }

  const key =
    normalizeUnitKey(unit)

  return refData.densities.find(
    d =>
      d.ingredient_id ===
        ingredientId &&
      normalizeUnitKey(d.unite) ===
        key
  )
}

function findDensityForType(
  refData: ReferenceData,
  ingredientId: string,
  type: 'poids' | 'volume'
) {
  const ingredient = refData.officialById.get(ingredientId)
  if (ingredient && getQuantityMode(ingredient) === 'presence') {
    return undefined
  }

  return refData.densities.find(
    d => {
      if (
        d.ingredient_id !==
        ingredientId
      ) {
        return false
      }

      const mapping =
        findUnitMapping(
          refData,
          d.unite
        )

      return (
        mapping?.type_unite ===
        type
      )
    }
  )
}

async function saveAiResolution(
  rawName: string,
  proposition: string | null,
  ingredientId: string | null
): Promise<void> {
  const { error } =
    await mealioServerDb
      .from('ai_resolution_log')
      .insert({
        mot_recette: rawName,
        proposition_ia:
          proposition ?? 'AUCUN',
        ingredient_id_propose:
          ingredientId,
        statut: 'en_attente',
      })

  if (error) {
    console.error(
      'ai_resolution_log insert:',
      error.message
    )
  }
}

function setIngredientDecision(
  trace: MatcherTrace | undefined,
  source: MatcherTrace['ingredient']['source'],
  confidence: number | null,
  reason: string
) {
  if (!trace) return
  trace.ingredient.source = source
  trace.ingredientDecision = {
    kind: 'ingredient',
    source,
    confidence,
    reason,
  }
}

async function resolveOfficialIngredient(
  rawName: string,
  refData: ReferenceData,
  trace?: MatcherTrace
): Promise<{
  id: string | null
  name: string | null
  aiProposed: boolean
}> {
  const key =
    cleanText(rawName)

  if (
    !key ||
    refData.ignoredSet.has(key)
  ) {
    return {
      id: null,
      name: null,
      aiProposed: false,
    }
  }

  // ============================================================
  // 1. SYNONYME EXPLICITE
  // ============================================================

  const synonymId =
    refData.synonymMap.get(key)

  if (synonymId) {
    const official =
      refData.officialById.get(
        synonymId
      )

    if (official) {
      if (trace) {
        setIngredientDecision(trace, 'synonym', 1, 'Synonyme explicite du référentiel')

        trace.events.push(
          `Synonyme trouvé : ${official.nom}`
        )
      }

      refData.aiCache.set(
        key,
        official.id
      )

      return {
        id: official.id,
        name: official.nom,
        aiProposed: false,
      }
    }
  }

  // ============================================================
  // 2. CORRESPONDANCE EXACTE
  // ============================================================

  const normalizedRaw =
    cleanText(
      rawName,
      refData.ignoredSet
    )

  const exact =
    refData.officialPrepared.find(
      o =>
        o.normalized ===
        normalizedRaw
    )

  if (exact) {
    if (trace) {
      setIngredientDecision(trace, 'exact', 1, 'Nom normalisé identique au référentiel officiel')

      trace.events.push(
        `Correspondance exacte : ${exact.item.nom}`
      )
    }

    refData.aiCache.set(
      key,
      exact.item.id
    )

    return {
      id: exact.item.id,
      name: exact.item.nom,
      aiProposed: false,
    }
  }

  // ============================================================
  // 5. MOTEUR LEXICAL
  // ============================================================

  const candidates =
    refData.officialPrepared
      .map(o => ({
        ...o,
        score: textScore(
          rawName,
          o.item.nom,
          refData.ignoredSet
        ),
      }))
      .filter(
        o =>
          o.score >=
          CONFIG.MIN_CANDIDATE_SCORE
      )
      .sort(
        (a, b) =>
          b.score - a.score
      )
      .slice(
        0,
        CONFIG.CANDIDATE_LIMIT
      )

  if (trace) {
    trace.ingredientCandidates = candidates.map(c => ({
      id: c.item.id,
      name: c.item.nom,
      score: Number(c.score.toFixed(4)),
    }))
  }

  const lexicalWinner = candidates[0]
  const lexicalCoverage = lexicalWinner
    ? tokenCoverage(
        normalizedRaw,
        lexicalWinner.item.nom,
        refData.ignoredSet
      )
    : null

  const lexicalIsDeterministic =
    bestIsSafe(
      candidates,
      CONFIG.OFFICIAL_AUTO_SCORE,
      CONFIG.OFFICIAL_AUTO_MARGIN
    ) ||
    Boolean(
      lexicalWinner &&
      lexicalCoverage &&
      lexicalCoverage.candidateCoverage === 1 &&
      lexicalCoverage.common.length > 0 &&
      lexicalWinner.score >= 0.55 &&
      (candidates.length === 1 ||
        lexicalWinner.score - candidates[1].score >= 0.05)
    )

  if (lexicalIsDeterministic) {
    if (trace) {
      setIngredientDecision(
        trace,
        'lexical',
        candidates[0].score,
        lexicalCoverage && lexicalCoverage.candidateCoverage === 1 && candidates[0].score < CONFIG.OFFICIAL_AUTO_SCORE
          ? `Tous les termes de « ${candidates[0].item.nom} » sont présents dans l'entrée ; score lexical ${candidates[0].score.toFixed(2)}`
          : `Score lexical ${candidates[0].score.toFixed(2)} et marge suffisante`
      )

      trace.events.push(
        `Match lexical automatique : ${candidates[0].item.nom} (${candidates[0].score.toFixed(2)})`
      )
    }

    refData.aiCache.set(
      key,
      candidates[0].item.id
    )

    return {
      id: candidates[0].item.id,
      name: candidates[0].item.nom,
      aiProposed: false,
    }
  }

  // ============================================================
  // 3. MÉMOIRE IA PERSISTANTE
  // ============================================================

  const previous =
    refData.aiResolutionMap.get(key)

  if (previous) {
    if (trace) {
      trace.ingredientAiCacheHit =
        true

      setIngredientDecision(trace, 'memory', previous.statut === 'valide' ? 1 : 0.9, `Décision mémorisée (${previous.statut})`)

      trace.events.push(
        `Mémoire IA utilisée : ${
          previous.proposition_ia ??
          'AUCUN'
        } (${previous.statut})`
      )
    }

    if (
      previous.statut ===
      'rejete'
    ) {
      // On continue.
    } else if (
      previous.ingredient_id_propose
    ) {
      const official =
        refData.officialById.get(
          previous.ingredient_id_propose
        )

      if (official) {
        refData.aiCache.set(
          key,
          official.id
        )

        return {
          id: official.id,
          name: official.nom,
          aiProposed:
            previous.statut !==
            'valide',
        }
      }
    } else if (
      previous.proposition_ia ===
      'AUCUN'
    ) {
      refData.aiCache.set(
        key,
        null
      )

      return {
        id: null,
        name: null,
        aiProposed: false,
      }
    }
  }

  // ============================================================
  // 4. CACHE INTRA-REQUÊTE
  // ============================================================

  if (
    refData.aiCache.has(key)
  ) {
    const cachedId =
      refData.aiCache.get(key) ??
      null

    const official =
      cachedId
        ? refData.officialById.get(
            cachedId
          )
        : null

    if (official) {
      if (trace) {
        trace.ingredient.source =
          'memory'

        trace.ingredientAiCacheHit =
          true

        trace.events.push(
          `Cache IA utilisé : ${official.nom}`
        )
      }

      return {
        id: official.id,
        name: official.nom,
        aiProposed: false,
      }
    }

    if (cachedId === null) {
      return {
        id: null,
        name: null,
        aiProposed: false,
      }
    }
  }

  // ============================================================
  // 6. CANDIDATS IA
  // ============================================================

  const aiCandidates =
    candidates.length
      ? candidates
      : refData.officialPrepared
          .map(o => ({
            ...o,
            score: textScore(
              rawName,
              o.item.nom,
              refData.ignoredSet
            ),
          }))
          .sort(
            (a, b) =>
              b.score - a.score
          )
          .slice(
            0,
            CONFIG.CANDIDATE_LIMIT
          )

  if (!aiCandidates.length) {
    await saveAiResolution(
      rawName,
      null,
      null
    )

    refData.aiResolutionMap.set(
      key,
      {
        mot_recette: rawName,
        proposition_ia: 'AUCUN',
        ingredient_id_propose:
          null,
        statut: 'en_attente',
        created_at:
          new Date().toISOString(),
      }
    )

    refData.aiCache.set(
      key,
      null
    )

    if (trace) {
      trace.ingredient.source =
        'unresolved'

      trace.events.push(
        'Référentiel officiel vide : impossible de consulter Claude'
      )
    }

    return {
      id: null,
      name: null,
      aiProposed: false,
    }
  }

  // ============================================================
  // 7. CLAUDE
  // ============================================================

  if (trace) {
    trace.ingredientAiCalled =
      true

    trace.claudeCalls += 1

    trace.events.push(
      'Claude appelé pour résoudre l’ingrédient'
    )
  }

  const ai =
    await resolveOfficialIngredientWithClaude(
      rawName,
      aiCandidates.map(c => ({
        id: c.item.id,
        label: c.item.nom,
        lexicalScore: c.score,
      }))
    )

  if (trace) {
    trace.ingredientAiConfidence =
      ai.confidence ?? null

    setIngredientDecision(trace, 'ai', ai.confidence ?? null, ai.reason || 'Décision Claude')

    trace.events.push(
      `Claude a proposé : ${
        ai.matched ??
        'aucune correspondance'
      }`
    )
  }

  const selected =
    ai.matched
      ? refData.officialById.get(
          ai.matched
        )
      : null

  await saveAiResolution(
    rawName,
    selected?.nom ?? null,
    selected?.id ?? null
  )

  refData.aiResolutionMap.set(
    key,
    {
      mot_recette: rawName,
      proposition_ia:
        selected?.nom ?? 'AUCUN',
      ingredient_id_propose:
        selected?.id ?? null,
      statut: 'en_attente',
      created_at:
        new Date().toISOString(),
    }
  )

  refData.aiCache.set(
    key,
    selected?.id ?? null
  )

  return selected
    ? {
        id: selected.id,
        name: selected.nom,
        aiProposed: true,
      }
    : {
        id: null,
        name: null,
        aiProposed: false,
      }
}

export function resolveIngredientDeterministic(
  rawName: string,
  refData: ReferenceData
): {
  id: string | null
  name: string | null
  source: 'ignored' | 'synonym' | 'exact' | 'lexical' | 'unresolved'
  score: number | null
} {
  const key = cleanText(rawName)

  if (!key || refData.ignoredSet.has(key)) {
    return { id: null, name: null, source: 'ignored', score: null }
  }

  const synonymId = refData.synonymMap.get(key)
  if (synonymId) {
    const official = refData.officialById.get(synonymId)
    if (official) {
      return { id: official.id, name: official.nom, source: 'synonym', score: 1 }
    }
  }

  const normalizedRaw = cleanText(rawName, refData.ignoredSet)
  const exact = refData.officialPrepared.find(o => o.normalized === normalizedRaw)
  if (exact) {
    return { id: exact.item.id, name: exact.item.nom, source: 'exact', score: 1 }
  }

  const candidates = refData.officialPrepared
    .map(o => ({
      ...o,
      score: textScore(rawName, o.item.nom, refData.ignoredSet),
    }))
    .filter(o => o.score >= CONFIG.MIN_CANDIDATE_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, CONFIG.CANDIDATE_LIMIT)

  const winner = candidates[0]
  if (winner) {
    const coverage = tokenCoverage(normalizedRaw, winner.item.nom, refData.ignoredSet)
    const deterministic = bestIsSafe(
      candidates,
      CONFIG.OFFICIAL_AUTO_SCORE,
      CONFIG.OFFICIAL_AUTO_MARGIN
    ) || Boolean(
      coverage.candidateCoverage === 1 &&
      coverage.common.length > 0 &&
      winner.score >= 0.55 &&
      (candidates.length === 1 || winner.score - candidates[1].score >= 0.05)
    )

    if (deterministic) {
      return {
        id: winner.item.id,
        name: winner.item.nom,
        source: 'lexical',
        score: winner.score,
      }
    }
  }

  return { id: null, name: null, source: 'unresolved', score: winner?.score ?? null }
}

export async function resolveIngredientDecision(
  rawName: string,
  refData?: ReferenceData
): Promise<{
  id: string | null
  name: string | null
  aiProposed: boolean
  decision: MatcherDecision
  candidates: Array<{ id: string; name: string; score: number }>
}> {
  const data = refData ?? await loadReferenceData()
  const trace = createMatcherTrace(rawName)
  const result = await resolveOfficialIngredient(rawName, data, trace)
  const decision: MatcherDecision = {
    kind: 'ingredient',
    source: (trace.ingredientDecision?.source ?? trace.ingredient.source) as MatcherDecision['source'],
    confidence: trace.ingredientDecision?.confidence ?? trace.ingredientAiConfidence ?? null,
    reason: trace.ingredientDecision?.reason ?? 'Décision du moteur',
  }
  return {
    ...result,
    decision,
    candidates: trace.ingredientCandidates ?? [],
  }
}

export interface ResolvedIngredient {
  produit: string
  ingredient_id: string | null
  qte: number
  unite: string
  quantity_mode: QuantityMode
  needs_review: boolean
  source_recipe_id?: string
  source_recipe_nom?: string
}

export async function resolveRecipeIngredients(
  recipeIngredients: RecipeIngredient[],
  refData: ReferenceData,
  recipeId: string,
  recipeNom: string,
  servingsRatio = 1,
  trace?: MatcherTrace
): Promise<ResolvedIngredient[]> {
  const resolved: ResolvedIngredient[] = []

  for (const ing of recipeIngredients) {
    const rawName =
      cleanText(ing.name)

    if (
      !rawName ||
      refData.ignoredSet.has(
        rawName
      )
    ) {
      continue
    }

    const official =
      await resolveOfficialIngredient(
        ing.name,
        refData,
        trace
      )

    const ingredientId =
      official.id

    const standardProduct =
      official.name ?? ing.name

    const officialIngredient = ingredientId
      ? refData.officialById.get(ingredientId) ?? null
      : null

    const quantityMode = getQuantityMode({
      nom: officialIngredient?.nom ?? standardProduct,
      categorie: officialIngredient?.categorie ?? null,
    })

    // Les épices/assaisonnements sont des besoins de présence :
    // on ne conserve ni quantité ni unité de recette pour le moteur de calcul.
    if (quantityMode === 'presence') {
      resolved.push({
        produit: standardProduct,
        ingredient_id: ingredientId,
        qte: 1,
        unite: officialIngredient?.unite_reference ?? 'Pièce',
        quantity_mode: 'presence',
        needs_review: official.aiProposed || !ingredientId,
        source_recipe_id: recipeId,
        source_recipe_nom: recipeNom,
      })
      continue
    }

    let requiredQty =
      Number(ing.qty) *
      servingsRatio

    let requiredUnit =
      normalizeUnitKey(
        ing.unit
      )

    let unitResolved = false

    if (ingredientId) {
      const density =
        findDensity(
          refData,
          ingredientId,
          ing.unit
        )

      if (density) {
        const densityUnit =
          canonicalUnit(
            refData,
            density.unite
          )

        const gramsPerDensityUnit =
          Number(
            density.poids_g_approx
          )

        if (
          densityUnit?.type ===
            'volume' &&
          Number.isFinite(
            gramsPerDensityUnit
          ) &&
          gramsPerDensityUnit > 0
        ) {
          const inputUnit =
            canonicalUnit(
              refData,
              ing.unit
            )

          if (
            inputUnit?.type ===
            'volume'
          ) {
            const quantityInDensityUnits =
              requiredQty *
              inputUnit.factor /
              densityUnit.factor

            requiredQty =
              quantityInDensityUnits *
              gramsPerDensityUnit

            requiredUnit = 'g'
            unitResolved = true
          }
        }
      }
    }

    if (!unitResolved) {
      const mapping =
        canonicalUnit(
          refData,
          ing.unit
        )

      if (mapping) {
        requiredQty *=
          mapping.factor

        requiredUnit =
          mapping.unit

        unitResolved = true
      }
    }

    resolved.push({
      produit:
        standardProduct,

      ingredient_id:
        ingredientId,

      qte:
        requiredQty,

      unite:
        requiredUnit,

      quantity_mode: 'quantity',

      needs_review:
        official.aiProposed ||
        !unitResolved ||
        !ingredientId,

      source_recipe_id:
        recipeId,

      source_recipe_nom:
        recipeNom,
    })
  }

  return resolved
}

export interface AggregatedRequirement {
  produit: string
  ingredient_id: string | null
  qte: number
  unite: string
  quantity_mode: QuantityMode
  needs_review: boolean
  contributions: {
    recipe_id: string
    recipe_nom: string
    qte_contribuee: number
  }[]
}

export function aggregateRequirements(
  resolvedLists: ResolvedIngredient[][]
): AggregatedRequirement[] {
  const map =
    new Map<
      string,
      AggregatedRequirement
    >()

  for (const list of resolvedLists) {
    for (const item of list) {

      const key =
        `${item.ingredient_id ?? cleanText(item.produit)}::${item.quantity_mode}`

      const existing =
        map.get(key)

      const contribution = {
        recipe_id:
          item.source_recipe_id ?? '',

        recipe_nom:
          item.source_recipe_nom ?? '',

        qte_contribuee:
          item.qte,
      }

      if (existing) {
        existing.qte +=
          item.qte

        existing.needs_review ||=
          item.needs_review

        existing.contributions.push(
          contribution
        )
      } else {
        map.set(
          key,
          {
            produit:
              item.produit,

            ingredient_id:
              item.ingredient_id,

            qte:
              item.qte,

            unite:
              item.unite,

            quantity_mode:
              item.quantity_mode,

            needs_review:
              item.needs_review,

            contributions: [
              contribution,
            ],
          }
        )
      }
    }
  }

  return Array.from(
    map.values()
  )
}

interface PreparedStock {
  item: StockItem
  normalized: string
  tokens: string[]
}

interface MemoryRow {
  ingredient_key: string
  stock_item_id: string
  source:
    | 'ai'
    | 'human'
    | 'text'
    | 'exact'
  confidence: number
  validated: boolean
  reason: string | null
}

async function loadStockMemory(
  keys: string[]
) {
  const unique = [
    ...new Set(
      keys.filter(Boolean)
    ),
  ]

  if (!unique.length) {
    return {
      memory:
        new Map<
          string,
          MemoryRow[]
        >(),

      exclusions:
        new Set<string>(),
    }
  }

  const [
    memoryResult,
    exclusionResult,
  ] = await Promise.all([
    mealioServerDb
      .from('matcher_memory')
      .select(
        'ingredient_key, stock_item_id, source, confidence, validated, reason'
      )
      .in(
        'ingredient_key',
        unique
      ),

    mealioServerDb
      .from('matcher_exclusions')
      .select(
        'ingredient_key, stock_item_id'
      )
      .in(
        'ingredient_key',
        unique
      ),
  ])

  if (memoryResult.error) {
    console.error(
      'matcher_memory:',
      memoryResult.error.message
    )
  }

  if (exclusionResult.error) {
    console.error(
      'matcher_exclusions:',
      exclusionResult.error.message
    )
  }

  const memory =
    new Map<
      string,
      MemoryRow[]
    >()

  for (const row of
    (memoryResult.data ??
      []) as MemoryRow[]
  ) {
    const list =
      memory.get(
        row.ingredient_key
      ) ?? []

    list.push(row)

    memory.set(
      row.ingredient_key,
      list
    )
  }

  for (const list of
    memory.values()
  ) {
    list.sort(
      (a, b) =>
        Number(b.validated) -
          Number(a.validated) ||
        Number(b.confidence) -
          Number(a.confidence)
    )
  }

  const exclusions =
    new Set<string>()

  for (const row of
    exclusionResult.data ??
    []) {
    exclusions.add(
      `${row.ingredient_key}::${row.stock_item_id}`
    )
  }

  return {
    memory,
    exclusions,
  }
}

async function saveStockMemory(
  ingredientKey: string,
  stockItem: StockItem,
  source:
    | 'ai'
    | 'human'
    | 'text'
    | 'exact',
  confidence: number,
  reason: string,
  validated: boolean
) {
  const stockItemId =
    String(stockItem.id)

  const now =
    new Date().toISOString()

  const existing =
    await mealioServerDb
      .from('matcher_memory')
      .select(
        'id, usage_count'
      )
      .eq(
        'ingredient_key',
        ingredientKey
      )
      .eq(
        'stock_item_id',
        stockItemId
      )
      .order(
        'updated_at',
        {
          ascending: false,
        }
      )
      .limit(1)
      .maybeSingle()

  if (existing.error) {
    console.error(
      'matcher_memory lookup:',
      existing.error.message
    )

    return
  }

  if (existing.data?.id) {
    const { error } =
      await mealioServerDb
        .from('matcher_memory')
        .update({
          source,
          confidence,
          validated,
          reason,
          usage_count:
            Number(
              existing.data
                .usage_count ??
                0
            ) + 1,
          updated_at: now,
        })
        .eq(
          'id',
          existing.data.id
        )

    if (error) {
      console.error(
        'matcher_memory update:',
        error.message
      )
    }

    return
  }

  const { error } =
    await mealioServerDb
      .from('matcher_memory')
      .insert({
        ingredient_key:
          ingredientKey,

        stock_item_id:
          stockItemId,

        source,

        confidence,

        validated,

        reason,

        usage_count: 1,

        updated_at: now,
      })

  if (error) {
    console.error(
      'matcher_memory insert:',
      error.message
    )
  }
}

export async function validateMatcherDecision(
  ingredientName: string,
  stockItem: StockItem,
  reason = 'Validation utilisateur'
) {
  const key =
    cleanText(
      ingredientName
    )

  if (
    !key ||
    !stockItem.id
  ) {
    return
  }

  await saveStockMemory(
    key,
    stockItem,
    'human',
    1,
    reason,
    true
  )

  await mealioServerDb
    .from('matcher_exclusions')
    .delete()
    .eq(
      'ingredient_key',
      key
    )
    .eq(
      'stock_item_id',
      String(stockItem.id)
    )
}

export async function rejectMatcherDecision(
  ingredientName: string,
  stockItem: StockItem,
  reason = 'Refus utilisateur'
) {
  const key =
    cleanText(
      ingredientName
    )

  const stockItemId =
    String(
      stockItem.id ?? ''
    )

  if (
    !key ||
    !stockItemId
  ) {
    return
  }

  const existing =
    await mealioServerDb
      .from('matcher_exclusions')
      .select('id')
      .eq(
        'ingredient_key',
        key
      )
      .eq(
        'stock_item_id',
        stockItemId
      )
      .limit(1)
      .maybeSingle()

  if (existing.error) {
    console.error(
      'matcher_exclusions lookup:',
      existing.error.message
    )

    return
  }

  if (existing.data?.id) {
    const { error } =
      await mealioServerDb
        .from('matcher_exclusions')
        .update({
          reason,
        })
        .eq(
          'id',
          existing.data.id
        )

    if (error) {
      console.error(
        'matcher_exclusions update:',
        error.message
      )
    }

    return
  }

  const { error } =
    await mealioServerDb
      .from('matcher_exclusions')
      .insert({
        ingredient_key:
          key,

        stock_item_id:
          stockItemId,

        reason,
      })

  if (error) {
    console.error(
      'matcher_exclusions insert:',
      error.message
    )
  }
}

export async function forgetMatcherDecision(
  ingredientName: string,
  stockItem: StockItem
) {
  const key =
    cleanText(
      ingredientName
    )

  if (
    !key ||
    !stockItem.id
  ) {
    return
  }

  await Promise.all([
    mealioServerDb
      .from('matcher_memory')
      .delete()
      .eq(
        'ingredient_key',
        key
      )
      .eq(
        'stock_item_id',
        String(
          stockItem.id
        )
      ),

    mealioServerDb
      .from('matcher_exclusions')
      .delete()
      .eq(
        'ingredient_key',
        key
      )
      .eq(
        'stock_item_id',
        String(
          stockItem.id
        )
      ),
  ])
}

/**
 * V3.5
 *
 * Trouve toutes les lignes de stock correspondant à un besoin.
 *
 * POINT IMPORTANT :
 * une correspondance n'est jamais limitée à une seule ligne.
 *
 * Exemple :
 *
 *   Frosti :
 *     tomate 500 g
 *     tomate 300 g
 *
 *   Cellio :
 *     tomate 400 g
 *
 *   Besoin :
 *     tomate 1 kg
 *
 * => matchedItems contient les 3 lignes.
 *
 * compareToStock() convertira ensuite chaque ligne puis
 * additionnera les quantités.
 */
async function matchOneRequirement(
  item: AggregatedRequirement,
  preparedStock: PreparedStock[],
  memory: Map<string, MemoryRow[]>,
  exclusions: Set<string>,
  stopWords: Set<string>,
  refData: ReferenceData,
  trace?: MatcherTrace,
  persistMemory = true
): Promise<{
  matchedItems: StockItem[]
  needsReview: boolean
  reviewReason?: string | null
}> {

  const key =
    cleanText(
      item.produit,
      stopWords
    )

  if (!key) {
    return {
      matchedItems: [],
      needsReview:
        item.needs_review,
    }
  }

  // Ingrédient officiel déjà résolu à l'étape précédente.
  // Cette valeur est utilisée uniquement pour la garde sémantique
  // du rapprochement stock.
  const officialIngredient =
    item.ingredient_id
      ? refData.officialById.get(item.ingredient_id) ?? null
      : null

  // ============================================================
  // 1. MÉMOIRE PERSISTANTE
  // ============================================================

  const remembered =
    memory.get(key) ?? []

  if (
    remembered.length &&
    trace
  ) {
    trace.stock.memoryHit =
      true

    trace.stock.source =
      'memory'

    trace.events.push(
      `Mémoire stock trouvée : ${remembered.length} rapprochement(s)`
    )
  }

  /*
   * V3.5 :
   *
   * On ne retourne plus immédiatement la première ligne trouvée
   * dans la mémoire.
   *
   * On identifie d'abord les lignes mémorisées réellement présentes
   * dans le stock actuel.
   */

  const rememberedStockIds =
    new Set<string>()

  for (const row of
    remembered
  ) {
    const found =
      preparedStock.find(
        p =>
          p.item.id ===
          row.stock_item_id
      )

    if (!found) {
      continue
    }

    if (
      exclusions.has(
        `${key}::${row.stock_item_id}`
      )
    ) {
      continue
    }

    rememberedStockIds.add(
      found.item.id
    )

    if (trace) {
      trace.stock.source =
        'memory'

      trace.stockDecision = {
        kind: 'stock',
        source: 'memory',
        confidence: Number(row.confidence),
        reason: `Rapprochement stock mémorisé (${row.source})`,
      }

      trace.events.push(
        `Mémoire stock utilisée : ${found.item.produit} (${row.source}, confiance ${Number(row.confidence).toFixed(2)})`
      )
    }
  }

  /*
   * Si une ou plusieurs lignes sont mémorisées, on récupère
   * TOUS les stocks portant le ou les mêmes libellés normalisés.
   *
   * Cela est important lorsque plusieurs lignes existent :
   *
   *   Frosti : tomates 500 g
   *   Frosti : tomates 1 kg
   *   Cellio : tomates 250 g
   *
   * Une seule mémoire ne doit pas masquer les autres lignes.
   */

  if (
    rememberedStockIds.size >
    0
  ) {
    const rememberedNormalized =
      new Set(
        preparedStock
          .filter(p =>
            rememberedStockIds.has(
              p.item.id
            )
          )
          .map(
            p =>
              p.normalized
          )
      )

    const rememberedPrepared =
      preparedStock.filter(
        p =>
          rememberedNormalized.has(
            p.normalized
          ) &&
          !exclusions.has(
            `${key}::${p.item.id}`
          )
      )

    if (
      rememberedPrepared.length
    ) {
      const needsMemoryReview =
        remembered.some(
          row =>
            rememberedStockIds.has(
              row.stock_item_id
            ) &&
            !row.validated &&
            Number(
              row.confidence
            ) < 0.9
        )

      if (
        trace &&
        rememberedPrepared.length >
          1
      ) {
        trace.events.push(
          `Plusieurs lignes stock récupérées via mémoire : ${rememberedPrepared.length}`
        )
      }

      return {
        matchedItems:
          rememberedPrepared.map(
            p => p.item
          ),

        needsReview:
          item.needs_review ||
          needsMemoryReview,
      }
    }
  }

  // ============================================================
  // 2. CORRESPONDANCE EXACTE
  // ============================================================

  const exact =
    preparedStock.filter(
      p =>
        p.normalized === key &&
        !exclusions.has(
          `${key}::${p.item.id}`
        )
    )

  if (exact.length) {

    if (trace) {
      trace.stock.source =
        'exact'

      trace.stockDecision = {
        kind: 'stock',
        source: 'exact',
        confidence: 1,
        reason: 'Libellé stock identique après normalisation',
      }

      trace.events.push(
        `Correspondance stock exacte : ${exact.length} ligne(s)`
      )

      if (exact.length > 1) {
        trace.events.push(
          `Plusieurs lignes de stock identiques regroupées : ${exact.length}`
        )
      }
    }

    /*
     * Chaque ligne est mémorisée individuellement.
     */

    for (const prepared of
      exact
    ) {
      if (!persistMemory) continue

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
      matchedItems:
        exact.map(
          p => p.item
        ),

      needsReview:
        item.needs_review,
    }
  }

  // ============================================================
  // 3. SCORE LEXICAL
  // ============================================================

  const candidates =
    preparedStock
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
          p.score >=
            CONFIG.MIN_CANDIDATE_SCORE &&
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

  if (trace) {
    trace.stockCandidates = candidates.map(c => ({
      id: c.item.id,
      name: c.item.produit,
      score: Number(c.score.toFixed(4)),
      source: c.item.source,
    }))
  }

  // ============================================================
  // 4. CANDIDATS CLAUDE
  // ============================================================

  const aiCandidates =
    candidates.length
      ? candidates
      : preparedStock
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

  // ============================================================
  // 4. MATCH LEXICAL SÛR
  // ============================================================

  /*
   * Un candidat lexical très sûr reste prioritaire.
   * La garde sémantique ne doit pas bloquer un rapprochement
   * déterministe déjà suffisamment fort.
   */

  if (
    bestIsSafe(
      candidates,
      CONFIG.STOCK_AUTO_SCORE,
      CONFIG.STOCK_AUTO_MARGIN
    )
  ) {

    const selected =
      candidates[0]

    if (trace) {
      trace.stock.source =
        'lexical'

      trace.stockDecision = {
        kind: 'stock',
        source: 'lexical',
        confidence: selected.score,
        reason: `Score lexical ${selected.score.toFixed(2)} avec marge suffisante`,
      }

      trace.events.push(
        `Match stock lexical automatique : ${selected.item.produit} (${selected.score.toFixed(2)})`
      )
    }

    const matchingItems =
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
        )

    for (const stockItem of
      matchingItems
    ) {
      if (!persistMemory) continue

      await saveStockMemory(
        key,
        stockItem,
        'text',
        selected.score,
        `Match automatique : score ${selected.score.toFixed(2)}`,
        true
      )
    }

    if (
      trace &&
      matchingItems.length >
        1
    ) {
      trace.events.push(
        `Plusieurs lignes stock retenues après match lexical : ${matchingItems.length}`
      )
    }

    return {
      matchedItems:
        matchingItems,

      needsReview:
        item.needs_review,
    }
  }

  // ============================================================
  // 5. GARDE SÉMANTIQUE AVANT CLAUDE
  // ============================================================

  /*
   * Phase 23.2 : la garde ne se contente plus de chercher
   * n'importe quel mot commun.
   *
   * Elle utilise :
   *   - le nom officiel de l'ingrédient ;
   *   - ses synonymes connus dans ingredient_synonyms ;
   *   - une liste de termes de préparation/état non discriminants
   *     (ex. "haché", "frais", "tranché").
   *
   * Exemple :
   *   Steak haché ↔ Épinards hachés
   *
   * Le seul terme commun est "haché". Il n'est pas discriminant,
   * donc Claude n'est même pas appelé.
   *
   * En revanche :
   *   Gambas ↔ Crevettes roses
   *
   * peut être accepté si "crevette" est enregistré comme synonyme
   * de Gambas.
   */

  const semanticStockCandidates =
    officialIngredient
      ? (() => {
          /*
           * Important : un synonyme peut n'avoir AUCUN recouvrement
           * lexical avec le libellé de la recette.
           *
           * Exemple :
           *   besoin = Gambas
           *   stock   = Crevettes roses
           *
           * "Crevettes roses" peut donc être absent des 5 meilleurs
           * candidats lexicaux. On élargit ici le pool UNIQUEMENT pour
           * rechercher les équivalences sémantiques connues du référentiel.
           * Ce pool élargi n'est jamais envoyé tel quel à Claude : seuls
           * les candidats validés par hasSemanticStockEvidence le sont.
           */
          const semanticPool = preparedStock
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
                !exclusions.has(
                  `${key}::${p.item.id}`
                )
            )

          return semanticPool.filter(candidate => {
            const evidence =
              hasSemanticStockEvidence(
                item.ingredient_id,
                candidate.item.produit,
                refData,
                stopWords
              )

            if (evidence.matched && trace && evidence.label) {
              trace.events.push(
                `Candidat stock sémantiquement compatible : ${candidate.item.produit} via « ${evidence.label} »${
                  evidence.common?.length
                    ? ` (${evidence.common.join(', ')})`
                    : ''
                }`
              )
            }

            return evidence.matched
          })
            .sort((a, b) => b.score - a.score)
            .slice(0, CONFIG.CANDIDATE_LIMIT)
        })()
      : aiCandidates

  if (!semanticStockCandidates.length) {
    if (trace) {
      trace.stock.source = 'none'
      trace.stockDecision = {
        kind: 'stock',
        source: 'none',
        confidence: 0,
        reason: officialIngredient
          ? `Aucun candidat stock sémantiquement compatible avec l'ingrédient officiel « ${officialIngredient.nom} »`
          : 'Aucun candidat stock suffisamment pertinent avant Claude',
      }
      trace.events.push(
        officialIngredient
          ? `Claude non appelé : candidats stock incompatibles avec ${officialIngredient.nom}`
          : 'Claude non appelé : aucun candidat stock suffisamment pertinent'
      )
    }

    return {
      matchedItems: [],
      needsReview: item.needs_review,
    }
  }

  // ============================================================
  // 5. MATCH DÉTERMINISTE SÉMANTIQUE / LEXICAL SÛR
  // ============================================================

  // Si le référentiel apporte une preuve sémantique explicite (synonyme
  // connu), celle-ci est plus forte qu'un score lexical faible. Cela permet
  // par exemple : Gambas -> Crevette -> Crevettes roses, sans appeler Claude.
  // Une seule équivalence sémantique validée est donc déterministe.
  const semanticDeterministic =
    officialIngredient &&
    semanticStockCandidates.length === 1
      ? semanticStockCandidates[0]
      : null

  if (semanticDeterministic) {
    const selected = semanticDeterministic

    if (trace) {
      trace.stock.source = 'memory'
      trace.stockDecision = {
        kind: 'stock',
        source: 'memory',
        confidence: Math.max(selected.score, 0.9),
        reason: `Équivalence sémantique déterministe via le référentiel : ${selected.item.produit}`,
      }
      trace.events.push(
        `Match stock sémantique automatique : ${selected.item.produit} (référentiel)`
      )
    }

    const matchingItems =
      preparedStock
        .filter(
          p =>
            p.normalized === selected.normalized &&
            !exclusions.has(`${key}::${p.item.id}`)
        )
        .map(p => p.item)

    for (const stockItem of matchingItems) {
      await saveStockMemory(
        key,
        stockItem,
        'text',
        Math.max(selected.score, 0.9),
        `Équivalence sémantique déterministe via le référentiel`,
        true
      )
    }

    return {
      matchedItems: matchingItems,
      needsReview: item.needs_review,
    }
  }

  // Sinon, on conserve le garde-fou lexical historique.
  if (
    bestIsSafe(
      candidates,
      CONFIG.STOCK_AUTO_SCORE,
      CONFIG.STOCK_AUTO_MARGIN
    )
  ) {

    const selected =
      candidates[0]

    if (trace) {
      trace.stock.source =
        'lexical'

      trace.stockDecision = {
        kind: 'stock',
        source: 'lexical',
        confidence: selected.score,
        reason: `Score lexical ${selected.score.toFixed(2)} avec marge suffisante`,
      }

      trace.events.push(
        `Match stock lexical automatique : ${selected.item.produit} (${selected.score.toFixed(2)})`
      )
    }

    /*
     * V3.5 :
     *
     * Claude/lexical sélectionne un libellé.
     * Nous récupérons ensuite TOUTES les lignes ayant ce même
     * libellé normalisé.
     */

    const matchingItems =
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
        )

    for (const stockItem of
      matchingItems
    ) {
      if (!persistMemory) continue

      await saveStockMemory(
        key,
        stockItem,
        'text',
        selected.score,
        `Match automatique : score ${selected.score.toFixed(2)}`,
        true
      )
    }

    if (
      trace &&
      matchingItems.length >
        1
    ) {
      trace.events.push(
        `Plusieurs lignes stock retenues après match lexical : ${matchingItems.length}`
      )
    }

    return {
      matchedItems:
        matchingItems,

      needsReview:
        item.needs_review,
    }
  }

  // ============================================================
  // 6. CLAUDE — MATCH AMBIGU
  // ============================================================

  if (trace) {
    trace.stock.aiCalled =
      true

    trace.stock.source =
      'ai'

    trace.claudeCalls += 1

    trace.events.push(
      'Claude appelé pour le rapprochement stock'
    )
  }

  const ai =
    await matchStockWithClaude(
      item.produit,
      semanticStockCandidates.map(c => ({
        id: c.item.id,
        label: c.item.produit,
        lexicalScore:
          c.score,
        metadata: {
          source:
            c.item.source,
        },
      }))
    )

  if (trace) {
    trace.stock.aiConfidence =
      ai.confidence ?? null

    trace.stockDecision = {
      kind: 'stock',
      source: 'ai',
      confidence: ai.confidence ?? null,
      reason: ai.reason || 'Décision Claude',
    }

    trace.events.push(
      `Claude : ${
        ai.matched
          ? 'match trouvé'
          : 'aucun match'
      } — confiance ${Number(
        ai.confidence ?? 0
      ).toFixed(2)}`
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
      c =>
        c.item.id ===
        ai.matched
    )

  if (!selected) {
    return {
      matchedItems: [],
      needsReview: true,
    }
  }

  // ============================================================
  // 7. APPRENTISSAGE
  // ============================================================

  if (
    persistMemory &&
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

  // ============================================================
  // 8. V3.5 — TOUTES LES LIGNES DU PRODUIT
  // ============================================================

  /*
   * Claude sélectionne potentiellement UNE ligne.
   *
   * Exemple :
   *
   *   ID 101 : tomates fraîches — 500 g
   *   ID 102 : tomates fraîches — 1 kg
   *   ID 103 : tomates fraîches — 250 g
   *
   * Claude → ID 101
   *
   * V3.4 aurait pu ne retourner que ID 101.
   *
   * V3.5 récupère les trois lignes.
   */

  const matchingItems =
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
      )

  if (
    trace &&
    matchingItems.length > 1
  ) {
    trace.events.push(
      `Plusieurs lignes stock retenues après match IA : ${matchingItems.length}`
    )
  }

  return {
    matchedItems:
      matchingItems,

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

function getUnitMapping(
  refData: ReferenceData,
  unit: string
) {
  return findUnitMapping(
    refData,
    unit
  )
}

function canonicalUnit(
  refData: ReferenceData,
  unit: string
): {
  /**
   * Unité canonique. Pour les unités discrètes, on conserve l'identité
   * de l'unité normalisée (piece, tranche, gousse, sachet, paquet, ...).
   * Elles ne doivent jamais être fusionnées artificiellement en "pièce".
   */
  unit: string
  factor: number
  type:
    | 'poids'
    | 'volume'
    | 'unité'
} | null {

  const cleaned =
    normalizeUnitKey(unit)

  if (cleaned === 'mg') {
    return {
      unit: 'g',
      factor: 0.001,
      type: 'poids',
    }
  }

  if (cleaned === 'g') {
    return {
      unit: 'g',
      factor: 1,
      type: 'poids',
    }
  }

  if (cleaned === 'kg') {
    return {
      unit: 'g',
      factor: 1000,
      type: 'poids',
    }
  }

  if (cleaned === 'ml') {
    return {
      unit: 'mL',
      factor: 1,
      type: 'volume',
    }
  }

  if (cleaned === 'cl') {
    return {
      unit: 'mL',
      factor: 10,
      type: 'volume',
    }
  }

  if (cleaned === 'dl') {
    return {
      unit: 'mL',
      factor: 100,
      type: 'volume',
    }
  }

  if (cleaned === 'l') {
    return {
      unit: 'mL',
      factor: 1000,
      type: 'volume',
    }
  }

  if (cleaned === 'piece') {
    return {
      unit: 'piece',
      factor: 1,
      type: 'unité',
    }
  }

  const mapping =
    getUnitMapping(
      refData,
      unit
    )

  if (!mapping) return null

  const type =
    mapping.type_unite as
      | 'poids'
      | 'volume'
      | 'unité'
      | null

  if (!type) return null

  let factor =
    parseReferenceFactor(
      mapping.equivalence_reference,
      type
    )

  if (factor === 1) {
    const configured =
      Number(
        mapping.multiplicateur ??
          1
      )

    if (
      Number.isFinite(
        configured
      ) &&
      configured > 0
    ) {
      factor = configured
    }
  }

  if (type === 'poids') {
    return {
      unit: 'g',
      factor,
      type,
    }
  }

  if (type === 'volume') {
    return {
      unit: 'mL',
      factor,
      type,
    }
  }

  if (type === 'unité') {
    return {
      // IMPORTANT : on conserve l'identité de l'unité discrète.
      // Exemple : 1 tranche n'est pas 1 pièce, sauf équivalence
      // explicite fournie par le référentiel de densité/conversion.
      unit: cleaned,
      factor: 1,
      type,
    }
  }

  return null
}

/**
 * Convertit une quantité de stock vers l'unité canonique du besoin.
 *
 * Règles :
 * - poids -> g
 * - volume -> mL
 * - unités discrètes : identité conservée
 * - unités discrètes <-> poids uniquement avec une masse explicite
 *   dans ingredient_densities
 * - volume <-> volume uniquement si les deux unités ont une densité explicite ;
 * - volume <-> poids uniquement avec la densité explicite de l'unité concernée ;
 * - aucune conversion transitive ou densité générique par famille.
 */
export function resolveStockIngredientId(
  refData: ReferenceData,
  stockProduct: string | null | undefined
): string | null {
  if (!stockProduct) return null

  const normalized = cleanText(stockProduct)
  if (!normalized) return null

  const exact = refData.officialList.find(
    ingredient => cleanText(ingredient.nom) === normalized
  )
  if (exact) return exact.id

  for (const [synonym, ingredientId] of refData.synonymMap.entries()) {
    if (cleanText(synonym) === normalized) {
      return ingredientId
    }
  }

  return null
}

export function convertStockQuantity(
  refData: ReferenceData,
  ingredientId: string | null,
  qty: number,
  fromUnit: string,
  targetUnit: string
): ConvertedStock | null {

  if (!Number.isFinite(qty)) {
    return null
  }

  const from =
    canonicalUnit(
      refData,
      fromUnit
    )

  const target =
    canonicalUnit(
      refData,
      targetUnit
    )

  // Sécurité : lorsque les unités brutes sont réellement la même
  // unité discrète (ex. "Pièce" / "Pièce"), on ne dépend pas du
  // mapping de référence pour pouvoir comparer les quantités.
  const normalizedFromUnit = normalizeUnitKey(fromUnit)
  const normalizedTargetUnit = normalizeUnitKey(targetUnit)

  if (
    normalizedFromUnit &&
    normalizedFromUnit === normalizedTargetUnit &&
    ['piece', 'tranche', 'gousse', 'sachet', 'paquet', 'boite', 'bouteille', 'pot', 'barquette'].includes(normalizedFromUnit)
  ) {
    return {
      qty,
      unit: normalizedTargetUnit,
      converted: cleanText(fromUnit) !== cleanText(targetUnit),
      reason: cleanText(fromUnit) === cleanText(targetUnit)
        ? 'Même unité'
        : `${fromUnit} → ${targetUnit}`,
    }
  }

  if (!from || !target) {
    return null
  }

  // ============================================================
  // MÊME UNITÉ
  // ============================================================
  // Pour poids/volume, les unités sont volontairement ramenées à
  // g/mL. Pour les unités discrètes, l'identité est conservée :
  // tranche != pièce != gousse != sachet != paquet.

  if (
    from.type === target.type &&
    from.unit === target.unit
  ) {
    return {
      qty:
        qty *
        from.factor /
        target.factor,

      unit:
        target.unit,

      converted:
        cleanText(fromUnit) !==
        cleanText(targetUnit),

      reason:
        cleanText(fromUnit) ===
        cleanText(targetUnit)
          ? 'Même unité'
          : `${fromUnit} → ${targetUnit}`,
    }
  }

  // ============================================================
  // UNITÉ -> POIDS (pièce, tranche, gousse, sachet, ...)
  // ============================================================
  // Une unité discrète n'est convertie en poids QUE si le référentiel
  // contient une masse approximative explicite pour cet ingrédient
  // et cette unité. On n'invente donc jamais une masse par défaut.

  if (
    from.type === 'unité' &&
    target.type === 'poids' &&
    ingredientId
  ) {
    const density =
      findDensity(
        refData,
        ingredientId,
        fromUnit
      ) ??
      findDensity(
        refData,
        ingredientId,
        from.unit
      )

    const gramsPerUnit =
      density
        ? Number(density.poids_g_approx)
        : NaN

    if (
      density &&
      Number.isFinite(gramsPerUnit) &&
      gramsPerUnit > 0
    ) {
      const quantityInUnits =
        qty * from.factor

      return {
        qty: quantityInUnits * gramsPerUnit / target.factor,
        unit: target.unit,
        converted: true,
        reason: `${fromUnit} → ${targetUnit} via équivalence poids/unité`,
      }
    }
  }

  // ============================================================
  // POIDS -> UNITÉ (pièce, tranche, gousse, sachet, ...)
  // ============================================================
  // Même règle dans l'autre sens : seulement si une masse moyenne
  // explicite existe dans le référentiel.

  if (
    from.type === 'poids' &&
    target.type === 'unité' &&
    ingredientId
  ) {
    const density =
      findDensity(
        refData,
        ingredientId,
        targetUnit
      ) ??
      findDensity(
        refData,
        ingredientId,
        target.unit
      )

    const gramsPerUnit =
      density
        ? Number(density.poids_g_approx)
        : NaN

    if (
      density &&
      Number.isFinite(gramsPerUnit) &&
      gramsPerUnit > 0
    ) {
      const grams =
        qty * from.factor

      return {
        qty: grams / gramsPerUnit,
        unit: target.unit,
        converted: true,
        reason: `${fromUnit} → ${targetUnit} via équivalence poids/unité`,
      }
    }
  }

  // ============================================================
  // VOLUME -> VOLUME VIA DEUX DENSITÉS EXPLICITES
  // ============================================================
  // Une conversion culinaire entre deux unités de volume (ex. cc <-> cs)
  // n'est autorisée que si les DEUX unités sont explicitement renseignées
  // dans ingredient_densities pour cet ingrédient.
  // Aucune conversion transitive ou générique n'est inventée.
  if (
    from.type === 'volume' &&
    target.type === 'volume' &&
    ingredientId
  ) {
    const fromDensity =
      findDensity(refData, ingredientId, fromUnit) ??
      findDensity(refData, ingredientId, from.unit)
    const targetDensity =
      findDensity(refData, ingredientId, targetUnit) ??
      findDensity(refData, ingredientId, target.unit)

    if (fromDensity && targetDensity) {
      const fromWeight = Number(fromDensity.poids_g_approx)
      const targetWeight = Number(targetDensity.poids_g_approx)

      if (
        Number.isFinite(fromWeight) && fromWeight > 0 &&
        Number.isFinite(targetWeight) && targetWeight > 0
      ) {
        const qtyInFromDensityUnits = qty * from.factor / canonicalUnit(refData, fromDensity.unite)!.factor
        const grams = qtyInFromDensityUnits * fromWeight
        const targetDensityUnit = canonicalUnit(refData, targetDensity.unite)

        if (targetDensityUnit) {
          const targetDensityUnits = grams / targetWeight
          return {
            qty: targetDensityUnits * targetDensityUnit.factor / target.factor,
            unit: target.unit,
            converted: true,
            reason: `${fromUnit} → ${targetUnit} via densités explicites`,
          }
        }
      }
    }
  }

  // ============================================================
  // VOLUME -> POIDS
  // ============================================================

  if (
    from.type === 'volume' &&
    target.type === 'poids' &&
    ingredientId
  ) {

    const density =
      findDensity(
        refData,
        ingredientId,
        fromUnit
      ) ??
      findDensity(
        refData,
        ingredientId,
        from.unit
      )

    if (!density) {
      return null
    }

    const densityUnit =
      canonicalUnit(
        refData,
        density.unite
      )

    const gramsPerDensityUnit =
      Number(
        density.poids_g_approx
      )

    if (
      !densityUnit ||
      densityUnit.type !==
        'volume' ||
      !Number.isFinite(
        gramsPerDensityUnit
      ) ||
      gramsPerDensityUnit <=
        0
    ) {
      return null
    }

    const qtyMl =
      qty * from.factor

    const densityUnits =
      qtyMl /
      densityUnit.factor

    const grams =
      densityUnits *
      gramsPerDensityUnit

    if (!Number.isFinite(grams)) {
      return null
    }

    return {
      qty: grams,
      unit: 'g',
      converted: true,
      reason:
        `${fromUnit} → g via densité`,
    }
  }

  // ============================================================
  // POIDS -> VOLUME
  // ============================================================

  if (
    from.type === 'poids' &&
    target.type === 'volume' &&
    ingredientId
  ) {

    const density =
      findDensity(
        refData,
        ingredientId,
        targetUnit
      ) ??
      findDensity(
        refData,
        ingredientId,
        target.unit
      )

    if (!density) {
      return null
    }

    const densityUnit =
      canonicalUnit(
        refData,
        density.unite
      )

    const gramsPerDensityUnit =
      Number(
        density.poids_g_approx
      )

    if (
      !densityUnit ||
      densityUnit.type !==
        'volume' ||
      !Number.isFinite(
        gramsPerDensityUnit
      ) ||
      gramsPerDensityUnit <=
        0
    ) {
      return null
    }

    const grams =
      qty * from.factor

    const densityUnits =
      grams /
      gramsPerDensityUnit

    const targetVolumeMl =
      densityUnits *
      densityUnit.factor

    return {
      qty:
        targetVolumeMl /
        target.factor,

      unit:
        target.unit,

      converted: true,

      reason:
        `${fromUnit} → ${targetUnit} via densité`,
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

export interface ComparedRequirement
  extends AggregatedRequirement {
  qte_a_acheter: number
  ai_status:
    | 'green'
    | 'orange'
    | 'red'
  qte_stock?: number
  stock_details?: StockComparisonDetail[]
  stock_match_review?: string | null
}

export interface MatcherComparisonTestContext {
  /**
   * Optional deterministic test seam. Production callers omit this object
   * and therefore keep the existing database-backed behavior unchanged.
   */
  stopWords?: Set<string>
  memory?: Map<string, MemoryRow[]>
  exclusions?: Set<string>
  persistMemory?: boolean
}

export async function compareToStock(
  aggregated: AggregatedRequirement[],
  globalStock: StockItem[],
  refData: ReferenceData,
  trace?: MatcherTrace,
  testContext?: MatcherComparisonTestContext
): Promise<ComparedRequirement[]> {

  const stopWords =
    testContext?.stopWords ??
    await loadMatcherStopWords()

  /*
   * Chaque ligne de Frosti/Cellio est préparée séparément.
   *
   * IMPORTANT :
   * aucun regroupement n'est fait ici.
   *
   * Cela permet de conserver les IDs et les quantités de chaque ligne.
   */

  const preparedStock =
    globalStock.map(item => ({
      item,

      normalized:
        cleanText(
          item.produit,
          stopWords
        ),

      tokens:
        tokens(
          item.produit,
          stopWords
        ),
    }))

  const keys =
    aggregated.map(
      item =>
        cleanText(
          item.produit,
          stopWords
        )
    )

  const loadedContext =
    testContext?.memory && testContext?.exclusions
      ? {
          memory: testContext.memory,
          exclusions: testContext.exclusions,
        }
      : await loadStockMemory(keys)

  const {
    memory,
    exclusions,
  } = loadedContext

  const results:
    ComparedRequirement[] = []

  for (const item of
    aggregated
  ) {

    const match =
      await matchOneRequirement(
        item,
        preparedStock,
        memory,
        exclusions,
        stopWords,
        refData,
        trace,
        testContext?.persistMemory ?? true
      )

    let totalStockQty = 0

    let hasUnitMismatch =
      false

    const stockDetails:
      StockComparisonDetail[] =
        []

    // Pour les épices/assaisonnements, la présence du produit suffit.
    // Aucune conversion ni comparaison de quantité n'est effectuée.
    if (item.quantity_mode === 'presence') {
      const present = match.matchedItems.length > 0
      const stockMatchReview = match.reviewReason ?? null

      if (present) {
        totalStockQty = 1
        for (const stock of match.matchedItems) {
          stockDetails.push({
            produit: stock.produit,
            qte_stock: Number(stock.qte || 0),
            unite_stock: stock.unite,
            qte_convertie: 1,
            unite_comparee: 'Présence',
            conversion: null,
          })
        }
      }

      results.push({
        ...item,
        qte_a_acheter: present ? 0 : 1,
        ai_status: present ? 'green' : (match.needsReview ? 'orange' : 'red'),
        needs_review: item.needs_review || match.needsReview,
        qte_stock: totalStockQty,
        stock_details: stockDetails,
        stock_match_review: stockMatchReview,
      })
      continue
    }

    /*
     * V3.5 :
     *
     * Chaque ligne de stock est convertie individuellement.
     *
     * Puis les quantités converties sont additionnées.
     */

    for (const stock of
      match.matchedItems
    ) {

      // Pour une ligne issue d'un rapprochement sémantique
      // (ex. Gambas ← Crevette), la densité/équivalence peut être
      // attachée à l'ingrédient officiel du STOCK et non à celui du BESOIN.
      // On essaie donc d'abord l'identifiant stock, puis celui du besoin.
      const stockIngredientId =
        stock.ingredient_id ??
        resolveStockIngredientId(
          refData,
          stock.produit
        )

      const ingredientIdsToTry =
        Array.from(
          new Set(
            [
              stockIngredientId,
              item.ingredient_id ?? null,
            ].filter(
              (id): id is string =>
                Boolean(id)
            )
          )
        )

      let converted: ConvertedStock | null = null

      for (const ingredientId of
        ingredientIdsToTry
      ) {
        converted =
          convertStockQuantity(
            refData,
            ingredientId,
            Number(
              stock.qte || 0
            ),
            stock.unite,
            item.unite
          )

        if (converted) {
          break
        }
      }

      // Les anciennes lignes de stock sans ingredient_id continuent
      // d'utiliser l'identifiant de l'ingrédient demandé.
      if (!converted) {
        converted =
          convertStockQuantity(
            refData,
            item.ingredient_id,
            Number(
              stock.qte || 0
            ),
            stock.unite,
            item.unite
          )
      }

      if (!converted) {

        hasUnitMismatch =
          true

        stockDetails.push({
          produit:
            stock.produit,

          qte_stock:
            Number(
              stock.qte || 0
            ),

          unite_stock:
            stock.unite,

          qte_convertie:
            null,

          unite_comparee:
            item.unite,

          conversion:
            null,
        })

        continue
      }

      totalStockQty +=
        converted.qty

      stockDetails.push({
        produit:
          stock.produit,

        qte_stock:
          Number(
            stock.qte || 0
          ),

        unite_stock:
          stock.unite,

        qte_convertie:
          converted.qty,

        unite_comparee:
          converted.unit,

        conversion:
          converted.converted
            ? converted.reason
            : null,
      })
    }

    const qte_a_acheter =
      Math.max(
        0,
        item.qte -
          totalStockQty
      )

    let stockMatchReview =
      match.reviewReason ?? null

    if (
      hasUnitMismatch &&
      !stockMatchReview &&
      qte_a_acheter > 0
    ) {
      stockMatchReview =
        `Mealio a trouvé du stock pour « ${item.produit} », mais une partie de ce stock ne peut pas être convertie en ${item.unite}. Seule la quantité convertible est prise en compte dans le calcul des courses.`
    }

    let ai_status:
      | 'green'
      | 'orange'
      | 'red' =
      'red'

    if (
      totalStockQty >=
      item.qte
    ) {
      ai_status =
        'green'
    } else if (
      totalStockQty > 0
    ) {
      ai_status =
        'orange'
    } else if (
      hasUnitMismatch ||
      match.needsReview
    ) {
      ai_status =
        'orange'
    }

    if (
      trace &&
      stockDetails.length
    ) {

      trace.events.push(
        `Stock quantifié : ${totalStockQty.toFixed(2)} ${item.unite} disponible(s) pour ${item.qte} ${item.unite}`
      )

      if (
        stockDetails.length >
        1
      ) {
        trace.events.push(
          `Quantité calculée à partir de ${stockDetails.length} lignes de stock`
        )
      }

      if (
        hasUnitMismatch
      ) {
        trace.events.push(
          'Une partie du stock n’a pas pu être convertie dans l’unité du besoin'
        )
      }
    }

    results.push({
      ...item,

      qte_a_acheter,

      ai_status,

      needs_review:
        item.needs_review ||
        match.needsReview,

      qte_stock:
        totalStockQty,

      stock_details:
        stockDetails,

      stock_match_review:
        stockMatchReview,
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
  recipe: {
    id: string
    nom: string
    baseServings: number
    servings: number
  }

  resolved:
    ResolvedIngredient[]

  aggregated:
    AggregatedRequirement[]

  compared:
    ComparedRequirement[]
}

/**
 * Orchestration backend V3.5 :
 *
 * recette
 *   ↓
 * résolution ingrédient
 *   ↓
 * conversion unité recette
 *   ↓
 * agrégation
 *   ↓
 * rapprochement Frosti + Cellio
 *   ↓
 * récupération de toutes les lignes correspondantes
 *   ↓
 * conversion ligne par ligne
 *   ↓
 * addition des stocks
 *   ↓
 * quantité à acheter
 */
export async function analyzeRecipe(
  recipe: RecipeAnalysisInput,
  globalStock: StockItem[],
  refData?: ReferenceData,
  trace?: MatcherTrace,
  testContext?: MatcherComparisonTestContext
): Promise<RecipeAnalysisResult> {

  const data =
    refData ??
    await loadReferenceData()

  const servings =
    Number(
      recipe.servings ??
        recipe.baseServings
    )

  const base =
    Number(
      recipe.baseServings
    ) > 0
      ? Number(
          recipe.baseServings
        )
      : 4

  const ratio =
    Number.isFinite(
      servings
    ) &&
    servings > 0
      ? servings / base
      : 1

  const resolved =
    await resolveRecipeIngredients(
      recipe.ingredients,
      data,
      recipe.id,
      recipe.nom,
      ratio,
      trace
    )

  const aggregated =
    aggregateRequirements([
      resolved,
    ])

  const compared =
    await compareToStock(
      aggregated,
      globalStock,
      data,
      trace,
      testContext
    )

  return {
    recipe: {
      id: recipe.id,
      nom: recipe.nom,
      baseServings: base,
      servings:
        Number.isFinite(
          servings
        ) &&
        servings > 0
          ? servings
          : base,
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
  trace?: MatcherTrace,
  testContext?: MatcherComparisonTestContext
): Promise<{
  recipes: RecipeAnalysisResult[]
  aggregated: AggregatedRequirement[]
  compared: ComparedRequirement[]
}> {

  const data =
    refData ??
    await loadReferenceData()

  const results:
    RecipeAnalysisResult[] =
    []

  const resolvedLists:
    ResolvedIngredient[][] =
    []

  for (const recipe of
    recipes
  ) {

    const servings =
      Number(
        recipe.servings ??
          recipe.baseServings
      )

    const base =
      Number(
        recipe.baseServings
      ) > 0
        ? Number(
            recipe.baseServings
          )
        : 4

    const ratio =
      Number.isFinite(
        servings
      ) &&
      servings > 0
        ? servings / base
        : 1

    const resolved =
      await resolveRecipeIngredients(
        recipe.ingredients,
        data,
        recipe.id,
        recipe.nom,
        ratio,
        trace
      )

    resolvedLists.push(
      resolved
    )

    results.push({
      recipe: {
        id: recipe.id,
        nom: recipe.nom,
        baseServings: base,
        servings:
          Number.isFinite(
            servings
          ) &&
          servings > 0
            ? servings
            : base,
      },

      resolved,

      aggregated:
        aggregateRequirements([
          resolved,
        ]),

      compared: [],
    })
  }

  const aggregated =
    aggregateRequirements(
      resolvedLists
    )

  const compared =
    await compareToStock(
      aggregated,
      globalStock,
      data,
      trace,
      testContext
    )

  return {
    recipes: results,
    aggregated,
    compared,
  }
}

export async function loadMatcherStopWords(): Promise<
  Set<string>
> {

  const {
    data,
    error,
  } =
    await mealioServerDb
      .from('ignored_words')
      .select('mot')

  const set =
    new Set(BASE_STOP_WORDS)

  if (error) {
    console.error(
      'ignored_words:',
      error.message
    )
  }

  for (const row of
    data ?? []
  ) {

    const value =
      cleanText(
        String(
          row.mot ?? ''
        ),
        BASE_STOP_WORDS
      )

    if (value) {
      set.add(value)
    }
  }

  return set
}