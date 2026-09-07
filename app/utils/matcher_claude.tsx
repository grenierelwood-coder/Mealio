import { mealioDb } from '../lib/supabase'

// ============================================================================
// MATCHER RECETTE ↔ STOCK — V3
//
// Objectifs :
//   - meilleure correspondance possible
//   - minimum d'appels IA
//   - mémoire persistante
//   - apprentissage des validations humaines
//   - conservation des rapprochements déjà validés
//
// Pipeline :
//
//   1. normalisation
//   2. mémoire humaine
//   3. exclusions connues
//   4. correspondance exacte
//   5. moteur lexical avancé
//   6. décision automatique si score + marge suffisants
//   7. Claude uniquement si ambigu
//   8. mémorisation de la décision
//
// L'IA ne décide JAMAIS des quantités.
// ============================================================================


// ============================================================================
// TYPES
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

  source:
    | 'memory'
    | 'human'
    | 'exact'
    | 'text'
    | 'ai'
    | 'none'

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

interface MatcherExclusionRow {
  ingredient_key: string
  stock_item_id: string
  reason?: string | null
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


// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Nombre de candidats envoyés à Claude.
  AI_CANDIDATE_LIMIT: 5,

  // Sous ce score, on considère généralement qu'il n'y a
  // pas suffisamment de matière pour appeler l'IA.
  MIN_CANDIDATE_SCORE: 0.22,

  // Match automatique si le meilleur candidat atteint ce score.
  AUTO_MATCH_SCORE: 0.93,

  // Différence minimale entre le meilleur et le deuxième.
  AUTO_MATCH_MARGIN: 0.08,

  // Une décision IA en dessous de ce niveau n'est pas mémorisée
  // comme vérité forte.
  AI_LEARNING_THRESHOLD: 0.85,

  // Une validation humaine est toujours prioritaire.
  HUMAN_CONFIDENCE: 1,

  // Nombre maximal de résultats conservés dans les candidats.
  CANDIDATE_LIMIT: 5,
}


// ============================================================================
// 1. MOTS IGNORÉS
// ============================================================================

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

let dynamicStopWords: Set<string> | null = null


export async function loadMatcherStopWords(): Promise<Set<string>> {
  if (dynamicStopWords) {
    return dynamicStopWords
  }

  const { data, error } = await mealioDb
    .from('ignored_words')
    .select('mot')

  dynamicStopWords = new Set(BASE_STOP_WORDS)

  if (error) {
    console.error(
      'Erreur chargement ignored_words :',
      error
    )

    return dynamicStopWords
  }

  for (const row of data ?? []) {
    const cleaned = cleanMatcherText(
      String(row.mot ?? ''),
      BASE_STOP_WORDS
    )

    if (cleaned) {
      dynamicStopWords.add(cleaned)
    }
  }

  return dynamicStopWords
}


// ============================================================================
// 2. SINGULARISATION PRUDENTE
// ============================================================================

const SINGULAR_EXCEPTIONS = new Set([
  'riz',
  'mais',
  'pois',
  'jus',
  'os',
  'frais',
  'frais',
])

function singularizeWord(word: string): string {
  if (!word || word.length <= 3) {
    return word
  }

  if (SINGULAR_EXCEPTIONS.has(word)) {
    return word
  }

  // œufs -> œuf
  if (word.endsWith('ufs')) {
    return word.slice(0, -1)
  }

  // tomates, carottes, courgettes...
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

  // pommes, bananes...
  if (word.endsWith('es')) {
    return word.slice(0, -1)
  }

  // Règle générale très prudente.
  if (
    word.endsWith('s') &&
    !word.endsWith('ss') &&
    word.length >= 5
  ) {
    return word.slice(0, -1)
  }

  return word
}


// ============================================================================
// 3. NORMALISATION
// ============================================================================

export function cleanMatcherText(
  text: string,
  stopWords?: Set<string>
): string {
  if (!text) {
    return ''
  }

  const ignored =
    stopWords ?? BASE_STOP_WORDS

  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()[\],.;:/\\'"!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(singularizeWord)
    .filter(word => !ignored.has(word))
    .join(' ')
}


