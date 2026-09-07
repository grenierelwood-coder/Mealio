import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { mealioServerDb } from '../../../lib/supabase-server'

async function getUsername(): Promise<string | null> {
  const cookieStore = await cookies()

  return (
    cookieStore
      .get('congelo_username')
      ?.value
      ?.trim() || null
  )
}

/**
 * POST
 *
 * Termine la liste de courses active du foyer.
 *
 * Important :
 * - le username vient exclusivement du cookie ;
 * - le client ne fournit jamais le list_id ;
 * - seule la liste "en_cours" du foyer peut être terminée.
 */
export async function POST() {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      {
        error: 'Non authentifié.',
      },
      { status: 401 }
    )
  }

  try {
    /*
     * Recherche de la liste active du foyer.
     */
    const {
      data: activeList,
      error: listError,
    } = await mealioServerDb
      .from('shopping_lists')
      .select(`
        id,
        created_at,
        user_id,
        name,
        status,
        period_start,
        period_end
      `)
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .order('created_at', {
        ascending: false,
      })
      .limit(1)
      .maybeSingle()

    if (listError) {
      console.error(
        '❌ Erreur recherche liste active :',
        listError
      )

      return NextResponse.json(
        {
          error:
            `Impossible de récupérer la liste active : ${listError.message}`,
        },
        { status: 500 }
      )
    }

    if (!activeList) {
      return NextResponse.json(
        {
          error:
            'Aucune liste de courses active à terminer.',
        },
        { status: 404 }
      )
    }

    /*
     * Une liste ne peut pas être clôturée si un article acheté n'a pas de
     * transfert de stock enregistré. Le contrôle serveur protège le workflow
     * même si le navigateur contourne le front.
     */
    const { data: boughtItems, error: boughtError } = await mealioServerDb
      .from('shopping_items')
      .select('id,is_checked,qte_achetee')
      .eq('list_id', activeList.id)

    if (boughtError) {
      throw new Error(`Impossible de vérifier les articles achetés : ${boughtError.message}`)
    }

    const boughtIds = (boughtItems ?? [])
      .filter((item: any) => item.is_checked === true || Number(item.qte_achetee ?? 0) > 0)
      .map((item: any) => item.id)

    if (boughtIds.length > 0) {
      const { data: transfers, error: transferError } = await mealioServerDb
        .from('shopping_item_stock_transfers')
        .select('shopping_item_id')
        .in('shopping_item_id', boughtIds)

      if (transferError) {
        throw new Error(`Impossible de vérifier les rangements de stock : ${transferError.message}`)
      }

      const transferred = new Set((transfers ?? []).map((row: any) => row.shopping_item_id))
      const missingCount = boughtIds.filter((id: string) => !transferred.has(id)).length

      if (missingCount > 0) {
        return NextResponse.json(
          {
            error: `${missingCount} article(s) acheté(s) ne sont pas encore rangé(s). Résous les articles non rangés puis relance la finalisation.`,
            code: 'STOCK_TRANSFER_MISSING',
            missingCount,
          },
          { status: 409 }
        )
      }
    }

    /*
     * Termine la liste.
     *
     * La condition user_id + id + status protège
     * contre toute modification hors du foyer.
     */
    const {
      data: finishedList,
      error: updateError,
    } = await mealioServerDb
      .from('shopping_lists')
      .update({
        status: 'terminee',
      })
      .eq('id', activeList.id)
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .select(`
        id,
        created_at,
        user_id,
        name,
        status,
        period_start,
        period_end
      `)
      .single()

    if (updateError || !finishedList) {
      console.error(
        '❌ Erreur terminaison liste :',
        updateError
      )

      return NextResponse.json(
        {
          error:
            updateError?.message ||
            'Impossible de terminer la liste de courses.',
        },
        { status: 500 }
      )
    }

    console.log(
      `✅ Liste de courses terminée pour ${username} : ${finishedList.id}`
    )

    return NextResponse.json({
      list: finishedList,
      message:
        'Courses terminées avec succès.',
    })
  } catch (error) {
    console.error(
      '❌ Erreur inattendue POST /api/shopping-list/finish :',
      error
    )

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Erreur interne.',
      },
      { status: 500 }
    )
  }
}