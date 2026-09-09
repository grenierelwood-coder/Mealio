import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import {
  loadReferenceData,
  resolveIngredientDecision,
} from '../../../utils/matcher'

/**
 * Phase 23 — endpoint de décision unitaire du Matcher.
 *
 * Il expose la décision structurée sans obliger le front à connaître
 * l'implémentation interne du moteur.
 */
export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const username = cookieStore.get('congelo_username')?.value?.trim() || ''

    if (!username) {
      return NextResponse.json(
        { ok: false, error: 'Utilisateur non authentifié.' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const name = String(body.name ?? '').trim()

    if (!name) {
      return NextResponse.json(
        { ok: false, error: 'Le nom de l’ingrédient est obligatoire.' },
        { status: 400 }
      )
    }

    const refData = await loadReferenceData()
    const result = await resolveIngredientDecision(name, refData)

    return NextResponse.json({
      ok: true,
      input: { name },
      result,
      diagnostics: {
        officialCount: refData.officialList.length,
        synonymCount: refData.synonymMap.size,
        unitCount: refData.unitMappings.length,
        densityCount: refData.densities.length,
        aiResolutionCount: refData.aiResolutionMap.size,
      },
    })
  } catch (error) {
    console.error('[MATCHER RESOLVE] ERREUR :', error)
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue dans le Matcher.',
      },
      { status: 500 }
    )
  }
}