// ============================================================================
// 4. TOKENISATION
// ============================================================================

function tokenize(
  text: string,
  stopWords: Set<string>
): string[] {
  return cleanMatcherText(
    text,
    stopWords
  )
    .split(' ')
    .filter(Boolean)
}


// ============================================================================
// 5. MOTS DISCRIMINANTS
//
// Ces mots ne doivent surtout pas être traités comme de simples mots.
//
// Exemple :
//
//   tomate rouge
//   tomate verte
//
// ou :
//
//   lait
//   lait coco
//
// ou :
//
//   fromage chèvre
//   fromage brebis
// ============================================================================

const DISCRIMINANT_GROUPS: string[][] = [
  [
    'rouge',
    'vert',
    'verte',
    'jaune',
    'orange',
  ],

  [
    'cerise',
    'grappe',
    'concasse',
    'conserve',
    'seche',
    'sechees',
  ],

  [
    'coco',
    'amande',
    'noisette',
    'noix',
    'soja',
    'avoine',
    'riz',
  ],

  [
    'chevre',
    'brebis',
    'vache',
    'bufflonne',
  ],

  [
    'doux',
    'sale',
    'fume',
    'epice',
    'fort',
  ],

  [
    'liquide',
    'solide',
    'poudre',
  ],
]

const discriminantGroupByToken =
  new Map<string, number>()

DISCRIMINANT_GROUPS.forEach(
  (group, index) => {
    group.forEach(token => {
      discriminantGroupByToken.set(
        token,
        index
      )
    })
  }
)


// ============================================================================
// 6. DISTANCE TEXTUELLE
// ============================================================================

function levenshtein(
  a: string,
  b: string
): number {
  if (a === b) {
    return 0
  }

  if (!a.length) {
    return b.length
  }

  if (!b.length) {
    return a.length
  }

  const previous = Array.from(
    { length: b.length + 1 },
    (_, i) => i
  )

  for (let i = 0; i < a.length; i++) {
    const current = [i + 1]

    for (let j = 0; j < b.length; j++) {
      const cost =
        a[i] === b[j] ? 0 : 1

      current.push(
        Math.min(
          current[j] + 1,
          previous[j + 1] + 1,
          previous[j] + cost
        )
      )
    }

    for (
      let j = 0;
      j < current.length;
      j++
    ) {
      previous[j] = current[j]
    }
  }

  return previous[b.length]
}


function stringSimilarity(
  a: string,
  b: string
): number {
  if (!a || !b) {
    return 0
  }

  if (a === b) {
    return 1
  }

  const distance =
    levenshtein(a, b)

  const maxLength =
    Math.max(a.length, b.length)

  if (!maxLength) {
    return 1
  }

  return Math.max(
    0,
    1 - distance / maxLength
  )
}


// ============================================================================
// 7. PÉNALITÉ DES CONTRADICTIONS
// ============================================================================

function calculateDiscriminantPenalty(
  ingredientTokens: string[],
  productTokens: string[]
): number {
  const ingredientGroups = new Set<number>()

  for (const token of ingredientTokens) {
    const group =
      discriminantGroupByToken.get(token)

    if (group !== undefined) {
      ingredientGroups.add(group)
    }
  }

  if (!ingredientGroups.size) {
    return 0
  }

  for (const token of productTokens) {
    const productGroup =
      discriminantGroupByToken.get(token)

    if (
      productGroup !== undefined &&
      ingredientGroups.has(productGroup) &&
      !ingredientTokens.includes(token)
    ) {
      return 0.18
    }
  }

  return 0
}


// ============================================================================
// 8. SCORE AVANCÉ
// ============================================================================

