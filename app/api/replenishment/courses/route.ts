import { getAuthSession } from '../../../utils/auth-server'
import { NextResponse } from 'next/server'
import { processReplenishmentForCourses } from '../../../utils/replenishment-server'

export async function POST() {
  const username = (await getAuthSession())?.username?.trim() || null
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const result = await processReplenishmentForCourses(username)
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}
