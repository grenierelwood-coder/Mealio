import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { mealioServerDb } from '../../../lib/supabase-server'

type RecipeLinkRow = {
  shopping_item_id: string
  recipe_id: string
  recipe_nom: string
  qte_contribuee: number | null
}

function numberOrZero(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function effectiveBought(item: any): number {
  const explicit = numberOrZero(item.qte_achetee)
  if (explicit > 0) return explicit
  if (item.is_checked) {
    const purchase = numberOrZero(item.qte_achat)
    return purchase > 0 ? purchase : numberOrZero(item.qte)
  }
  return 0
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const username = cookieStore.get('congelo_username')?.value?.trim()

    if (!username) {
      return NextResponse.json({ error: 'Utilisateur non authentifié.' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const listId = typeof body?.listId === 'string' ? body.listId.trim() : ''

    if (!listId) {
      return NextResponse.json({ error: 'Identifiant de liste manquant.' }, { status: 400 })
    }

    const { data: oldList, error: listError } = await mealioServerDb
      .from('shopping_lists')
      .select('id,name,user_id,status,period_start,period_end')
      .eq('id', listId)
      .eq('user_id', username)
      .eq('status', 'terminee')
      .maybeSingle()

    if (listError) throw listError
    if (!oldList) {
      return NextResponse.json({ error: 'Liste terminée introuvable.' }, { status: 404 })
    }

    const { data: oldItems, error: itemsError } = await mealioServerDb
      .from('shopping_items')
      .select('id,produit,ingredient_id,qte,qte_achat,qte_achetee,unite,is_checked,is_manual,ai_status')
      .eq('list_id', listId)

    if (itemsError) throw itemsError

    const items = (oldItems ?? []).map(item => ({
      ...item,
      remaining: Math.max(numberOrZero(item.qte) - effectiveBought(item), 0),
    })).filter(item => item.remaining > 0)

    if (items.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Il ne reste aucun article à acheter.',
        list: null,
        itemCount: 0,
      })
    }

    const { data: newList, error: newListError } = await mealioServerDb
      .from('shopping_lists')
      .insert({
        user_id: username,
        name: `Suite des courses — ${oldList.name}`,
        status: 'en_cours',
        period_start: oldList.period_start,
        period_end: oldList.period_end,
      })
      .select('id,name,user_id,status,period_start,period_end,created_at')
      .single()

    if (newListError) throw newListError

    const oldItemIds = items.map(item => item.id)
    const { data: recipeLinks, error: recipesError } = await mealioServerDb
      .from('shopping_item_recipes')
      .select('shopping_item_id,recipe_id,recipe_nom,qte_contribuee')
      .in('shopping_item_id', oldItemIds)

    if (recipesError) throw recipesError

    const recipeMap = new Map<string, RecipeLinkRow[]>()
    for (const link of (recipeLinks ?? []) as RecipeLinkRow[]) {
      const list = recipeMap.get(link.shopping_item_id) ?? []
      list.push(link)
      recipeMap.set(link.shopping_item_id, list)
    }

    const rows = items.map(item => ({
      list_id: newList.id,
      produit: item.produit,
      ingredient_id: item.ingredient_id,
      qte: item.remaining,
      qte_achat: item.remaining,
      qte_achetee: 0,
      unite: item.unite ?? 'pièce(s)',
      is_checked: false,
      is_manual: item.is_manual ?? false,
      ai_status: item.ai_status ?? null,
    }))

    const { data: newItems, error: insertError } = await mealioServerDb
      .from('shopping_items')
      .insert(rows)
      .select('id,produit,qte')

    if (insertError) {
      await mealioServerDb.from('shopping_lists').delete().eq('id', newList.id).eq('user_id', username)
      throw insertError
    }

    const oldToNew = new Map<string, string>()
    for (let index = 0; index < items.length; index += 1) {
      const newItem = newItems?.[index]
      if (newItem) oldToNew.set(items[index].id, newItem.id)
    }

    const recipeRows = items.flatMap(item => {
      const links = recipeMap.get(item.id) ?? []
      const required = numberOrZero(item.qte)
      const ratio = required > 0 ? Math.min(item.remaining / required, 1) : 0
      const newItemId = oldToNew.get(item.id)
      if (!newItemId) return []
      return links.map(link => ({
        shopping_item_id: newItemId,
        recipe_id: link.recipe_id,
        recipe_nom: link.recipe_nom,
        qte_contribuee: link.qte_contribuee == null ? null : link.qte_contribuee * ratio,
      }))
    })

    if (recipeRows.length > 0) {
      const { error: recipeInsertError } = await mealioServerDb
        .from('shopping_item_recipes')
        .insert(recipeRows)

      if (recipeInsertError) {
        console.error('⚠️ Associations recettes non recréées :', recipeInsertError)
      }
    }

    return NextResponse.json({
      success: true,
      message: `${items.length} article${items.length > 1 ? 's' : ''} restant${items.length > 1 ? 's' : ''} remis dans une nouvelle liste de courses.`,
      list: newList,
      itemCount: items.length,
    })
  } catch (error) {
    console.error('❌ POST /api/shopping-list/continue', error)
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Erreur inconnue lors de la poursuite des courses.',
    }, { status: 500 })
  }
}