function calculateTextScoreFromNormalized(
  ingredient: string,
  ingredientTokens: string[],
  product: string,
  productTokens: string[]
): number {
  if (!ingredient || !product) {
    return 0
  }

  // --------------------------------------------------------------------------
  // Exact
  // --------------------------------------------------------------------------

  if (ingredient === product) {
    return 1
  }

  // --------------------------------------------------------------------------
  // Inclusion complète
  // --------------------------------------------------------------------------

  if (product === ingredient) {
    return 1
  }

  // --------------------------------------------------------------------------
  // Tokens communs
  // --------------------------------------------------------------------------

  const productTokenSet =
    new Set(productTokens)

  const commonTokens =
    ingredientTokens.filter(
      token =>
        productTokenSet.has(token)
    )

  const coverageIngredient =
    commonTokens.length /
    Math.max(ingredientTokens.length, 1)

  const coverageProduct =
    commonTokens.length /
    Math.max(productTokens.length, 1)

  // --------------------------------------------------------------------------
  // Similarité globale
  // --------------------------------------------------------------------------

  const globalSimilarity =
    stringSimilarity(
      ingredient,
      product
    )

  // --------------------------------------------------------------------------
  // Bonus si tous les tokens importants
  // sont présents dans le produit.
  // --------------------------------------------------------------------------

  const fullIngredientCoverage =
    coverageIngredient === 1

  // --------------------------------------------------------------------------
  // Pénalité des contradictions.
  // --------------------------------------------------------------------------

  const contradictionPenalty =
    calculateDiscriminantPenalty(
      ingredientTokens,
      productTokens
    )

  // --------------------------------------------------------------------------
  // Score final.
  //
  // La couverture de l'ingrédient est volontairement dominante :
  // si l'ingrédient demandé est "tomate cerise",
  // le produit doit contenir tomate ET cerise.
  // --------------------------------------------------------------------------

  let score =
    coverageIngredient * 0.55 +
    coverageProduct * 0.20 +
    globalSimilarity * 0.25

  if (fullIngredientCoverage) {
    score += 0.04
  }

  score -= contradictionPenalty

  return Math.min(
    0.97,
    Math.max(0, score)
  )
}


// ============================================================================
// 9. PRÉPARATION DU STOCK
//
// On normalise chaque produit UNE SEULE FOIS.
//
// V2 recalculait cleanMatcherText() pour chaque comparaison.
// Avec un gros stock, cela devient inutilement coûteux.
// ============================================================================

function prepareStock(
  stock: MatcherStockItem[],
  stopWords: Set<string>
): PreparedStockItem[] {
  return stock.map(stockItem => {
    const normalized =
      cleanMatcherText(
        stockItem.produit,
        stopWords
      )

    return {
      stockItem,
      normalized,
      tokens: tokenize(
        normalized,
        stopWords
      ),
    }
  })
}


// ============================================================================
// 10. CHARGEMENT DU STOCK
// ============================================================================

export async function loadGlobalStock(): Promise<
  MatcherStockItem[]
> {
  const { data, error } =
    await mealioDb
      .from('stock_items')
      .select(
        'id, produit, qte, unite, source, ingredient_id'
      )

  if (error) {
    console.error(
      'Erreur récupération stock :',
      error
    )

    return []
  }

  return data ?? []
}


// ============================================================================
// 11. RECHERCHE DES CANDIDATS
// ============================================================================

export function findTextCandidates(
  ingredientName: string,
  preparedStock: PreparedStockItem[],
  stopWords: Set<string>,
  limit: number = CONFIG.CANDIDATE_LIMIT
): MatchCandidate[] {
  const ingredient =
    cleanMatcherText(
      ingredientName,
      stopWords
    )

  const ingredientTokens =
    tokenize(
      ingredient,
      stopWords
    )

  if (!ingredient || !ingredientTokens.length) {
    return []
  }

  return preparedStock
    .map(item => {
      const lexicalScore =
        calculateTextScoreFromNormalized(
          ingredient,
          ingredientTokens,
          item.normalized,
          item.tokens
        )

      return {
        stockItem: item.stockItem,
        lexicalScore,
        score: lexicalScore,
      }
    })
    .filter(
      candidate =>
        candidate.lexicalScore >=
        CONFIG.MIN_CANDIDATE_SCORE
    )
    .sort(
      (a, b) =>
        b.lexicalScore -
        a.lexicalScore
    )
    .slice(0, limit)
}


