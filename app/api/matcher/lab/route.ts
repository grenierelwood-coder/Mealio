import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import {
  loadReferenceData,
  resolveRecipeIngredients,
  aggregateRequirements,
  compareToStock,
  createMatcherTrace,
} from '../../../utils/matcher'

import { getHouseholdStock } from '../../../utils/stock-fetcher'
import { getRecipeDetailsFromCookiwiki } from '../../../utils/cookiwiki-fetcher'

/**
 * Matcher Lab
 *
 * Endpoint définitif :
 *   POST /api/matcher/lab
 *
 * IMPORTANT :
 * - On ne modifie pas la logique métier de utils/matcher.tsx.
 * - Ce routeur orchestre uniquement :
 *     1. authentification Mealio par cookie
 *     2. chargement du référentiel Matcher
 *     3. récupération du stock Frosti + Cellio
 *     4. récupération éventuelle d'une recette Cookiwiki
 *     5. résolution / agrégation / comparaison
 *
 * Modes :
 *   - inventory : diagnostic du stock réel
 *   - recipe    : analyse d'une recette Cookiwiki
 *   - ingredient: test d'un ingrédient isolé
 */

function normalizeDiagnosticProduct(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()[\],.;:/\\'"!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildStockDiagnostics(
  items: Array<{
    id: string
    produit: string
    qte: number
    unite: string
    source?: string
  }>
) {
  const groups = new Map<
    string,
    {
      key: string
      produit: string
      lignes: Array<{
        id: string
        produit: string
        qte: number
        unite: string
        source: string | null
      }>
      sources: string[]
      unites: string[]
    }
  >()

  for (const item of items) {
    const key = normalizeDiagnosticProduct(item.produit)
    if (!key) continue

    const existing = groups.get(key)

    const line = {
      id: String(item.id),
      produit: item.produit,
      qte: Number(item.qte ?? 0),
      unite: item.unite,
      source: item.source ?? null,
    }

    if (existing) {
      existing.lignes.push(line)

      if (item.source && !existing.sources.includes(item.source)) {
        existing.sources.push(item.source)
      }

      if (item.unite && !existing.unites.includes(item.unite)) {
        existing.unites.push(item.unite)
      }
    } else {
      groups.set(key, {
        key,
        produit: item.produit,
        lignes: [line],
        sources: item.source ? [item.source] : [],
        unites: item.unite ? [item.unite] : [],
      })
    }
  }

  const all = Array.from(groups.values())

  const duplicates = all
    .filter(group => group.lignes.length > 1)
    .sort(
      (a, b) =>
        b.lignes.length - a.lignes.length ||
        a.produit.localeCompare(b.produit, 'fr')
    )

  return {
    distinctProducts: all.length,
    duplicateProductGroups: duplicates.length,
    duplicateLineCount: duplicates.reduce(
      (sum, group) => sum + group.lignes.length,
      0
    ),
    groups: all.sort((a, b) =>
      a.produit.localeCompare(b.produit, 'fr')
    ),
    duplicates,
  }
}

function buildStockSummary(
  stock: Awaited<ReturnType<typeof getHouseholdStock>>
) {
  const items = stock.items ?? []
  const diagnostics = buildStockDiagnostics(items)

  return {
    username: stock.username,
    totalLines: items.length,

    frostiLines: stock.frosti.count,
    cellioLines: stock.cellio.count,

    frostiUserId: stock.frosti.userId,
    cellioUserId: stock.cellio.userId,

    frostiError: stock.frosti.error ?? null,
    cellioError: stock.cellio.error ?? null,

    distinctProducts: diagnostics.distinctProducts,
    duplicateProductGroups: diagnostics.duplicateProductGroups,
    duplicateLineCount: diagnostics.duplicateLineCount,

    diagnostics,
    items,
  }
}

function buildDiagnostics(
  refData: Awaited<ReturnType<typeof loadReferenceData>>,
  stock: Awaited<ReturnType<typeof getHouseholdStock>>,
  claudeCalls = 0
) {
  const stockCount = stock.items.length

  return {
    stockCount,
    frostiCount: stock.frosti.count,
    cellioCount: stock.cellio.count,

    distinctProducts: buildStockDiagnostics(stock.items).distinctProducts,
    duplicateProductGroups:
      buildStockDiagnostics(stock.items).duplicateProductGroups,
    duplicateLineCount:
      buildStockDiagnostics(stock.items).duplicateLineCount,

    officialCount: refData.officialList.length,
    synonymCount: refData.synonymMap.size,
    unitCount: refData.unitMappings.length,
    densityCount: refData.densities.length,
    aiResolutionCount: refData.aiResolutionMap.size,

    claudeCalls,
  }
}

