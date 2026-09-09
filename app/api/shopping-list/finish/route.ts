import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { mealioServerDb } from '../../../lib/supabase-server'

function numberOrZero(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function effectiveBought(item: any): number {
  // La quantité réellement achetée est la seule vérité métier.
  return numberOrZero(item.qte_achetee)
}

export async function POST(request: Request) {
  let allowIncomplete = false
  try {
    const body = await request.json()
    allowIncomplete = body?.allowIncomplete === true
  } catch {
    // Corps vide autorisé. Le comportement par défaut est strict.
  }
  const cookieStore = await cookies()
  const username = cookieStore.get('congelo_username')?.value?.trim() || null

  if (!username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  try {
    const { data: activeLists, error: listError } = await mealioServerDb
      .from('shopping_lists')
      .select('id,created_at,user_id,name,status,period_start,period_end')
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .order('created_at', { ascending: false })
      .limit(2)

    if (listError) {
      throw new Error(`Impossible de récupérer la liste active : ${listError.message}`)
    }

    if (!activeLists || activeLists.length === 0) {
      return NextResponse.json({ error: 'Aucune liste de courses active à terminer.' }, { status: 404 })
    }

    if (activeLists.length > 1) {
      return NextResponse.json(
        {
          error: 'Plusieurs listes de courses actives existent pour ce foyer. Exécute la migration Phase 15 avant de poursuivre.',
          code: 'MULTIPLE_ACTIVE_LISTS',
        },
        { status: 409 },
      )
    }

    const activeList = activeLists[0]

    const { data: items, error: itemsError } = await mealioServerDb
      .from('shopping_items')
      .select('id,produit,ingredient_id,qte,qte_achat,qte_achetee,stock_stored_quantity,unite,is_checked')
      .eq('list_id', activeList.id)

    if (itemsError) {
      throw new Error(`Impossible de vérifier les articles : ${itemsError.message}`)
    }

    // Un ingrédient officiel n'est nécessaire pour le rangement que si une
    // quantité a effectivement été achetée. Un article encore à acheter,
    // même inconnu, ne doit donc jamais bloquer la clôture à lui seul.
    const unresolvedBought = (items ?? []).filter((item: any) =>
      !item.ingredient_id && effectiveBought(item) > 0
    )

    const incompleteItems = (items ?? []).map((item: any) => {
      const required = numberOrZero(item.qte)
      const bought = effectiveBought(item)
      const stored = numberOrZero(item.stock_stored_quantity)
      return {
        id: item.id,
        produit: item.produit,
        ingredient_id: item.ingredient_id,
        unite: item.unite,
        required,
        achete: bought,
        range: stored,
        remaining: Math.max(required - bought, 0),
        storageMissing: Math.max(bought - stored, 0),
      }
    }).filter((item: any) => item.remaining > 1e-9 || item.storageMissing > 1e-9)

    const missingPurchase = incompleteItems.filter((item: any) => item.remaining > 1e-9)
    const missingStorage = incompleteItems.filter((item: any) => item.storageMissing > 1e-9)

    if (missingStorage.length > 0 && !allowIncomplete) {
      return NextResponse.json(
        {
          error: `${missingStorage.length} article(s) acheté(s) ne sont pas encore entièrement rangé(s) dans le stock.`,
          code: 'STOCK_TRANSFER_MISSING',
          missingCount: missingStorage.length,
          items: missingStorage,
          unresolvedBought: unresolvedBought.map((item: any) => ({ id: item.id, produit: item.produit })),
        },
        { status: 409 },
      )
    }

    if (missingPurchase.length > 0 && !allowIncomplete) {
      return NextResponse.json(
        {
          error: `${missingPurchase.length} article(s) ne sont pas entièrement achetés.`,
          code: 'INCOMPLETE_PURCHASE',
          missingCount: missingPurchase.length,
          items: missingPurchase,
        },
        { status: 409 },
      )
    }

    // Avec allowIncomplete=true, on clôture volontairement la liste. Les
    // quantités restantes seront proposées par l'interface pour poursuivre
    // les achats dans une nouvelle liste.

    const { data: finishedList, error: updateError } = await mealioServerDb
      .from('shopping_lists')
      .update({ status: 'terminee' })
      .eq('id', activeList.id)
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .select('id,created_at,user_id,name,status,period_start,period_end')
      .single()

    if (updateError || !finishedList) {
      throw new Error(updateError?.message || 'Impossible de terminer la liste de courses.')
    }

    const warningParts: string[] = []
    if (missingPurchase.length > 0) {
      warningParts.push(`${missingPurchase.length} besoin(s) non entièrement acheté(s)`)
    }
    if (missingStorage.length > 0) {
      warningParts.push(`${missingStorage.length} article(s) acheté(s) non rangé(s)`)
    }

    return NextResponse.json({
      list: finishedList,
      warnings: warningParts,
      message: warningParts.length > 0
        ? `Courses terminées avec avertissement : ${warningParts.join(' ; ')}.`
        : 'Courses terminées avec succès.',
    })
  } catch (error) {
    console.error('❌ Erreur POST /api/shopping-list/finish', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne.' },
      { status: 500 },
    )
  }
}