// ============================================================================
// 12. CHARGEMENT DE LA MÉMOIRE
//
// IMPORTANT :
// Pour une liste de 30 ingrédients, on fait UNE requête Supabase,
// pas 30 requêtes.
// ============================================================================

async function loadMatcherMemory(
  ingredientKeys: string[]
): Promise<{
  memory: Map<string, MatcherMemoryRow[]>
  exclusions: Set<string>
}> {
  const memory =
    new Map<string, MatcherMemoryRow[]>()

  const exclusions =
    new Set<string>()

  const uniqueKeys =
    [...new Set(
      ingredientKeys.filter(Boolean)
    )]

  if (!uniqueKeys.length) {
    return {
      memory,
      exclusions,
    }
  }

  const [
    memoryResult,
    exclusionResult,
  ] = await Promise.all([
    mealioDb
      .from('matcher_memory')
      .select('*')
      .in(
        'ingredient_key',
        uniqueKeys
      ),

    mealioDb
      .from('matcher_exclusions')
      .select(
        'ingredient_key, stock_item_id'
      )
      .in(
        'ingredient_key',
        uniqueKeys
      ),
  ])

  if (memoryResult.error) {
    console.error(
      'Erreur chargement matcher_memory :',
      memoryResult.error
    )
  }

  if (exclusionResult.error) {
    console.error(
      'Erreur chargement matcher_exclusions :',
      exclusionResult.error
    )
  }

  for (
    const row of
    memoryResult.data ?? []
  ) {
    const list =
      memory.get(
        row.ingredient_key
      ) ?? []

    list.push(
      row as MatcherMemoryRow
    )

    memory.set(
      row.ingredient_key,
      list
    )
  }

  for (
    const row of
    exclusionResult.data ?? []
  ) {
    exclusions.add(
      `${row.ingredient_key}::${row.stock_item_id}`
    )
  }

  // Les validations humaines passent toujours avant les autres.
  for (const [key, rows] of memory) {
    rows.sort((a, b) => {
      if (
        a.validated !==
        b.validated
      ) {
        return a.validated ? -1 : 1
      }

      return (
        Number(b.confidence) -
        Number(a.confidence)
      )
    })

    memory.set(key, rows)
  }

  return {
    memory,
    exclusions,
  }
}


// ============================================================================
// 13. ENREGISTREMENT D'UNE CORRESPONDANCE
// ============================================================================

async function saveMatcherMemory(
  ingredientKey: string,
  stockItem: MatcherStockItem,
  source: 'ai' | 'human' | 'text' | 'exact',
  confidence: number,
  reason: string,
  validated: boolean
): Promise<void> {
  if (!stockItem.id) {
    // Impossible de mémoriser durablement sans identifiant du stock.
    return
  }

  const { error } =
    await mealioDb
      .from('matcher_memory')
      .upsert(
        {
          ingredient_key:
            ingredientKey,

          stock_item_id:
            String(stockItem.id),

          source,

          confidence,

          validated,

          reason,

          updated_at:
            new Date().toISOString(),
        },
        {
          onConflict:
            'ingredient_key,stock_item_id',
        }
      )

  if (error) {
    console.error(
      'Erreur sauvegarde matcher_memory :',
      error
    )
  }
}


// ============================================================================
// 14. APPRENTISSAGE HUMAIN
//
// À appeler lorsque l'utilisateur confirme ou corrige le résultat.
//
// Exemple :
//
// await validateMatcherDecision(
//   'tomates',
//   tomatoStockItem
// )
//
// La prochaine fois : ZERO appel IA.
// ============================================================================

