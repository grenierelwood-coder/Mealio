import { mealioDb } from '../lib/supabase'

// ============================================================================
// MATCHER RECETTE ↔ STOCK — V2
//
// Objectif :
//   À partir d'un ingrédient provenant d'une recette,
//   trouver le produit correspondant réellement présent dans le stock.
//
// Pipeline :
//   1. normalisation
//   2. correspondance exacte
//   3. correspondance textuelle
//   4. sélection des meilleurs candidats
//   5. Claude uniquement si nécessaire
//
// L'IA ne décide JAMAIS des quantités.
// Elle décide uniquement si un produit du stock correspond à l'ingrédient.
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
    | 'exact'
    | 'text'
    | 'ai'
    | 'none'

  candidates: MatchCandidate[]

  needs_review: boolean
}


// ============================================================================
// 1. MOTS IGNORÉS
// ============================================================================
//
// Ils sont maintenant chargés depuis la table ignored_words.
//
// On conserve néanmoins quelques mots structurels indispensables au matcher.
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


/**
 * Charge les mots ignorés depuis Supabase.
 *
 * Exemple :
 *   ignored_words
 *
 *   mot
 *   ----
 *   bio
 *   frais
 *   fraîche
 *   entier
 *   liquide
 */
export async function loadMatcherStopWords(): Promise<Set<string>> {

  if (dynamicStopWords) {
    return dynamicStopWords
  }

  const { data, error } = await mealioDb
    .from('ignored_words')
    .select('mot')

  if (error) {
    console.error(
      'Erreur chargement ignored_words :',
      error
    )

    dynamicStopWords = new Set(BASE_STOP_WORDS)

    return dynamicStopWords
  }

  dynamicStopWords = new Set(BASE_STOP_WORDS)

  for (const row of data ?? []) {

    const cleaned =
      cleanMatcherText(row.mot)

    if (cleaned) {
      dynamicStopWords.add(cleaned)
    }
  }

  return dynamicStopWords
}


// ============================================================================
// 2. SINGULARISATION PRUDENTE
// ============================================================================
//
// IMPORTANT :
// On ne fait PAS simplement :
//
//   .replace(/s$/, '')
//
// car cela casserait certains mots :
//
//   riz
//   mais
//   pois
//   jus
//   etc.
//
// On traite uniquement quelques pluriels français évidents.
// ============================================================================

