import { getAuthSession } from '../../../utils/auth-server'
import { NextRequest, NextResponse } from 'next/server'
import { mealioServerDb } from '../../../lib/supabase-server'
import { assertOfficialIngredientUnit } from '../../../utils/official-unit-policy'

function normalizeUnit(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

const UNIT_ALIASES: Record<string, string> = {
  piece: 'Pièce',
  pieces: 'Pièce',
  unite: 'Pièce',
  unites: 'Pièce',
  paquet: 'Paquet',
  paquets: 'Paquet',
  sachet: 'Sachet',
  sachets: 'Sachet',
  boite: 'Boîte',
  boites: 'Boîte',
  pot: 'Pot',
  pots: 'Pot',
  bouteille: 'Bouteille',
  bouteilles: 'Bouteille',
}

async function resolveShoppingUnit(value: string): Promise<string> {
  const wanted = value.trim() || 'Pièce'
  const wantedKey = normalizeUnit(wanted)
  const canonical = UNIT_ALIASES[wantedKey] ?? wanted
  const canonicalKey = normalizeUnit(canonical)

  const { data, error } = await mealioServerDb
    .from('unit_mappings')
    .select('unite, abreviation')

  if (error) {
    throw new Error(`Impossible de lire les unités Mealio : ${error.message}`)
  }

  const mapping = (data ?? []).find((row: any) => {
    const nameKey = normalizeUnit(row.unite)
    const abbreviationKey = normalizeUnit(row.abreviation)
    return (
      nameKey === canonicalKey ||
      nameKey === wantedKey ||
      (abbreviationKey !== '' && abbreviationKey === wantedKey)
    )
  })

  if (!mapping?.unite) {
    throw new Error(`Unité "${wanted}" absente de unit_mappings.`)
  }

  return mapping.unite
}


function normalizeIngredientName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

async function resolveManualIngredientId(produit: string): Promise<string | null> {
  const key = normalizeIngredientName(produit)
  if (!key) return null

  const { data: exact, error: exactError } = await mealioServerDb
    .from('official_ingredients')
    .select('id,nom')
  if (exactError) throw new Error(`Impossible de rechercher l’ingrédient officiel : ${exactError.message}`)

  const exactMatch = (exact ?? []).find((row: any) => normalizeIngredientName(row.nom) === key)
  if (exactMatch) return exactMatch.id

  const { data: synonyms, error: synonymError } = await mealioServerDb
    .from('ingredient_synonyms')
    .select('mot_recette,ingredient_id')
  if (synonymError) throw new Error(`Impossible de rechercher les synonymes : ${synonymError.message}`)

  const synonym = (synonyms ?? []).find((row: any) => normalizeIngredientName(row.mot_recette) === key)
  return synonym?.ingredient_id ?? null
}

async function getUsername(): Promise<string | null> {
  const session = await getAuthSession()
  return session?.username?.trim() || null
}

/**
 * Normalise un article pour que l'API retourne toujours
 * les quantités sous forme numérique.
 */
function normalizeItem(item: any) {
  return {
    id: item.id,
    list_id: item.list_id,
    produit: item.produit,
    ingredient_id: item.ingredient_id ?? null,
    qte: item.qte === null || item.qte === undefined
      ? null
      : Number(item.qte),
    qte_achat:
      item.qte_achat === null || item.qte_achat === undefined
        ? 0
        : Number(item.qte_achat),
    stock_stored_quantity:
      item.stock_stored_quantity === null || item.stock_stored_quantity === undefined
        ? 0
        : Number(item.stock_stored_quantity),
    qte_achetee:
      item.qte_achetee === null || item.qte_achetee === undefined
        ? 0
        : Number(item.qte_achetee),
    unite: item.unite,
    is_checked: Boolean(item.is_checked),
    is_manual: Boolean(item.is_manual),
    ai_status: item.ai_status ?? null,
    recipes: item.recipes ?? [],
  }
}

/**
 * POST
 * Ajout manuel d'un produit dans la liste de courses active.
 *
 * Le userId et le listId ne viennent JAMAIS du navigateur :
 * ils sont déterminés côté serveur à partir du cookie de session.
 */
export async function POST(request: NextRequest) {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  let body: {
    produit?: string
    qte?: number | string | null
    qte_achat?: number | string | null
    unite?: string | null
    ingredient_id?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Corps de requête invalide (JSON attendu).' },
      { status: 400 }
    )
  }

  const produit = body.produit?.trim()

  if (!produit) {
    return NextResponse.json(
      { error: 'Le produit est requis.' },
      { status: 400 }
    )
  }

  if (produit.length > 200) {
    return NextResponse.json(
      {
        error:
          'Le nom du produit est trop long (200 caractères maximum).',
      },
      { status: 400 }
    )
  }

  let qte = 1

  if (
    body.qte !== undefined &&
    body.qte !== null &&
    body.qte !== ''
  ) {
    const parsedQte =
      typeof body.qte === 'number'
        ? body.qte
        : Number(body.qte)

    if (!Number.isFinite(parsedQte) || parsedQte <= 0) {
      return NextResponse.json(
        {
          error:
            'La quantité doit être un nombre supérieur à 0.',
        },
        { status: 400 }
      )
    }

    qte = parsedQte
  }

  /**
   * Pour un ajout manuel :
   *
   * - besoin = qte
   * - quantité d'achat = qte par défaut
   * - quantité effectivement achetée = 0
   */
  let qteAchat = qte

  if (
    body.qte_achat !== undefined &&
    body.qte_achat !== null &&
    body.qte_achat !== ''
  ) {
    const parsedQteAchat =
      typeof body.qte_achat === 'number'
        ? body.qte_achat
        : Number(body.qte_achat)

    if (
      !Number.isFinite(parsedQteAchat) ||
      parsedQteAchat < 0
    ) {
      return NextResponse.json(
        {
          error:
            'La quantité d’achat doit être un nombre supérieur ou égal à 0.',
        },
        { status: 400 }
      )
    }

    qteAchat = parsedQteAchat
  }

  const uniteDemandee =
    body.unite?.trim()
      ? body.unite.trim()
      : 'Pièce'

  if (uniteDemandee.length > 50) {
    return NextResponse.json(
      {
        error:
          'L’unité est trop longue (50 caractères maximum).',
      },
      { status: 400 }
    )
  }

  let ingredientId =
    body.ingredient_id?.trim() || null

  try {
    // Un ajout manuel connu est automatiquement relié au référentiel Mealio.
    // Cela permet ensuite au même moteur de rangement que les recettes de choisir
    // Frosti/Cellio puis l'emplacement physique.
    if (!ingredientId) {
      ingredientId = await resolveManualIngredientId(produit)
    }

    const unite = ingredientId
      ? await assertOfficialIngredientUnit(ingredientId, uniteDemandee)
      : await resolveShoppingUnit(uniteDemandee)
    /*
     * On récupère la liste active du foyer.
     * Le client n'a pas le droit de choisir un list_id.
     */
    const {
      data: activeList,
      error: listError,
    } = await mealioServerDb
      .from('shopping_lists')
      .select(`
        id,
        name,
        status,
        period_start,
        period_end
      `)
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .order('created_at', { ascending: false })
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
            `Impossible de récupérer la liste de courses : ${listError.message}`,
        },
        { status: 500 }
      )
    }

    /*
     * S'il n'existe encore aucune liste active, on en crée une.
     */
    let listId = activeList?.id ?? null

    if (!listId) {
      const {
        data: createdList,
        error: createListError,
      } = await mealioServerDb
        .from('shopping_lists')
        .insert({
          user_id: username,
          name: 'Courses',
          status: 'en_cours',
        })
        .select(`
          id,
          name,
          status,
          period_start,
          period_end
        `)
        .single()

      if (createListError || !createdList) {
        console.error(
          '❌ Erreur création liste de courses :',
          createListError
        )

        return NextResponse.json(
          {
            error:
              createListError?.message ||
              'Impossible de créer la liste de courses.',
          },
          { status: 500 }
        )
      }

      listId = createdList.id
    }

    /*
     * Ajout manuel.
     */
    const {
      data: shoppingItem,
      error: itemError,
    } = await mealioServerDb
      .from('shopping_items')
      .insert({
        list_id: listId,
        produit,
        ingredient_id: ingredientId,
        qte,
        qte_achat: qteAchat,
        qte_achetee: 0,
        unite,
        is_checked: false,
        is_manual: true,
        ai_status: null,
      })
      .select(`
        id,
        list_id,
        produit,
        ingredient_id,
        qte,
        qte_achat,
        qte_achetee,
        stock_stored_quantity,
        unite,
        is_checked,
        is_manual,
        ai_status,
        updated_at
      `)
      .single()

    if (itemError || !shoppingItem) {
      console.error(
        `❌ Erreur ajout manuel "${produit}" :`,
        itemError
      )

      return NextResponse.json(
        {
          error:
            itemError?.message ||
            'Impossible d’ajouter le produit.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json(
      {
        item: normalizeItem(shoppingItem),
        message:
          'Produit ajouté à la liste de courses.',
      },
      { status: 201 }
    )
  } catch (error) {
    console.error(
      '❌ Erreur inattendue POST /api/shopping-list/items :',
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

/**
 * PATCH
 *
 * Permet maintenant de modifier :
 *
 * - is_checked
 * - qte_achat
 * - qte_achetee
 *
 * Toutes les valeurs sont contrôlées côté serveur.
 */
export async function PATCH(request: NextRequest) {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  let body: {
    id?: string
    is_checked?: boolean
    qte_achat?: number | string | null
    qte_achetee?: number | string | null
    expected_updated_at?: string | null
  }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        error:
          'Corps de requête invalide (JSON attendu).',
      },
      { status: 400 }
    )
  }

  const { id } = body

  if (!id) {
    return NextResponse.json(
      {
        error:
          'L’identifiant de l’article est requis.',
      },
      { status: 400 }
    )
  }

  /*
   * Au moins une propriété doit être modifiée.
   */
  const hasIsChecked =
    body.is_checked !== undefined

  const hasQteAchat =
    body.qte_achat !== undefined

  const hasQteAchetee =
    body.qte_achetee !== undefined

  if (
    !hasIsChecked &&
    !hasQteAchat &&
    !hasQteAchetee
  ) {
    return NextResponse.json(
      {
        error:
          'Aucune modification demandée.',
      },
      { status: 400 }
    )
  }

  if (
    hasIsChecked &&
    typeof body.is_checked !== 'boolean'
  ) {
    return NextResponse.json(
      {
        error:
          'is_checked doit être un booléen.',
      },
      { status: 400 }
    )
  }

  let qteAchat: number | undefined

  if (hasQteAchat) {
    if (
      body.qte_achat === null ||
      body.qte_achat === ''
    ) {
      return NextResponse.json(
        {
          error:
            'qte_achat doit être un nombre supérieur ou égal à 0.',
        },
        { status: 400 }
      )
    }

    const parsed =
      typeof body.qte_achat === 'number'
        ? body.qte_achat
        : Number(body.qte_achat)

    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        {
          error:
            'qte_achat doit être un nombre supérieur ou égal à 0.',
        },
        { status: 400 }
      )
    }

    qteAchat = parsed
  }

  let qteAchetee: number | undefined

  if (hasQteAchetee) {
    if (
      body.qte_achetee === null ||
      body.qte_achetee === ''
    ) {
      return NextResponse.json(
        {
          error:
            'qte_achetee doit être un nombre supérieur ou égal à 0.',
        },
        { status: 400 }
      )
    }

    const parsed =
      typeof body.qte_achetee === 'number'
        ? body.qte_achetee
        : Number(body.qte_achetee)

    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        {
          error:
            'qte_achetee doit être un nombre supérieur ou égal à 0.',
        },
        { status: 400 }
      )
    }

    qteAchetee = parsed
  }

  try {
    /*
     * Vérification d'appartenance au foyer.
     *
     * On ne fait jamais confiance au list_id fourni
     * par le navigateur.
     */
    const {
      data: item,
      error: itemError,
    } = await mealioServerDb
      .from('shopping_items')
      .select(`
        id,
        list_id,
        qte,
        qte_achat,
        qte_achetee,
        updated_at,
        shopping_lists!inner (
          id,
          user_id
        )
      `)
      .eq('id', id)
      .eq('shopping_lists.user_id', username)
      .maybeSingle()

    if (itemError) {
      console.error(
        '❌ Erreur vérification shopping_item :',
        itemError
      )

      return NextResponse.json(
        {
          error:
            `Impossible de vérifier l’article : ${itemError.message}`,
        },
        { status: 500 }
      )
    }

    if (!item) {
      return NextResponse.json(
        {
          error:
            'Article introuvable ou non autorisé.',
        },
        { status: 404 }
      )
    }

    /*
     * Concurrence multi-utilisateur : le navigateur transmet la version
     * qu'il affichait. Si elle a changé, on refuse l'écrasement silencieux.
     */
    if (body.expected_updated_at !== undefined && body.expected_updated_at !== null) {
      const expectedUpdatedAt = String(body.expected_updated_at)
      const currentUpdatedAt = item.updated_at ? String(item.updated_at) : null
      if (currentUpdatedAt && expectedUpdatedAt !== currentUpdatedAt) {
        return NextResponse.json(
          {
            error: 'Cet article vient d’être modifié par une autre personne. La liste a été rechargée.',
            code: 'SHOPPING_ITEM_CONFLICT',
          },
          { status: 409 }
        )
      }
    }

    /*
     * Construction de la mise à jour.
     *
     * La quantité réellement achetée reste la source de vérité.
     * Cocher une ligne est un raccourci : si on la coche, on considère
     * l'intégralité de la quantité attendue comme achetée. Décocher ne
     * détruit jamais une quantité réellement saisie.
     */
    const updateData: Record<string, unknown> = {}

    if (hasIsChecked) {
      updateData.is_checked = body.is_checked

      if (body.is_checked === true) {
        const currentBought = Number(item.qte_achetee ?? 0)
        const expected = Number(item.qte_achat ?? item.qte ?? 0)
        if (Number.isFinite(expected) && expected > currentBought) {
          updateData.qte_achetee = expected
        }
      }
    }

    if (hasQteAchat) {
      updateData.qte_achat = qteAchat
    }

    if (hasQteAchetee) {
      updateData.qte_achetee = qteAchetee
    }

    /*
     * Mise à jour.
     */
    let updateQuery = mealioServerDb
      .from('shopping_items')
      .update(updateData)
      .eq('id', id)

    if (body.expected_updated_at !== undefined && body.expected_updated_at !== null) {
      updateQuery = updateQuery.eq('updated_at', String(body.expected_updated_at))
    }

    const {
      data: updatedItem,
      error: updateError,
    } = await updateQuery
      .select(`
        id,
        list_id,
        produit,
        ingredient_id,
        qte,
        qte_achat,
        qte_achetee,
        stock_stored_quantity,
        unite,
        is_checked,
        is_manual,
        ai_status,
        updated_at
      `)
      .single()

    if (updateError || !updatedItem) {
      if (!updateError && body.expected_updated_at !== undefined && body.expected_updated_at !== null) {
        return NextResponse.json(
          {
            error: 'Cet article vient d’être modifié par une autre personne. La liste a été rechargée.',
            code: 'SHOPPING_ITEM_CONFLICT',
          },
          { status: 409 }
        )
      }

      console.error(
        '❌ Erreur mise à jour shopping_item :',
        updateError
      )

      return NextResponse.json(
        {
          error:
            updateError?.message ||
            'Impossible de mettre à jour l’article.',
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      item: normalizeItem(updatedItem),
      message: 'Article mis à jour.',
    })
  } catch (error) {
    console.error(
      '❌ Erreur inattendue PATCH /api/shopping-list/items :',
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

/**
 * DELETE
 * Supprime un article de la liste active du foyer.
 * Une ligne déjà achetée/rangée ne peut pas être supprimée afin de préserver
 * l'historique et l'intégrité du stock.
 */
export async function DELETE(request: NextRequest) {
  const username = await getUsername()
  if (!username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  let body: { id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps de requête invalide (JSON attendu).' }, { status: 400 })
  }

  const id = body.id?.trim()
  if (!id) {
    return NextResponse.json({ error: 'L’identifiant de l’article est requis.' }, { status: 400 })
  }

  try {
    const { data: item, error: itemError } = await mealioServerDb
      .from('shopping_items')
      .select(`id, produit, qte_achetee, stock_stored_quantity, shopping_lists!inner(id,user_id,status)`)
      .eq('id', id)
      .eq('shopping_lists.user_id', username)
      .eq('shopping_lists.status', 'en_cours')
      .maybeSingle()

    if (itemError) {
      return NextResponse.json({ error: `Impossible de vérifier l’article : ${itemError.message}` }, { status: 500 })
    }
    if (!item) {
      return NextResponse.json({ error: 'Article introuvable ou non présent dans la liste active.' }, { status: 404 })
    }

    const bought = Number(item.qte_achetee ?? 0)
    const stored = Number(item.stock_stored_quantity ?? 0)
    if ((Number.isFinite(bought) && bought > 0) || (Number.isFinite(stored) && stored > 0)) {
      return NextResponse.json({
        error: `Impossible de supprimer « ${item.produit} » : une quantité a déjà été achetée ou rangée.`,
      }, { status: 409 })
    }

    const { error: deleteError } = await mealioServerDb
      .from('shopping_items')
      .delete()
      .eq('id', id)

    if (deleteError) {
      return NextResponse.json({ error: `Impossible de supprimer « ${item.produit} » : ${deleteError.message}` }, { status: 500 })
    }

    return NextResponse.json({ success: true, deletedId: id, message: `« ${item.produit} » a été supprimé de la liste.` })
  } catch (error) {
    console.error('❌ Erreur DELETE /api/shopping-list/items', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}
