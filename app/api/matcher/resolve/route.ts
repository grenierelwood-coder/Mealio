import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'

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
    const username = (await getAuthSession())?.username ?? ''

    if (!username) {
      return NextResponse.json(
        { ok: false, error: 'Utilisateur non authentifié.' },
        { status: 401 }
      )
    }

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 })
    }
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