export async function POST(request: NextRequest) {
  try {
    /*
     * ============================================================
     * 1. AUTHENTIFICATION
     * ============================================================
     *
     * Le login Mealio pose notamment :
     *   congelo_username
     *
     * Le Matcher utilise le username du foyer pour résoudre
     * séparément l'utilisateur Frosti et l'utilisateur Cellio.
     */
    const cookieStore = await cookies()

    const username =
      cookieStore.get('congelo_username')?.value?.trim() || ''

    if (!username) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Utilisateur non authentifié.',
        },
        { status: 401 }
      )
    }

    /*
     * ============================================================
     * 2. LECTURE DU BODY
     * ============================================================
     */
    const body = await request.json()
    const mode = String(body.mode ?? 'ingredient').trim().toLowerCase()

    /*
     * ============================================================
     * 3. RÉFÉRENTIEL MATCHER
     * ============================================================
     */
    const refData = await loadReferenceData()

    /*
     * ============================================================
     * 4. STOCK FOYER
     * ============================================================
     *
     * getHouseholdStock() renvoie :
     *
     * {
     *   username,
     *   items,
     *   frosti,
     *   cellio,
     *   total
     * }
     *
     * Le routeur transmet ensuite stock.items au moteur Matcher,
     * qui attend un StockItem[].
     */
    const stock = await getHouseholdStock(username)
    const stockSummary = buildStockSummary(stock)

    /*
     * ============================================================
     * MODE INVENTAIRE
     * ============================================================
     *
     * Diagnostic pur :
     * aucun matching de recette n'est effectué.
     */
    if (mode === 'inventory') {
      return NextResponse.json({
        ok: true,
        mode: 'inventory',

        stock: stockSummary,

        diagnostics: buildDiagnostics(
          refData,
          stock,
          0
        ),
      })
    }

    /*
     * ============================================================
     * MODE RECETTE COOKIWIKI
     * ============================================================
     *
     * L'ancienne route appelait analyzeRecipe(), mais cette fonction
     * n'est pas exportée par le matcher actuellement utilisé.
     *
     * On reproduit ici l'orchestration avec les fonctions publiques
     * réellement exportées par utils/matcher.tsx :
     *
     *   resolveRecipeIngredients()
     *   aggregateRequirements()
     *   compareToStock()
     *
     * La logique de matching reste donc dans le moteur Matcher.
     */
    const recipeId = String(body.recipeId ?? '').trim()

    if (recipeId) {
      const recipe = await getRecipeDetailsFromCookiwiki(recipeId)

      const requestedServings =
        body.servings == null
          ? recipe.baseServings
          : Number(body.servings)

      if (
        !Number.isFinite(requestedServings) ||
        requestedServings <= 0
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: 'Le nombre de portions doit être un nombre positif.',
          },
          { status: 400 }
        )
      }

      const servingsRatio =
        recipe.baseServings > 0
          ? requestedServings / recipe.baseServings
          : 1

      const trace = createMatcherTrace(recipe.nom)

      const resolved = await resolveRecipeIngredients(
        recipe.ingredients,
        refData,
        recipe.id,
        recipe.nom,
        servingsRatio,
        trace
      )

      const aggregated = aggregateRequirements([resolved])

      const compared = await compareToStock(
        aggregated,
        stock.items,
        refData,
        trace
      )

      return NextResponse.json({
        ok: true,
        mode: 'recipe',

        recipe: {
          ...recipe,
          servings: requestedServings,
          servingsRatio,
        },

        resolved,
        aggregated,
        compared,

        stock: stockSummary,

        trace,

        diagnostics: buildDiagnostics(
          refData,
          stock,
          trace.claudeCalls
        ),
      })
    }

    /*
     * ============================================================
     * MODE INGRÉDIENT ISOLÉ
     * ============================================================
     */
    const name = String(body.name ?? '').trim()
    const qty = Number(body.qty)
    const unit = String(body.unit ?? '').trim()
    const recipeName =
      String(body.recipeName ?? 'Test Matcher').trim() ||
      'Test Matcher'

    if (!name) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Le nom de l’ingrédient est obligatoire.',
        },
        { status: 400 }
      )
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'La quantité doit être un nombre positif.',
        },
        { status: 400 }
      )
    }

    if (!unit) {
      return NextResponse.json(
        {
          ok: false,
          error: 'L’unité est obligatoire.',
        },
        { status: 400 }
      )
    }

    const trace = createMatcherTrace(name)

    const resolved = await resolveRecipeIngredients(
      [
        {
          name,
          qty,
          unit,
        },
      ],
      refData,
      'front-test',
      recipeName,
      1,
      trace
    )

    const aggregated = aggregateRequirements([resolved])

    const compared = await compareToStock(
      aggregated,
      stock.items,
      refData,
      trace
    )

    return NextResponse.json({
      ok: true,
      mode: 'ingredient',

      input: {
        name,
        qty,
        unit,
        recipeName,
      },

      resolved,
      aggregated,
      compared,

      stock: stockSummary,

      trace,

      diagnostics: buildDiagnostics(
        refData,
        stock,
        trace.claudeCalls
      ),
    })
  } catch (error) {
    console.error(
      '[MATCHER LAB] ERREUR :',
      error
    )

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Erreur inconnue dans le laboratoire du Matcher.',
      },
      { status: 500 }
    )
  }
}