export async function validateMatcherDecision(
  ingredientName: string,
  stockItem: MatcherStockItem,
  reason = 'Validation utilisateur'
): Promise<void> {
  const stopWords =
    await loadMatcherStopWords()

  const ingredientKey =
    cleanMatcherText(
      ingredientName,
      stopWords
    )

  if (
    !ingredientKey ||
    !stockItem.id
  ) {
    return
  }

  await saveMatcherMemory(
    ingredientKey,
    stockItem,
    'human',
    CONFIG.HUMAN_CONFIDENCE,
    reason,
    true
  )

  // Si l'utilisateur valide ce produit,
  // il faut supprimer une éventuelle exclusion précédente.
  await mealioDb
    .from('matcher_exclusions')
    .delete()
    .eq(
      'ingredient_key',
      ingredientKey
    )
    .eq(
      'stock_item_id',
      String(stockItem.id)
    )
}


// ============================================================================
// 15. APPRENDRE QU'UN PRODUIT EST INCORRECT
// ============================================================================

export async function rejectMatcherDecision(
  ingredientName: string,
  stockItem: MatcherStockItem,
  reason = 'Refus utilisateur'
): Promise<void> {
  const stopWords =
    await loadMatcherStopWords()

  const ingredientKey =
    cleanMatcherText(
      ingredientName,
      stopWords
    )

  if (
    !ingredientKey ||
    !stockItem.id
  ) {
    return
  }

  await mealioDb
    .from('matcher_exclusions')
    .upsert(
      {
        ingredient_key:
          ingredientKey,

        stock_item_id:
          String(stockItem.id),

        reason,
      },
      {
        onConflict:
          'ingredient_key,stock_item_id',
      }
    )
}


// ============================================================================
// 16. OUBLIER UNE CORRESPONDANCE APPRISE
// ============================================================================

export async function forgetMatcherDecision(
  ingredientName: string,
  stockItem: MatcherStockItem
): Promise<void> {
  const stopWords =
    await loadMatcherStopWords()

  const ingredientKey =
    cleanMatcherText(
      ingredientName,
      stopWords
    )

  if (
    !ingredientKey ||
    !stockItem.id
  ) {
    return
  }

  await mealioDb
    .from('matcher_memory')
    .delete()
    .eq(
      'ingredient_key',
      ingredientKey
    )
    .eq(
      'stock_item_id',
      String(stockItem.id)
    )

  await mealioDb
    .from('matcher_exclusions')
    .delete()
    .eq(
      'ingredient_key',
      ingredientKey
    )
    .eq(
      'stock_item_id',
      String(stockItem.id)
    )
}


// ============================================================================
// 17. CLAUDE
// ============================================================================

