import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import { getReplenishmentSuggestions, listFavoriteUnits, listFavorites, listRecurringRules, listThresholdRules } from '../../utils/replenishment-server'

async function username() {
  return (await getAuthSession())?.username?.trim() || null
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
