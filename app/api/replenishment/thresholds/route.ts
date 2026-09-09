import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { mealioServerDb } from '../../../../lib/supabase-server'

async function getUser() {
  const c = await cookies()
  return c.get('congelo_username')?.value?.trim() || null
}

function positiveNumber(value: unknown, label: string) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} doit être un nombre supérieur ou égal à 0.`)
  return n
}

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const body = await request.json()
    const ingredient_id = String(body.ingredient_id ?? '').trim()
    const unite = String(body.unite ?? '').trim()
    const min_quantity = positiveNumber(body.min_quantity, 'Le seuil')
    const target_quantity = positiveNumber(body.target_quantity, 'La quantité cible')
    if (!ingredient_id || !unite) throw new Error('Ingrédient et unité obligatoires.')
    if (target_quantity <= min_quantity) throw new Error('La quantité cible doit être supérieure au seuil.')

    const { data, error } = await mealioServerDb
      .from('stock_replenishment_thresholds')
      .upsert({ user_id: user, ingredient_id, min_quantity, target_quantity, unite, active: body.active !== false }, { onConflict: 'user_id,ingredient_id' })
      .select('id,user_id,ingredient_id,min_quantity,target_quantity,unite,active')
      .single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ threshold: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}

export async function PATCH(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const body = await request.json()
    const id = String(body.id ?? '').trim()
    if (!id) throw new Error('Identifiant du seuil obligatoire.')
    const payload: Record<string, unknown> = {}
    if (body.min_quantity !== undefined) payload.min_quantity = positiveNumber(body.min_quantity, 'Le seuil')
    if (body.target_quantity !== undefined) payload.target_quantity = positiveNumber(body.target_quantity, 'La quantité cible')
    if (body.unite !== undefined) payload.unite = String(body.unite).trim()
    if (body.active !== undefined) payload.active = Boolean(body.active)
    const { data, error } = await mealioServerDb.from('stock_replenishment_thresholds').update(payload).eq('id', id).eq('user_id', user).select('id,user_id,ingredient_id,min_quantity,target_quantity,unite,active').single()
    if (error) throw new Error(error.message)
    if (Number(data.target_quantity) <= Number(data.min_quantity)) throw new Error('La quantité cible doit être supérieure au seuil.')
    return NextResponse.json({ threshold: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Identifiant du seuil obligatoire.' }, { status: 400 })
  const { error } = await mealioServerDb.from('stock_replenishment_thresholds').delete().eq('id', id).eq('user_id', user)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
