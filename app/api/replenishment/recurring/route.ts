import { getAuthSession } from '../../../utils/auth-server'
import { NextRequest, NextResponse } from 'next/server'
import { mealioServerDb } from '../../../lib/supabase-server'
import { assertOfficialIngredientUnit } from '../../../utils/official-unit-policy'
import { markRecurringAdded } from '../../../utils/replenishment-server'

async function getUser() {
  return (await getAuthSession())?.username?.trim() || null
}

export async function POST(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const body = await request.json()
    const produit = String(body.produit ?? '').trim()
    const unite = String(body.unite ?? '').trim()
    const quantity = Number(body.quantity)
    const interval_days = Number(body.interval_days)
    const next_due_date = String(body.next_due_date ?? '').trim()
    const mode = body.mode === 'systematic' ? 'systematic' : 'suggestion'
    if (!produit || !unite || !next_due_date) throw new Error('Produit, unité et prochaine échéance sont obligatoires.')
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La quantité doit être supérieure à 0.')
    if (body.ingredient_id) await assertOfficialIngredientUnit(String(body.ingredient_id), unite)
    if (!Number.isInteger(interval_days) || interval_days <= 0) throw new Error('La fréquence doit être un nombre entier de jours supérieur à 0.')

    const { data, error } = await mealioServerDb.from('recurring_purchase_rules').insert({
      user_id: user,
      ingredient_id: body.ingredient_id ? String(body.ingredient_id) : null,
      produit,
      quantity,
      unite,
      rayon: body.rayon ? String(body.rayon) : null,
      interval_days,
      next_due_date,
      mode,
      active: body.active !== false,
    }).select('id,user_id,ingredient_id,produit,quantity,unite,rayon,interval_days,next_due_date,mode,active').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ recurring: data }, { status: 201 })
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
    if (!id) throw new Error('Identifiant du récurrent obligatoire.')
    const payload: Record<string, unknown> = {}
    for (const field of ['produit','rayon','next_due_date']) if (body[field] !== undefined) payload[field] = body[field] === null ? null : String(body[field])
    if (body.unite !== undefined) throw new Error('L’unité d’un achat récurrent existant ne peut pas être modifiée. Modifiez d’abord l’unité de référence de l’ingrédient.')
    if (body.quantity !== undefined) payload.quantity = Number(body.quantity)
    if (body.interval_days !== undefined) payload.interval_days = Number(body.interval_days)
    if (body.mode !== undefined) payload.mode = body.mode === 'systematic' ? 'systematic' : 'suggestion'
    if (body.active !== undefined) payload.active = Boolean(body.active)
    if (body.ingredient_id !== undefined) payload.ingredient_id = body.ingredient_id ? String(body.ingredient_id) : null
    const { data: currentRule, error: currentError } = await mealioServerDb
      .from('recurring_purchase_rules')
      .select('id,ingredient_id,unite')
      .eq('id', id)
      .eq('user_id', user)
      .maybeSingle()
    if (currentError) throw new Error(currentError.message)
    if (!currentRule) throw new Error('Achat récurrent introuvable.')

    const finalIngredientId = body.ingredient_id !== undefined
      ? (body.ingredient_id ? String(body.ingredient_id) : null)
      : (currentRule.ingredient_id ? String(currentRule.ingredient_id) : null)
    const finalUnit = String(currentRule.unite ?? '').trim()
    if (finalIngredientId) await assertOfficialIngredientUnit(finalIngredientId, finalUnit)

    const { data, error } = await mealioServerDb.from('recurring_purchase_rules').update(payload).eq('id', id).eq('user_id', user).select('id,user_id,ingredient_id,produit,quantity,unite,rayon,interval_days,next_due_date,mode,active').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ recurring: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  const id = new URL(request.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Identifiant du récurrent obligatoire.' }, { status: 400 })
  const { error } = await mealioServerDb.from('recurring_purchase_rules').delete().eq('id', id).eq('user_id', user)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function PUT(request: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const body = await request.json()
    await markRecurringAdded(String(body.id ?? ''), user)
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}
