import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import { mealioServerDb } from '../../lib/supabase-server'

export async function GET() {
  const username = (await getAuthSession())?.username?.trim()

  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  const { data: lists, error: listsError } = await mealioServerDb
    .from('shopping_lists')
    .select('id')
    .eq('user_id', username)

  if (listsError) return NextResponse.json({ error: `Impossible de lire les listes : ${listsError.message}` }, { status: 500 })

  const ids = (lists ?? []).map(row => row.id)
  if (!ids.length) return NextResponse.json({ purchases: [] })

  const { data, error } = await mealioServerDb
    .from('shopping_purchase_events')
    .select('id,list_id,shopping_item_id,produit,ingredient_id,quantity,unite,purchased_at,status,storage,location_name')
    .in('list_id', ids)
    .order('purchased_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: `Impossible de lire l’historique des achats : ${error.message}` }, { status: 500 })

  const ingredientIds = Array.from(new Set((data ?? []).map(item => item.ingredient_id).filter((id): id is string => Boolean(id))))
  const { data: ingredients, error: ingredientsError } = ingredientIds.length
    ? await mealioServerDb.from('official_ingredients').select('id,categorie').in('id', ingredientIds)
    : { data: [], error: null }

  if (ingredientsError) return NextResponse.json({ error: `Impossible de lire les catégories des achats : ${ingredientsError.message}` }, { status: 500 })

  const categoryByIngredient = new Map((ingredients ?? []).map((ingredient: any) => [ingredient.id, ingredient.categorie ?? null]))
  const purchases = (data ?? []).map(item => ({
    ...item,
    category: item.ingredient_id ? categoryByIngredient.get(item.ingredient_id) ?? null : null,
  }))

  return NextResponse.json({ purchases })
}