function singularizeWord(word: string): string {

  if (word.length <= 3) {
    return word
  }

  // œufs → œuf
  if (word.endsWith('ufs')) {
    return word.slice(0, -1)
  }

  // tomates → tomate
  // oignons → oignon
  // carottes → carotte
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

  // pommes → pomme
  // bananes → banane
  // courgettes → courgette
  if (word.endsWith('es')) {
    return word.slice(0, -1)
  }

  // tomates, carottes, poires...
  //
  // Cas général prudent :
  // uniquement si le mot comporte au moins 5 caractères.
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
// 3. NETTOYAGE
// ============================================================================

export function cleanMatcherText(
  text: string,
  stopWords?: Set<string>
): string {

  if (!text) return ''

  let cleaned = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()[\],.;:/\\'"!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const words =
    cleaned
      .split(' ')
      .filter(Boolean)
      .map(singularizeWord)

  const ignored =
    stopWords ?? BASE_STOP_WORDS

  return words
    .filter(word => !ignored.has(word))
    .join(' ')
}


// ============================================================================
// 4. TOKENISATION
// ============================================================================

function tokenize(
  text: string,
  stopWords?: Set<string>
): string[] {

  return cleanMatcherText(
    text,
    stopWords
  )
    .split(' ')
    .filter(Boolean)
}


// ============================================================================
// 5. SCORE TEXTUEL
// ============================================================================

function calculateTextScore(
  ingredientName: string,
  stockProduct: string,
  stopWords?: Set<string>
): number {

  const ingredient =
    cleanMatcherText(
      ingredientName,
      stopWords
    )

  const product =
    cleanMatcherText(
      stockProduct,
      stopWords
    )

  if (!ingredient || !product) {
    return 0
  }


  // --------------------------------------------------------------------------
  // 1. Correspondance exacte
  // --------------------------------------------------------------------------

  if (ingredient === product) {
    return 1
  }


  // --------------------------------------------------------------------------
  // 2. Inclusion directe
  // --------------------------------------------------------------------------

  if (product.includes(ingredient)) {
    return 0.96
  }

  if (ingredient.includes(product)) {
    return 0.93
  }


  // --------------------------------------------------------------------------
  // 3. Comparaison des mots
  // --------------------------------------------------------------------------

  const ingredientTokens =
    new Set(
      tokenize(
        ingredient,
        stopWords
      )
    )

  const productTokens =
    new Set(
      tokenize(
        product,
        stopWords
      )
    )

  if (
    ingredientTokens.size === 0 ||
    productTokens.size === 0
  ) {
    return 0
  }


  let common = 0

  ingredientTokens.forEach(token => {

    if (productTokens.has(token)) {
      common++
    }

  })


  const coverageIngredient =
    common / ingredientTokens.size

  const coverageProduct =
    common / productTokens.size


  // --------------------------------------------------------------------------
  // Cas particulièrement intéressant :
  //
  // "tomate cerise"
  // "cerise tomate"
  //
  // Les deux mots sont présents → correspondance très forte.
  // --------------------------------------------------------------------------

  if (
    coverageIngredient === 1 &&
    coverageProduct === 1
  ) {
    return 0.98
  }


  const score =
    coverageIngredient * 0.7 +
    coverageProduct * 0.3


  // --------------------------------------------------------------------------
  // IMPORTANT :
  // On ne plafonne plus artificiellement à 0.89.
  //
  // Mais on réserve 1.00 aux correspondances strictement identiques.
  // --------------------------------------------------------------------------

  return Math.min(
    Math.max(score, 0),
    0.97
  )
}


// ============================================================================
// 6. CHARGEMENT DU STOCK
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
// 7. RECHERCHE DES CANDIDATS
// ============================================================================

export async function findTextCandidates(
  ingredientName: string,
  stock: MatcherStockItem[],
  limit: number = 5
): Promise<MatchCandidate[]> {

  const stopWords =
    await loadMatcherStopWords()

  return stock
    .map(stockItem => {

      const lexicalScore =
        calculateTextScore(
          ingredientName,
          stockItem.produit,
          stopWords
        )

      return {
        stockItem,
        lexicalScore,
        score: lexicalScore,
      }
    })

    .filter(
      candidate =>
        candidate.lexicalScore >= 0.25
    )

    .sort(
      (a, b) =>
        b.lexicalScore -
        a.lexicalScore
    )

    .slice(0, limit)
}


// ============================================================================
// 8. CLAUDE — CAS AMBIGUS
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

    console.warn(
      'ANTHROPIC_API_KEY absente — matching IA désactivé.'
    )

    return {
      matchedProduct: null,
      confidence: 0,
      reason: 'Clé API absente',
    }
  }


  const candidateList =
    candidates
      .map(
        (candidate, index) =>
          `${index + 1}. ${candidate.stockItem.produit}`
      )
      .join('\n')


  const prompt = `
Tu es un moteur de rapprochement d'ingrédients alimentaires.

Ta mission est de déterminer si un ingrédient demandé dans une recette
correspond à l'un des produits réellement disponibles dans le stock.

<ingredient_recette>
${ingredientName}
</ingredient_recette>

<produits_stock>
${candidateList}
</produits_stock>

RÈGLES :

1. Tu dois choisir uniquement parmi les produits listés.
2. Si aucun produit ne convient, réponds "AUCUN".
3. Une différence de marque ou de conditionnement n'est pas importante.
4. Une différence de forme peut être acceptable si le produit reste
   réellement utilisable dans la recette.
5. Ne considère PAS deux ingrédients comme équivalents simplement parce
   qu'ils appartiennent à la même catégorie.
6. "tomate" et "tomate cerise" peuvent être proches mais ne sont pas
   automatiquement équivalents.
7. "lait" et "lait de coco" ne doivent pas être considérés comme
   équivalents par défaut.
8. Ne tiens pas compte des quantités.
9. Ne fais aucune conversion d'unité.
10. En cas de doute important, préfère "AUCUN".

Réponds uniquement avec ce JSON :

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
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },

          body: JSON.stringify({

            // IMPORTANT :
            // Cet identifiant est bien valide.
            // Anthropic documente actuellement Claude Haiku 4.5
            // sous ce nom.
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
        reason: 'Erreur API Claude',
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
        reason: 'Réponse vide',
      }
    }


    // ------------------------------------------------------------------------
    // Extraction robuste du JSON
    // ------------------------------------------------------------------------

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
          parsed.reason ??
          'Aucun produit correspondant',
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
// 9. MATCHER PRINCIPAL
// ============================================================================

export async function matchIngredientToStock(
  ingredientName: string,
  stock: MatcherStockItem[]
): Promise<MatchResult> {

  const stopWords =
    await loadMatcherStopWords()


  const cleanedIngredient =
    cleanMatcherText(
      ingredientName,
      stopWords
    )


  if (!cleanedIngredient) {

    return {
      matched: false,
      stockItem: null,
      confidence: 0,
      source: 'none',
      candidates: [],
      needs_review: false,
    }
  }


  // ==========================================================================
  // ÉTAPE 1 — CORRESPONDANCE EXACTE
  // ==========================================================================

  const exactMatch =
    stock.find(
      item =>
        cleanMatcherText(
          item.produit,
          stopWords
        ) === cleanedIngredient
    )


  if (exactMatch) {

    return {
      matched: true,
      stockItem: exactMatch,
      confidence: 1,
      source: 'exact',

      candidates: [
        {
          stockItem: exactMatch,
          lexicalScore: 1,
          score: 1,
          reason:
            'Correspondance exacte après normalisation',
        },
      ],

      needs_review: false,
    }
  }


  // ==========================================================================
  // ÉTAPE 2 — CANDIDATS TEXTUELS
  // ==========================================================================

  const candidates =
    await findTextCandidates(
      ingredientName,
      stock,
      5
    )


  // ==========================================================================
  // ÉTAPE 3 — CORRESPONDANCE TEXTUELLE TRÈS FORTE
  // ==========================================================================

  if (
    candidates.length > 0 &&
    candidates[0].lexicalScore >= 0.96
  ) {

    return {
      matched: true,

      stockItem:
        candidates[0].stockItem,

      confidence:
        candidates[0].lexicalScore,

      source: 'text',

      candidates,

      needs_review: false,
    }
  }


  // ==========================================================================
  // ÉTAPE 4 — CLAUDE POUR LES CAS AMBIGUS
  // ==========================================================================

  if (candidates.length > 0) {

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


        return {
          matched: true,

          stockItem:
            selected.stockItem,

          confidence:
            aiResult.confidence,

          source: 'ai',

          candidates,

          // < 0.85 = proposition à vérifier
          needs_review:
            aiResult.confidence < 0.85,
        }
      }
    }
  }


  // ==========================================================================
  // ÉTAPE 5 — AUCUN MATCH
  // ==========================================================================

  return {

    matched: false,

    stockItem: null,

    confidence: 0,

    source: 'none',

    candidates,

    needs_review:
      candidates.length > 0,
  }
}


// ============================================================================
// 10. MATCHING D'UNE LISTE D'INGRÉDIENTS
// ============================================================================
//
// Cache local :
// si "oignon" apparaît dans 5 recettes,
// le matcher n'est exécuté qu'une seule fois.
// ============================================================================

export async function matchIngredientsToStock(
  ingredients: string[],
  stock: MatcherStockItem[]
): Promise<
  Record<string, MatchResult>
> {

  const results:
    Record<string, MatchResult> = {}

  const cache =
    new Map<
      string,
      MatchResult
    >()


  for (const ingredient of ingredients) {

    const key =
      cleanMatcherText(
        ingredient
      )


    if (!key) {
      continue
    }


    if (cache.has(key)) {

      results[ingredient] =
        cache.get(key)!

      continue
    }


    const result =
      await matchIngredientToStock(
        ingredient,
        stock
      )


    cache.set(
      key,
      result
    )


    results[ingredient] =
      result
  }


  return results
}