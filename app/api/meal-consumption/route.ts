import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import {
  getPendingMealConsumptions,
  confirmMealConsumption,
} from '../../utils/meal-consumption-server'

async function getUsername() {
  return (await getAuthSession())?.username?.trim() || null
}

export async function GET() {
  const username = await getUsername()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const pending = await getPendingMealConsumptions(username)
    return NextResponse.json({ pending })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const username = await getUsername()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const body = await request.json()
    if (!body.meal_plan_id) return NextResponse.json({ error: 'meal_plan_id obligatoire.' }, { status: 400 })
    const result = await confirmMealConsumption(username, String(body.meal_plan_id), body.confirmed === true)
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}
