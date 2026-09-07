import { mealioDb } from '../lib/supabase'

interface RecipeIngredient {
  name: string
  qty: number
  unit: string
}

interface StockItem {
  produit: string
  qte: number
  unite: string
}

// ----------------------------------------------------------------------------
// 1. Nettoyage de base du texte
// ----------------------------------------------------------------------------
export function cleanText(text: string): string {
  if (!text) return ''
  let t = text
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .trim()

  if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss')) {
    t = t.slice(0, -1)
  }

  return t
}

// ----------------------------------------------------------------------------
// 2. Référentiels — chargés UNE SEULE FOIS pour toute une génération de liste
//    (potentiellement plusieurs dizaines de recettes), jamais par ingrédient.
// ----------------------------------------------------------------------------
export interface ReferenceData {
  ignoredSet: Set<string>
  synonymMap: Map<string, string>
  officialList: { id: string; nom: string; rayon: string | null; default_storage: string | null }[]
  officialById: Map<string, { id: string; nom: string; rayon: string | null; default_storage: string | null }>
  officialNamesForAi: string[]
  unitMappings: { unite: string; abreviation: string | null; type_unite: string | null; multiplicateur: number | null }[]
  densities: { ingredient_id: string; unite: string; poids_g_approx: number }[]
}

export async function loadReferenceData(): Promise<ReferenceData> {
  const [
    { data: ignoredWords },
    { data: synonyms },
    { data: officialIngredients },
    { data: unitMappings },
    { data: densities },
  ] = await Promise.all([
    mealioDb.from('ignored_words').select('mot'),
    mealioDb.from('ingredient_synonyms').select('mot_recette, ingredient_id'),
    mealioDb.from('official_ingredients').select('id, nom, rayon, default_storage'),
    mealioDb.from('unit_mappings').select('unite, abreviation, type_unite, multiplicateur'),
    mealioDb.from('ingredient_densities').select('ingredient_id, unite, poids_g_approx'),
  ])

  const officialList = officialIngredients ?? []

  return {
    ignoredSet: new Set((ignoredWords ?? []).map((w) => cleanText(w.mot))),
    synonymMap: new Map((synonyms ?? []).map((s) => [cleanText(s.mot_recette), s.ingredient_id])),
    officialList,
    officialById: new Map(officialList.map((o) => [o.id, o])),
    officialNamesForAi: officialList.map((o) => o.nom),
    unitMappings: unitMappings ?? [],
    densities: densities ?? [],
  }
}

function findUnitMapping(refData: ReferenceData, unit: string) {
  const cleaned = cleanText(unit)
  return refData.unitMappings.find(
    (u) => cleanText(u.unite) === cleaned || cleanText(u.abreviation ?? '') === cleaned
  )
}

function findDensity(refData: ReferenceData, ingredientId: string, unit: string) {
  const cleaned = cleanText(unit)
  return refData.densities.find((d) => d.ingredient_id === ingredientId && cleanText(d.unite) === cleaned)
}

// ----------------------------------------------------------------------------
// 3. Appel de secours à l'IA quand aucune correspondance n'est trouvée
// ----------------------------------------------------------------------------
// ⚠️ Nécessite ANTHROPIC_API_KEY côté serveur uniquement (jamais exposée
// côté client — ce module doit rester appelé depuis une route API / un
// composant serveur, jamais depuis 'use client').
async function askAiForIngredientMatch(rawName: string, officialNames: string[]): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('⚠️ ANTHROPIC_API_KEY absente — fallback IA désactivé.')
    return null
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 50,
        messages: [
          {
            role: 'user',
            content:
              `Ingrédient brut extrait d'une recette : "${rawName}"\n\n` +
              `Référentiel officiel disponible (choisis EXACTEMENT une valeur ` +
              `de cette liste, ou réponds "AUCUN" si rien ne correspond) :\n` +
              officialNames.join(', ') +
              `\n\nRéponds uniquement avec le nom exact choisi dans la liste, ` +
              `ou "AUCUN". Aucune autre explication.`,
          },
        ],
      }),
    })

    const data = await response.json()
    const textBlock = data?.content?.find((b: any) => b.type === 'text')
    const answer = textBlock?.text?.trim()

    if (!answer || answer.toUpperCase() === 'AUCUN') return null
    return officialNames.includes(answer) ? answer : null
  } catch (err) {
    console.error('❌ Erreur appel IA :', err)
    return null
  }
}

// ----------------------------------------------------------------------------
// 4. PHASE 1 — Résolution d'une recette : normalisation ingrédient + unité,
//    SANS comparaison au stock (volontairement — voir aggregateRequirements
//    plus bas pour la raison).
// ----------------------------------------------------------------------------
export interface ResolvedIngredient {
  produit: string
  ingredient_id: string | null
  qte: number
  unite: string
  needs_review: boolean // unité non résolue, ou correspondance proposée par l'IA en attente
  source_recipe_id: string
  source_recipe_nom: string
}