async function askClaudeToMatch(
  ingredientName: string,
  candidates: MatchCandidate[]
): Promise<{
  matchedProduct: string | null
  confidence: number
  reason: string
}> {
  const apiKey =
    process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return {
      matchedProduct: null,
      confidence: 0,
      reason:
        'Clé API absente',
    }
  }

  const candidateList =
    candidates
      .map(
        (candidate, index) =>
          JSON.stringify({
            rank: index + 1,
            product:
              candidate.stockItem.produit,
            lexical_score:
              Number(
                candidate.lexicalScore.toFixed(3)
              ),
          })
      )
      .join('\n')

  const prompt = `
Tu es un moteur de rapprochement d'ingrédients alimentaires.

Tu dois déterminer si l'ingrédient d'une recette correspond réellement
à un produit disponible dans le stock.

INGREDIENT :
${ingredientName}

CANDIDATS :
${candidateList}

RÈGLES :

1. Choisis uniquement un produit parmi les candidats.
2. Tu peux répondre AUCUN.
3. La marque et le conditionnement ne sont généralement pas importants.
4. Ne tiens jamais compte des quantités.
5. Ne fais aucune conversion d'unité.
6. Une différence de forme peut être acceptable si le produit reste réellement utilisable.
7. Deux produits de la même famille ne sont PAS automatiquement équivalents.
8. "lait" et "lait de coco" ne sont pas équivalents par défaut.
9. "tomate" et "tomate cerise" ne sont pas automatiquement équivalents.
10. Respecte les caractéristiques discriminantes :
    rouge ≠ vert
    chèvre ≠ brebis
    coco ≠ amande
11. En cas de doute important, réponds AUCUN.
12. Ne renvoie jamais un produit qui n'est pas dans la liste.

Réponds UNIQUEMENT avec :

{
  "match": "nom exact du produit ou AUCUN",
  "confidence": 0.00,
  "reason": "courte explication"
}
`

  try {
    const response =
      await fetch(
        'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            'x-api-key':
              apiKey,

            'anthropic-version':
              '2023-06-01',
          },

          body: JSON.stringify({
            model:
              'claude-haiku-4-5-20251001',

            max_tokens: 200,

            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          }),
        }
      )

    if (!response.ok) {
      console.error(
        'Erreur Claude :',
        response.status,
        await response.text()
      )

      return {
        matchedProduct: null,
        confidence: 0,
        reason:
          'Erreur API Claude',
      }
    }

    const data =
      await response.json()

    const textBlock =
      data?.content?.find(
        (block: any) =>
          block.type === 'text'
      )

    const answer =
      textBlock?.text?.trim()

    if (!answer) {
      return {
        matchedProduct: null,
        confidence: 0,
        reason:
          'Réponse vide',
      }
    }

    const jsonMatch =
      answer.match(
        /\{[\s\S]*\}/
      )

    if (!jsonMatch) {
      return {
        matchedProduct: null,
        confidence: 0,
        reason:
          'Réponse Claude non JSON',
      }
    }

    const parsed =
      JSON.parse(
        jsonMatch[0]
      )

    if (
      !parsed.match ||
      String(parsed.match)
        .toUpperCase() === 'AUCUN'
    ) {
      return {
        matchedProduct: null,
        confidence: 0,
        reason:
          String(
            parsed.reason ??
              'Aucun produit correspondant'
          ),
      }
    }

    return {
      matchedProduct:
        String(parsed.match),

      confidence:
        Math.max(
          0,
          Math.min(
            1,
            Number(
              parsed.confidence
            ) || 0
          )
        ),

      reason:
        String(
          parsed.reason ?? ''
        ),
    }

  } catch (error) {
    console.error(
      'Erreur matching Claude :',
      error
    )

    return {
      matchedProduct: null,
      confidence: 0,
      reason:
        'Exception lors de l’appel IA',
    }
  }
}


// ============================================================================
// 18. RECHERCHE DANS LA MÉMOIRE
// ============================================================================

function findMemoryMatch(
  ingredientKey: string,
  memoryRows: MatcherMemoryRow[],
  stockById: Map<string, MatcherStockItem>,
  exclusions: Set<string>
): {
  row: MatcherMemoryRow
  stockItem: MatcherStockItem
} | null {
  if (!memoryRows.length) {
    return null
  }

  for (const row of memoryRows) {
    const stockItem =
      stockById.get(
        String(row.stock_item_id)
      )

    if (!stockItem) {
      // Le produit n'est probablement plus dans le stock.
      continue
    }

    const exclusionKey =
      `${ingredientKey}::${row.stock_item_id}`

    if (
      exclusions.has(exclusionKey)
    ) {
      continue
    }

    return {
      row,
      stockItem,
    }
  }

  return null
}


// ============================================================================
// 19. MATCHER PRINCIPAL
// ============================================================================

