import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getReplenishmentSuggestions, listFavoriteUnits, listFavorites, listRecurringRules, listThresholdRules } from '../../utils/replenishment-server'

async function username() {
  const c = await cookies()
  return c.get('congelo_username')?.value?.trim() || null
}

export async function GET() {
  const user = await username()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const [favorites, thresholds, recurring, suggestions, units] = await Promise.all([
      listFavorites(user),
      listThresholdRules(user),
      listRecurringRules(user),
      getReplenishmentSuggestions(user),
      listFavoriteUnits(),
    ])
    return NextResponse.json({ favorites, thresholds, recurring, suggestions, units })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}
