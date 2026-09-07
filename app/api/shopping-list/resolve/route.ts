import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { mealioServerDb } from '../../../lib/supabase-server'

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const username = cookieStore.get('congelo_username')?.value?.trim()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const shoppingItemId = typeof body?.shoppingItemId === 'string' ? body.shoppingItemId.trim() : ''
  const ingredientId = typeof body?.ingredientId === 'string' ? body.ingredientId.trim() : ''
  if (!shoppingItemId || !ingredientId) return NextResponse.json({ error: 'Article ou ingrédient manquant.' }, { status: 400 })

  const { data: list, error: listError } = await mealioServerDb
    .from('shopping_lists').select('id').eq('user_id', username).eq('status', 'en_cours').order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (listError) return NextResponse.json({ error: listError.message }, { status: 500 })
  if (!list) return NextResponse.json({ error: 'Aucune liste active.' }, { status: 404 })

  const { data: ingredient, error: ingredientError } = await mealioServerDb
    .from('official_ingredients').select('id,nom').eq('id', ingredientId).maybeSingle()
  if (ingredientError) return NextResponse.json({ error: ingredientError.message }, { status: 500 })
  if (!ingredient) return NextResponse.json({ error: 'Ingrédient officiel introuvable.' }, { status: 404 })

  const { data: item, error: itemError } = await mealioServerDb
    .from('shopping_items').select('id,produit').eq('id', shoppingItemId).eq('list_id', list.id).maybeSingle()
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 })
  if (!item) return NextResponse.json({ error: 'Article de courses introuvable dans la liste active.' }, { status: 404 })

  const { data: updated, error: updateError } = await mealioServerDb
    .from('shopping_items').update({ ingredient_id: ingredient.id }).eq('id', item.id).eq('list_id', list.id).select('id,produit,ingredient_id').single()
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ success: true, item: updated, ingredient })
}
