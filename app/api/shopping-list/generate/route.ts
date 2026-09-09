import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { generateShoppingListForPeriod } from '../../../utils/shopping-list-generator'
import { addReplenishmentToActiveList, getReplenishmentSuggestions } from '../../../utils/replenishment-server'

function getParisToday(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  const day = Number(parts.find((p) => p.type === 'day')?.value)

  return new Date(year, month - 1, day, 12, 0, 0)
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const userId = cookieStore.get('congelo_user_id')?.value
  const username = cookieStore.get('congelo_username')?.value?.trim()

  if (!userId || !username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  let body: { includeFuture?: boolean; listName?: string }
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const today = getParisToday()
  const activeStart = today
  const activeEnd = addDays(today, 6)
  const futureEnd = addDays(today, 13)

  const dateStart = toIsoDate(activeStart)
  const dateEnd = toIsoDate(body.includeFuture ? futureEnd : activeEnd)

  const listName = body.listName?.trim() ||
    `Courses du ${dateStart} au ${dateEnd}`

  try {
    const result = await generateShoppingListForPeriod(
      userId,
      username,
      dateStart,
      dateEnd,
      listName,
    )

    // Les récurrents en mode « systématique » sont injectés par le même
    // moteur de courses, mais uniquement lorsqu'ils sont arrivés à échéance.
    const replenishmentSuggestions = await getReplenishmentSuggestions(username)
    const systematic = replenishmentSuggestions.filter(s => s.source === 'recurring' && s.mode === 'systematic')
    for (const suggestion of systematic) {
      try {
        await addReplenishmentToActiveList(username, {
          produit: suggestion.produit,
          ingredient_id: suggestion.ingredient_id,
          quantity: suggestion.quantity,
          unite: suggestion.unite,
          source: 'recurring',
          rule_id: suggestion.rule_id,
        })
      } catch (error) {
        console.error(`⚠️ Récurrent systématique « ${suggestion.produit} » non ajouté :`, error)
      }
    }

    return NextResponse.json({
      ...result,
      replenishment: {
        systematicAdded: systematic.map(s => s.produit),
        suggestions: replenishmentSuggestions.filter(s => !(s.source === 'recurring' && s.mode === 'systematic')),
      },
      period: {
        start: dateStart,
        end: dateEnd,
        activeStart: dateStart,
        activeEnd: toIsoDate(activeEnd),
        includesFuture: Boolean(body.includeFuture),
      },
    })
  } catch (err: any) {
    console.error('❌ Erreur génération liste de courses :', err)
    return NextResponse.json(
      { error: err?.message || 'Erreur interne.' },
      { status: 500 },
    )
  }
}
