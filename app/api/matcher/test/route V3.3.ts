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

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const userId = cookieStore.get('congelo_user_id')?.value

    if (!userId) {
      return NextResponse.json(
        { error: 'Utilisateur non authentifié.' },
        { status: 401 }
      )
    }

    const body = await request.json()

    const name = String(body.name ?? '').trim()
    const qty = Number(body.qty)
    const unit = String(body.unit ?? '').trim()
    const recipeName = String(body.recipeName ?? 'Test Matcher').trim()

    if (!name) {
      return NextResponse.json(
        { error: 'Le nom de l’ingrédient est obligatoire.' },
        { status: 400 }
      )
    }

    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json(
        { error: 'La quantité doit être un nombre positif.' },
        { status: 400 }
      )
    }

    if (!unit) {
      return NextResponse.json(
        { error: 'L’unité est obligatoire.' },
        { status: 400 }
      )
    }

    console.log('[MATCHER TEST] Entrée :', {
      name,
      qty,
      unit,
      recipeName,
    })

    // 1. Référentiel Mealio
    const refData = await loadReferenceData()

    console.log('[MATCHER TEST] Référentiel chargé :', {
      official: refData.officialList.length,
      synonyms: refData.synonymMap.size,
      units: refData.unitMappings.length,
      densities: refData.densities.length,
      aiLogs: refData.aiResolutionMap.size,
    })

    // 2. Résolution de l’ingrédient
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

    console.log('[MATCHER TEST] Résultat résolution :', resolved)

    // 3. Agrégation
    const aggregated = aggregateRequirements([resolved])

    console.log('[MATCHER TEST] Résultat agrégation :', aggregated)

    // 4. Stock Frosti + Cellio
    const stock = await getHouseholdStock(userId)

    console.log(
      '[MATCHER TEST] Stock récupéré :',
      stock.length,
      'articles'
    )

    // 5. Croisement besoin / stock + conversions quantitatives
    const compared = await compareToStock(
      aggregated,
      stock,
      refData,
      trace
    )

    console.log('[MATCHER TEST] Résultat stock :', compared)

    return NextResponse.json({
      ok: true,

      input: {
        name,
        qty,
        unit,
        recipeName,
      },

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
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : 'Erreur inconnue dans le Matcher.',
      },
      { status: 500 }
    )
  }
}
