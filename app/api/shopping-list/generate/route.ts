import { getAuthSession } from '../../../utils/auth-server'
import { NextRequest, NextResponse } from 'next/server'
import { generateShoppingListForPeriod } from '../../../utils/shopping-list-generator'
import { processReplenishmentForCourses } from '../../../utils/replenishment-server'

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
  const session = await getAuthSession()
  const userId = session?.frostiUserId
  const username = session?.username?.trim()

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

    const replenishment = await processReplenishmentForCourses(username)

    return NextResponse.json({
      ...result,
      replenishment: {
        systematicAdded: replenishment.systematicAdded,
        suggestions: replenishment.suggestions,
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