export async function matchIngredientToStock(
  ingredientName: string,
  stock: MatcherStockItem[],
  context?: MatcherContext
): Promise<MatchResult> {
  const stopWords =
    context?.stopWords ??
    await loadMatcherStopWords()

  const preparedStock =
    context?.preparedStock ??
    prepareStock(
      stock,
      stopWords
    )

  const memory =
    context?.memory ??
    new Map<string, MatcherMemoryRow[]>()

  const exclusions =
    context?.exclusions ??
    new Set<string>()

  const ingredientKey =
    cleanMatcherText(
      ingredientName,
      stopWords
    )

  if (!ingredientKey) {
    return {
      matched: false,
      stockItem: null,
      confidence: 0,
      source: 'none',
      candidates: [],
      needs_review: false,
      reason:
        'Ingrédient vide après normalisation',
    }
  }

  const stockById =
    new Map<string, MatcherStockItem>()

  for (const item of stock) {
    if (item.id) {
      stockById.set(
        String(item.id),
        item
      )
    }
  }


  // ==========================================================================
  // ÉTAPE 1 — MÉMOIRE
  // ==========================================================================

  const memoryMatch =
    findMemoryMatch(
      ingredientKey,
      memory.get(
        ingredientKey
      ) ?? [],
      stockById,
      exclusions
    )

  if (memoryMatch) {
    return {
      matched: true,

      stockItem:
        memoryMatch.stockItem,

      confidence:
        Number(
          memoryMatch.row.confidence
        ),

      source:
        memoryMatch.row.validated
          ? 'human'
          : 'memory',

      candidates: [
        {
          stockItem:
            memoryMatch.stockItem,

          lexicalScore:
            Number(
              memoryMatch.row.confidence
            ),

          score:
            Number(
              memoryMatch.row.confidence
            ),

          reason:
            memoryMatch.row.reason ??
            'Correspondance apprise',
        },
      ],

      needs_review:
        !memoryMatch.row.validated &&
        Number(
          memoryMatch.row.confidence
        ) < 0.90,

      reason:
        memoryMatch.row.validated
          ? 'Correspondance validée par utilisateur'
          : 'Correspondance apprise',
    }
  }


  // ==========================================================================
  // ÉTAPE 2 — CORRESPONDANCE EXACTE
  // ==========================================================================

  const exactMatch =
    preparedStock.find(
      item =>
        item.normalized ===
        ingredientKey
    )

  if (exactMatch) {
    const result: MatchResult = {
      matched: true,

      stockItem:
        exactMatch.stockItem,

      confidence: 1,

      source: 'exact',

      candidates: [
        {
          stockItem:
            exactMatch.stockItem,

          lexicalScore: 1,
          score: 1,

          reason:
            'Correspondance exacte après normalisation',
        },
      ],

      needs_review: false,

      reason:
        'Correspondance exacte',
    }

    // On mémorise également l'exact.
    await saveMatcherMemory(
      ingredientKey,
      exactMatch.stockItem,
      'exact',
      1,
      'Correspondance exacte après normalisation',
      true
    )

    return result
  }


  // ==========================================================================
  // ÉTAPE 3 — CANDIDATS
  // ==========================================================================

  const candidates =
    findTextCandidates(
      ingredientName,
      preparedStock,
      stopWords,
      CONFIG.CANDIDATE_LIMIT
    )

  if (!candidates.length) {
    return {
      matched: false,
      stockItem: null,
      confidence: 0,
      source: 'none',
      candidates: [],
      needs_review: false,
      reason:
        'Aucun candidat suffisamment proche',
    }
  }


  // ==========================================================================
  // ÉTAPE 4 — MEILLEUR CANDIDAT + MARGE
  // ==========================================================================

  const best =
    candidates[0]

  const second =
    candidates[1]

  const margin =
    second
      ? best.lexicalScore -
        second.lexicalScore
      : best.lexicalScore

  // --------------------------------------------------------------------------
  // Si un candidat est excellent ET clairement devant :
  // PAS D'IA.
  // --------------------------------------------------------------------------

  if (
    best.lexicalScore >=
      CONFIG.AUTO_MATCH_SCORE &&
    margin >=
      CONFIG.AUTO_MATCH_MARGIN
  ) {
    const result: MatchResult = {
      matched: true,

      stockItem:
        best.stockItem,

      confidence:
        best.lexicalScore,

      source: 'text',

      candidates,

      needs_review: false,

      reason:
        `Match automatique : score ${best.lexicalScore.toFixed(2)}, marge ${margin.toFixed(2)}`,
    }

    await saveMatcherMemory(
      ingredientKey,
      best.stockItem,
      'text',
      best.lexicalScore,
      result.reason ?? '',
      true
    )

    return result
  }


  // ==========================================================================
  // ÉTAPE 5 — CLAUDE
  //
  // Seulement si :
  //   - il existe de vrais candidats
  //   - aucun n'est suffisamment sûr
  //   - ou les candidats sont trop proches.
  // ==========================================================================

  const aiResult =
    await askClaudeToMatch(
      ingredientName,
      candidates
    )

  if (
    aiResult.matchedProduct
  ) {
    const selected =
      candidates.find(
        candidate =>
          candidate.stockItem.produit ===
          aiResult.matchedProduct
      )

    if (selected) {
      selected.aiScore =
        aiResult.confidence

      selected.score =
        aiResult.confidence

      selected.reason =
        aiResult.reason

      const shouldLearn =
        aiResult.confidence >=
        CONFIG.AI_LEARNING_THRESHOLD

      if (shouldLearn) {
        await saveMatcherMemory(
          ingredientKey,
          selected.stockItem,
          'ai',
          aiResult.confidence,
          aiResult.reason,
          false
        )
      }

      return {
        matched: true,

        stockItem:
          selected.stockItem,

        confidence:
          aiResult.confidence,

        source: 'ai',

        candidates,

        needs_review:
          aiResult.confidence < 0.85,

        reason:
          aiResult.reason,
      }
    }
  }


  // ==========================================================================
  // ÉTAPE 6 — AUCUN MATCH
  // ==========================================================================

  return {
    matched: false,

    stockItem: null,

    confidence: 0,

    source: 'none',

    candidates,

    needs_review: true,

    reason:
      aiResult.reason ||
      'Aucun produit suffisamment fiable',
  }
}