export async function resolveRecipeIngredients(
  recipeIngredients: RecipeIngredient[],
  refData: ReferenceData,
  recipeId: string,
  recipeNom: string,
  servingsRatio: number = 1
): Promise<ResolvedIngredient[]> {
  const resolved: ResolvedIngredient[] = []

  for (const ing of recipeIngredients) {
    const rawName = cleanText(ing.name)
    if (refData.ignoredSet.has(rawName)) continue

    // A. Recherche PRIORITAIRE dans les synonymes déjà validés
    let ingredientId: string | null = refData.synonymMap.get(rawName) ?? null
    let standardProduct: string | null = ingredientId ? refData.officialById.get(ingredientId)?.nom ?? null : null

    // B. Recherche bidirectionnelle dans le référentiel officiel
    if (!ingredientId) {
      const officialMatch = refData.officialList.find((o) => {
        const cleanedNom = cleanText(o.nom)
        return cleanedNom.includes(rawName) || rawName.includes(cleanedNom)
      })
      if (officialMatch) {
        ingredientId = officialMatch.id
        standardProduct = officialMatch.nom
      }
    }

    // C. Appel de secours à l'IA — proposition mise EN ATTENTE, jamais
    //    écrite directement dans ingredient_synonyms
    let aiProposed = false
    if (!ingredientId) {
      const aiAnswer = await askAiForIngredientMatch(ing.name, refData.officialNamesForAi)
      if (aiAnswer) {
        const match = refData.officialList.find((o) => o.nom === aiAnswer)
        if (match) {
          ingredientId = match.id
          standardProduct = match.nom
          aiProposed = true

          const { data: existingLog } = await mealioDb
            .from('ai_resolution_log')
            .select('id')
            .eq('mot_recette', ing.name)
            .eq('statut', 'en_attente')
            .maybeSingle()

          if (!existingLog) {
            await mealioDb.from('ai_resolution_log').insert({
              mot_recette: ing.name,
              proposition_ia: aiAnswer,
              ingredient_id_propose: match.id,
              statut: 'en_attente',
            })
          }
        }
      }
    }

    if (!standardProduct) standardProduct = ing.name

    // D. Normalisation quantité/unité, à l'échelle des portions demandées
    let requiredQty = ing.qty * servingsRatio
    let requiredUnit = cleanText(ing.unit)
    let unitResolved = false

    if (ingredientId) {
      const density = findDensity(refData, ingredientId, ing.unit)
      if (density) {
        requiredQty = requiredQty * density.poids_g_approx
        requiredUnit = 'g'
        unitResolved = true
      }
    }

    if (!unitResolved) {
      const mapping = findUnitMapping(refData, ing.unit)
      if (mapping) {
        if (mapping.type_unite === 'unité') {
          requiredUnit = 'pièce'
        } else if (mapping.type_unite === 'volume') {
          requiredQty = requiredQty * (mapping.multiplicateur ?? 1)
          requiredUnit = 'mL'
        } else if (mapping.type_unite === 'poids') {
          requiredQty = requiredQty * (mapping.multiplicateur ?? 1)
          requiredUnit = 'g'
        }
        unitResolved = true
      }
    }

    resolved.push({
      produit: standardProduct,
      ingredient_id: ingredientId,
      qte: requiredQty,
      unite: requiredUnit,
      needs_review: aiProposed || !unitResolved,
      source_recipe_id: recipeId,
      source_recipe_nom: recipeNom,
    })
  }

  return resolved
}

// ----------------------------------------------------------------------------
// 5. PHASE 2 — Agrégation de PLUSIEURS recettes : on additionne les besoins
//    ingrédient par ingrédient AVANT toute comparaison au stock.
// ----------------------------------------------------------------------------
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
      // Clé d'agrégation : ingredient_id si connu (le plus fiable), sinon
      // nom nettoyé en dernier recours — toujours combinée à l'unité, on
      // ne peut pas additionner des grammes et des pièces.
      const key = `${item.ingredient_id ?? cleanText(item.produit)}::${cleanText(item.unite)}`
      const existing = map.get(key)

      if (existing) {
        existing.qte += item.qte
        existing.needs_review = existing.needs_review || item.needs_review
        existing.contributions.push({
          recipe_id: item.source_recipe_id,
          recipe_nom: item.source_recipe_nom,
          qte_contribuee: item.qte,
        })
      } else {
        map.set(key, {
          produit: item.produit,
          ingredient_id: item.ingredient_id,
          qte: item.qte,
          unite: item.unite,
          needs_review: item.needs_review,
          contributions: [
            { recipe_id: item.source_recipe_id, recipe_nom: item.source_recipe_nom, qte_contribuee: item.qte },
          ],
        })
      }
    }
  }

  return Array.from(map.values())
}

// ----------------------------------------------------------------------------
// 6. PHASE 3 — Comparaison au stock, UNE SEULE FOIS par ingrédient agrégé.
// ----------------------------------------------------------------------------
export interface ComparedRequirement extends AggregatedRequirement {
  qte_a_acheter: number
  ai_status: 'green' | 'orange' | 'red'
}

export function compareToStock(
  aggregated: AggregatedRequirement[],
  globalStock: StockItem[]
): ComparedRequirement[] {
  return aggregated.map((item) => {
    const matchingStockItems = globalStock.filter(
      (stock) =>
        cleanText(stock.produit).includes(cleanText(item.produit)) ||
        cleanText(item.produit).includes(cleanText(stock.produit))
    )

    let totalStockQty = 0
    let hasUnitMismatch = false

    matchingStockItems.forEach((stock) => {
      if (cleanText(stock.unite) === cleanText(item.unite)) {
        totalStockQty += Number(stock.qte)
      } else {
        hasUnitMismatch = true
      }
    })

    let ai_status: 'green' | 'orange' | 'red' = 'red'
    let qte_a_acheter = item.qte - totalStockQty

    if (totalStockQty >= item.qte) {
      ai_status = 'green'
      qte_a_acheter = 0
    } else if (totalStockQty > 0 && totalStockQty < item.qte) {
      ai_status = 'orange'
      qte_a_acheter = item.qte - totalStockQty
    } else if ((hasUnitMismatch || item.needs_review) && totalStockQty === 0) {
      ai_status = 'orange'
      qte_a_acheter = item.qte
    } else {
      ai_status = 'red'
      qte_a_acheter = item.qte
    }

    return { ...item, qte_a_acheter, ai_status }
  })
}
