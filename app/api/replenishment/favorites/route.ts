import { getAuthSession } from '../../../utils/auth-server'
import { NextRequest, NextResponse } from 'next/server'
import { updateFavoriteUnit } from '../../../utils/replenishment-server'

async function getUser() {
  return (await getAuthSession())?.username?.trim() || null
}

export async function PATCH(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const body = await request.json()
    const ingredientId = String(body.ingredient_id ?? '').trim()
    const unite = String(body.unite ?? '').trim()
    if (!ingredientId || !unite) throw new Error('Ingrédient et unité obligatoires.')
    const favorite = await updateFavoriteUnit(user, ingredientId, unite)
    return NextResponse.json({ favorite })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}