// ============================================================================
// 20. MATCHING D'UNE LISTE
//
// IMPORTANT :
//
// Pour 30 ingrédients :
//
//   - 1 chargement stop words
//   - 1 préparation du stock
//   - 1 chargement mémoire
//   - 1 chargement exclusions
//   - puis uniquement les appels Claude réellement nécessaires.
//
// Et les ingrédients identiques sont traités une seule fois.
// ============================================================================

export async function matchIngredientsToStock(
  ingredients: string[],
  stock: MatcherStockItem[]
): Promise<
  Record<string, MatchResult>
> {
  const results:
    Record<string, MatchResult> = {}

  const stopWords =
    await loadMatcherStopWords()

  // --------------------------------------------------------------------------
  // Normalisation des ingrédients UNE SEULE FOIS.
  // --------------------------------------------------------------------------

  const uniqueIngredients =
    new Map<string, string>()

  for (const ingredient of ingredients) {
    const key =
      cleanMatcherText(
        ingredient,
        stopWords
      )

    if (
      key &&
      !uniqueIngredients.has(key)
    ) {
      uniqueIngredients.set(
        key,
        ingredient
      )
    }
  }

  // --------------------------------------------------------------------------
  // Préparation du stock UNE SEULE FOIS.
  // --------------------------------------------------------------------------

  const preparedStock =
    prepareStock(
      stock,
      stopWords
    )

  // --------------------------------------------------------------------------
  // Mémoire persistante chargée en UNE FOIS.
  // --------------------------------------------------------------------------

  const {
    memory,
    exclusions,
  } = await loadMatcherMemory(
    [...uniqueIngredients.keys()]
  )

  const context: MatcherContext = {
    stopWords,
    stock,
    preparedStock,
    memory,
    exclusions,
  }

  // --------------------------------------------------------------------------
  // Cache local.
  // --------------------------------------------------------------------------

  const localCache =
    new Map<
      string,
      MatchResult
    >()

  for (const ingredient of ingredients) {
    const key =
      cleanMatcherText(
        ingredient,
        stopWords
      )

    if (!key) {
      continue
    }

    if (
      localCache.has(key)
    ) {
      results[ingredient] =
        localCache.get(key)!

      continue
    }

    const result =
      await matchIngredientToStock(
        ingredient,
        stock,
        context
      )

    localCache.set(
      key,
      result
    )

    results[ingredient] =
      result
  }

  return results
}