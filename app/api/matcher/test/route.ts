import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import {
  loadReferenceData,
  resolveRecipeIngredients,
  aggregateRequirements,
  compareToStock,
  createMatcherTrace,
  analyzeRecipe,
} from '../../../utils/matcher'

import { getHouseholdStock } from '../../../utils/stock-fetcher'
import { getRecipeDetailsFromCookiwiki } from '../../../utils/cookiwiki-fetcher'

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
const username = cookieStore.get('congelo_username')?.value

if (!username) {
  return NextResponse.json(
    { error: 'Foyer non authentifié.' },
    { status: 401 }
  )
}

    const body = await request.json()
    const recipeId = String(body.recipeId ?? '').trim()

    const refData = await loadReferenceData()
const householdStock = await getHouseholdStock(username)
const stock = householdStock.items

    // Nouveau mode V3.4 : analyse directe d'une recette Cookiwiki.
    if (recipeId) {
      const recipe = await getRecipeDetailsFromCookiwiki(recipeId)
      const servings = body.servings == null ? recipe.baseServings : Number(body.servings)
      if (!Number.isFinite(servings) || servings <= 0) {
        return NextResponse.json({ error: 'Le nombre de portions doit être positif.' }, { status: 400 })
      }

      const trace = createMatcherTrace(recipe.nom)
      const analysis = await analyzeRecipe(
        { ...recipe, servings },
        stock,
        refData,
        trace
      )

      return NextResponse.json({
        ok: true,
        mode: 'recipe',
        recipe: analysis.recipe,
        resolved: analysis.resolved,
        aggregated: analysis.aggregated,
        compared: analysis.compared,
        stockCount: stock.length,
        aiCacheSize: refData.aiResolutionMap.size,
        trace,
        diagnostics: {
          stockCount: stock.length,
          officialCount: refData.officialList.length,
          synonymCount: refData.synonymMap.size,
          unitCount: refData.unitMappings.length,
          densityCount: refData.densities.length,
          aiResolutionCount: refData.aiResolutionMap.size,
          claudeCalls: trace.claudeCalls,
        },
      })
    }

    // Mode historique : test d'un ingrédient isolé.
    const name = String(body.name ?? '').trim()
    const qty = Number(body.qty)
    const unit = String(body.unit ?? '').trim()
    const recipeName = String(body.recipeName ?? 'Test Matcher').trim()

    if (!name) return NextResponse.json({ error: 'Le nom de l’ingrédient est obligatoire.' }, { status: 400 })
    if (!Number.isFinite(qty) || qty <= 0) return NextResponse.json({ error: 'La quantité doit être un nombre positif.' }, { status: 400 })
    if (!unit) return NextResponse.json({ error: 'L’unité est obligatoire.' }, { status: 400 })

    const trace = createMatcherTrace(name)
    const resolved = await resolveRecipeIngredients(
      [{ name, qty, unit }],
      refData,
      'front-test',
      recipeName,
      1,
      trace
    )
    const aggregated = aggregateRequirements([resolved])
    const compared = await compareToStock(aggregated, stock, refData, trace)

    return NextResponse.json({
      ok: true,
      mode: 'ingredient',
      input: { name, qty, unit, recipeName },
      resolved,
      aggregated,
      compared,
      stockCount: stock.length,
      aiCacheSize: refData.aiResolutionMap.size,
      trace,
      diagnostics: {
        stockCount: stock.length,
        officialCount: refData.officialList.length,
        synonymCount: refData.synonymMap.size,
        unitCount: refData.unitMappings.length,
        densityCount: refData.densities.length,
        aiResolutionCount: refData.aiResolutionMap.size,
        claudeCalls: trace.claudeCalls,
      },
    })
  } catch (error) {
    console.error('[MATCHER TEST] ERREUR :', error)
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Erreur inconnue dans le Matcher.' },
      { status: 500 }
    )
  }
}
