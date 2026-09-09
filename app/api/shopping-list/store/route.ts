import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import {
  mealioServerDb,
  frostiServerDb,
  cellioServerDb,
} from '../../../lib/supabase-server'
import {
  createHouseholdStockItem,
  resolveHousehold,
} from '../../../utils/household-server'
import {
  resolveStorageLocation,
  type StorageSource,
} from '../../../utils/storage-routing-server'

interface ShoppingItemRow {
  id: string
  produit: string
  ingredient_id: string | null
  qte: number | null
  qte_achat: number | null
  qte_achetee: number | null
  stock_stored_quantity: number | null
  unite: string | null
  is_checked: boolean | null
}

interface OfficialIngredientRow {
  id: string
  nom: string
  categorie: string | null
  default_storage: string | null
  default_is_fridge: boolean | null
}

interface StoredItem {
  shopping_item_id: string
  produit: string
  qte: number
  unite: string
  storage: StorageSource
  stock_item_id: string
  location_id: string
  location_name: string
  rule_label: string
}

interface SkippedItem {
  shopping_item_id: string
  produit: string
  reason: string
}

interface PurchaseEventRow {
  id: string
  shopping_item_id: string
  quantity: number | null
  status: string
}

interface TransferRow {
  shopping_item_id: string
  stock_item_id: string | null
  storage: StorageSource | null
  location_id: string | null
  location_name: string | null
  rule_label: string | null
  quantity: number | null
  operation_key: string | null
  status: string | null
  attempted_at: string | null
}

function normalizeStorage(value: string | null | undefined): StorageSource | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'frosti') return 'frosti'
  if (normalized === 'cellio') return 'cellio'
  return null
}

function numberOrZero(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

/**
 * Quantité effectivement achetée.
 *
 * qte_achetee est la source normale.
 * Le fallback sur la coche ne sert qu'à compatibiliser les anciennes données
 * où l'utilisateur avait coché un article sans que qte_achetee soit remplie.
 */
function getBoughtQuantity(item: ShoppingItemRow): number {
  // qte_achetee est la seule source de vérité métier.
  // Une ancienne coche ne doit jamais créer artificiellement un achat.
  return numberOrZero(item.qte_achetee)
}

function getRequiredQuantity(item: ShoppingItemRow): number {
  return numberOrZero(item.qte)
}

function sumPurchasedEvents(itemId: string, events: PurchaseEventRow[]): number {
  return events
    .filter(row => row.shopping_item_id === itemId)
    .reduce((sum, row) => sum + numberOrZero(row.quantity), 0)
}

function sumTransferred(itemId: string, transfers: TransferRow[]): number {
  return transfers
    .filter(row => row.shopping_item_id === itemId)
    .reduce((sum, row) => sum + numberOrZero(row.quantity), 0)
}

async function persistPurchaseState(
  item: ShoppingItemRow,
  boughtQuantity: number,
  storedQuantity: number,
): Promise<void> {
  const required = getRequiredQuantity(item)
  const fullyBought = required > 0 && boughtQuantity >= required

  const update: Record<string, unknown> = {
    qte_achetee: boughtQuantity,
    stock_stored_quantity: storedQuantity,
    // La coche n'est plus la source de vérité : elle reflète maintenant
    // uniquement le fait que le besoin est entièrement couvert.
    is_checked: fullyBought,
  }

  const { error } = await mealioServerDb
    .from('shopping_items')
    .update(update)
    .eq('id', item.id)

  if (error) {
    throw new Error(`Impossible de mettre à jour l'état de "${item.produit}" : ${error.message}`)
  }
}


function buildStorageOperationKey(itemId: string, storedQuantity: number, delta: number): string {
  return `mealio:${itemId}:from:${storedQuantity}:to:${storedQuantity + delta}`
}

async function findExistingStockByOperationKey(
  storage: StorageSource,
  userId: string,
  operationKey: string,
): Promise<string | null> {
  const db = storage === 'frosti' ? frostiServerDb : cellioServerDb
  const { data, error } = await db
    .from('items')
    .select('id')
    .eq('user_id', userId)
    .eq('notes', operationKey)
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(`Impossible de vérifier un rangement existant dans ${storage} : ${error.message}`)
  }
  return data?.id ?? null
}

async function claimStorageOperation(args: {
  itemId: string
  operationKey: string
  storage: StorageSource
  locationId: string
  locationName: string
  ruleLabel: string
  quantity: number
}): Promise<{ acquired: boolean; transfer: TransferRow | null }> {
  const { data, error } = await mealioServerDb
    .from('shopping_item_stock_transfers')
    .insert({
      shopping_item_id: args.itemId,
      operation_key: args.operationKey,
      storage: args.storage,
      location_id: args.locationId,
      location_name: args.locationName,
      rule_label: args.ruleLabel,
      quantity: args.quantity,
      status: 'pending',
      attempted_at: new Date().toISOString(),
    })
    .select('shopping_item_id,stock_item_id,storage,location_id,location_name,rule_label,quantity,operation_key,status,attempted_at')
    .single()

  if (!error && data) return { acquired: true, transfer: data as TransferRow }

  // Une autre requête traite déjà exactement le même mouvement.
  if (error?.code === '23505') {
    const { data: existing, error: readError } = await mealioServerDb
      .from('shopping_item_stock_transfers')
      .select('shopping_item_id,stock_item_id,storage,location_id,location_name,rule_label,quantity,operation_key,status,attempted_at')
      .eq('operation_key', args.operationKey)
      .maybeSingle()

    if (readError) throw new Error(`Impossible de relire le verrou de rangement : ${readError.message}`)
    return { acquired: false, transfer: (existing as TransferRow | null) ?? null }
  }

  throw new Error(`Impossible de réserver l'opération de rangement : ${error?.message ?? 'erreur inconnue'}`)
}

export async function POST() {
  try {
    const cookieStore = await cookies()
    const username = cookieStore.get('congelo_username')?.value?.trim()

    if (!username) {
      return NextResponse.json({ error: 'Utilisateur non authentifié.' }, { status: 401 })
    }

    const household = await resolveHousehold(username)

    if (!household.frostiUserId && !household.cellioUserId) {
      return NextResponse.json(
        { error: `Utilisateur "${username}" introuvable dans Frosti et Cellio.` },
        { status: 404 },
      )
    }

    const { data: shoppingLists, error: listError } = await mealioServerDb
      .from('shopping_lists')
      .select('id,created_at,user_id,name,status,period_start,period_end')
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .order('created_at', { ascending: false })
      .limit(2)

    if (listError) {
      throw new Error(`Erreur lecture liste de courses : ${listError.message}`)
    }

    if (!shoppingLists || shoppingLists.length === 0) {
      return NextResponse.json({ error: 'Aucune liste de courses active.' }, { status: 404 })
    }

    if (shoppingLists.length > 1) {
      return NextResponse.json(
        { error: 'Plusieurs listes de courses actives existent encore pour ce foyer. Exécute la migration Phase 15 avant de poursuivre.' },
        { status: 409 },
      )
    }

    const shoppingList = shoppingLists[0]

    const { data: shoppingItems, error: itemsError } = await mealioServerDb
      .from('shopping_items')
      .select(`id,produit,ingredient_id,qte,qte_achat,qte_achetee,stock_stored_quantity,unite,is_checked`)
      .eq('list_id', shoppingList.id)

    if (itemsError) {
      throw new Error(`Erreur lecture articles de courses : ${itemsError.message}`)
    }

    const items = (shoppingItems ?? []) as ShoppingItemRow[]
    const boughtItems = items.filter(item => getBoughtQuantity(item) > 0)

    if (boughtItems.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Aucun article acheté à ranger.',
        stored: [],
        skipped: [],
        totalStored: 0,
        totalSkipped: 0,
      })
    }

    const { data: existingTransfers, error: transferReadError } = await mealioServerDb
      .from('shopping_item_stock_transfers')
      .select('shopping_item_id,stock_item_id,storage,location_id,location_name,rule_label,quantity,operation_key,status,attempted_at')
      .in('shopping_item_id', boughtItems.map(item => item.id))

    if (transferReadError) {
      throw new Error(`Erreur lecture des transferts de stock : ${transferReadError.message}`)
    }

    const transfers = (existingTransfers ?? []) as TransferRow[]

    const { data: existingPurchaseEvents, error: purchaseReadError } = await mealioServerDb
      .from('shopping_purchase_events')
      .select('id,shopping_item_id,quantity,status')
      .in('shopping_item_id', boughtItems.map(item => item.id))
      .order('purchased_at', { ascending: false })

    if (purchaseReadError) {
      throw new Error(`Erreur lecture de l’historique des achats : ${purchaseReadError.message}`)
    }

    const purchaseEvents = (existingPurchaseEvents ?? []) as PurchaseEventRow[]
    const storedByItem = new Map<string, number>()
    const purchaseEventByItem = new Map<string, PurchaseEventRow[]>()
    for (const event of purchaseEvents) {
      const list = purchaseEventByItem.get(event.shopping_item_id) ?? []
      list.push(event)
      purchaseEventByItem.set(event.shopping_item_id, list)
    }

    for (const item of boughtItems) {
      const fromJournal = sumTransferred(item.id, transfers)
      const fromItem = numberOrZero(item.stock_stored_quantity)
      // Le journal est la preuve la plus fiable. Le champ persistant permet
      // de retrouver l'état rapidement ; on prend le maximum pour réparer
      // une éventuelle écriture interrompue sans diminuer une quantité déjà
      // rangée.
      storedByItem.set(item.id, Math.max(fromJournal, fromItem))
    }

    const ingredientIds = Array.from(
      new Set(
        boughtItems
          .map(item => item.ingredient_id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
      ),
    )

    const { data: officialIngredients, error: ingredientsError } = ingredientIds.length
      ? await mealioServerDb
          .from('official_ingredients')
          .select('id,nom,categorie,default_storage,default_is_fridge')
          .in('id', ingredientIds)
      : { data: [], error: null }

    if (ingredientsError) {
      throw new Error(`Erreur lecture ingrédients officiels : ${ingredientsError.message}`)
    }

    const ingredientMap = new Map<string, OfficialIngredientRow>()
    for (const ingredient of (officialIngredients ?? []) as OfficialIngredientRow[]) {
      ingredientMap.set(ingredient.id, ingredient)
    }

    const storedItems: StoredItem[] = []
    const skippedItems: SkippedItem[] = []

    async function recordStorageIssue(item: ShoppingItemRow, reason: string) {
      await mealioServerDb
        .from('shopping_issues')
        .update({ status: 'resolved', resolved_at: new Date().toISOString() })
        .eq('shopping_item_id', item.id)
        .eq('phase', 'storage')
        .eq('status', 'open')

      const hint = reason.includes('Aucun ingrédient officiel')
        ? 'Associer l’article à un ingrédient officiel dans Courses, puis relancer le rangement.'
        : reason.includes('stockage par défaut')
          ? 'Dans Mealio → official_ingredients, renseigner default_storage (frosti ou cellio), puis relancer le rangement.'
          : reason.includes('règle de rangement')
            ? 'Dans Mealio → Rangement, créer/activer une règle correspondant à la catégorie ou à l’ingrédient.'
            : 'Corriger le problème indiqué puis relancer le rangement.'

      const { error } = await mealioServerDb.from('shopping_issues').insert({
        list_id: shoppingList.id,
        shopping_item_id: item.id,
        phase: 'storage',
        issue_type: 'STORAGE_BLOCKED',
        produit: item.produit,
        unit: item.unite,
        message: reason,
        resolution_hint: hint,
        status: 'open',
      })
      if (error) console.warn('⚠️ Impossible de journaliser le problème de rangement :', error.message)
    }

    for (const item of boughtItems) {
      const boughtQuantity = getBoughtQuantity(item)
      const storedQuantity = storedByItem.get(item.id) ?? 0
      const delta = Math.max(boughtQuantity - storedQuantity, 0)

      // Journal d'achat indépendant du rangement : on enregistre toute nouvelle
      // quantité achetée, même si le produit ne peut pas encore être rangé.
      const alreadyLoggedPurchase = sumPurchasedEvents(
        item.id,
        purchaseEventByItem.get(item.id) ?? [],
      )
      const purchaseDelta = Math.max(boughtQuantity - alreadyLoggedPurchase, 0)
      let pendingPurchaseEventId: string | null = null

      if (purchaseDelta > 0) {
        const { data: purchaseEvent, error: purchaseInsertError } = await mealioServerDb
          .from('shopping_purchase_events')
          .insert({
            list_id: shoppingList.id,
            shopping_item_id: item.id,
            produit: item.produit,
            ingredient_id: item.ingredient_id,
            quantity: purchaseDelta,
            unite: item.unite?.trim() || 'Pièce',
            purchased_at: new Date().toISOString(),
            status: delta > 0 ? 'a_ranger' : 'range',
          })
          .select('id,shopping_item_id,quantity,status')
          .single()

        if (purchaseInsertError || !purchaseEvent) {
          throw new Error(`Impossible d’enregistrer l’achat de "${item.produit}" dans l’historique : ${purchaseInsertError?.message ?? 'événement non créé.'}`)
        }

        pendingPurchaseEventId = purchaseEvent.id
      }

      // Rien de nouveau à ranger. On resynchronise simplement l'état Mealio.
      if (delta <= 0) {
        if (pendingPurchaseEventId) {
          await mealioServerDb
            .from('shopping_purchase_events')
            .update({ status: 'range' })
            .eq('id', pendingPurchaseEventId)
        }
        await persistPurchaseState(item, boughtQuantity, storedQuantity)
        continue
      }

      if (!item.ingredient_id) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Aucun ingrédient officiel associé.',
        })
        await recordStorageIssue(item, 'Aucun ingrédient officiel associé.')
        continue
      }

      const ingredient = ingredientMap.get(item.ingredient_id)
      if (!ingredient) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Ingrédient officiel introuvable.',
        })
        await recordStorageIssue(item, 'Ingrédient officiel introuvable.')
        continue
      }

      const storage = normalizeStorage(ingredient.default_storage)
      if (!storage) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: `Aucun stockage par défaut défini pour "${ingredient.nom}".`,
        })
        await recordStorageIssue(item, `Aucun stockage par défaut défini pour "${ingredient.nom}".`)
        continue
      }

      if (storage === 'frosti' && !household.frostiUserId) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Le stockage Frosti est requis mais ce foyer ne possède pas de compte Frosti.',
        })
        await recordStorageIssue(item, 'Le stockage Frosti est requis mais ce foyer ne possède pas de compte Frosti.')
        continue
      }

      if (storage === 'cellio' && !household.cellioUserId) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Le stockage Cellio est requis mais ce foyer ne possède pas de compte Cellio.',
        })
        await recordStorageIssue(item, 'Le stockage Cellio est requis mais ce foyer ne possède pas de compte Cellio.')
        continue
      }

      try {
        const location = await resolveStorageLocation(
          storage,
          storage === 'frosti' ? household.frostiUserId! : household.cellioUserId!,
          ingredient,
        )

        if (!location) {
          skippedItems.push({
            shopping_item_id: item.id,
            produit: item.produit,
            reason: `Aucune règle de rangement active ne permet de déterminer l'emplacement ${storage} pour "${ingredient.nom}".`,
          })
        await recordStorageIssue(item, `Aucune règle de rangement active ne permet de déterminer l'emplacement ${storage} pour "${ingredient.nom}".`)
          continue
        }

        // Une opération est identifiée par son point de départ et son point d'arrivée.
        // Deux navigateurs qui tentent exactement le même rangement obtiennent
        // donc le même operation_key et un seul peut créer le stock.
        const operationKey = buildStorageOperationKey(item.id, storedQuantity, delta)
        const claim = await claimStorageOperation({
          itemId: item.id,
          operationKey,
          storage,
          locationId: location.location_id,
          locationName: location.location_name,
          ruleLabel: location.rule_label,
          quantity: delta,
        })

        if (!claim.acquired) {
          const existing = claim.transfer
          if (existing?.status === 'completed' && existing.stock_item_id) {
            const newStoredQuantity = storedQuantity + delta
            await persistPurchaseState(item, boughtQuantity, newStoredQuantity)
            storedByItem.set(item.id, newStoredQuantity)
            continue
          }

          // Une autre requête possède le verrou. On ne crée surtout pas un
          // deuxième article de stock. Le prochain clic/réessai reprendra si
          // l'opération n'est pas encore terminée.
          skippedItems.push({
            shopping_item_id: item.id,
            produit: item.produit,
            reason: 'Le rangement de cet achat est déjà en cours par un autre utilisateur. Réessayez dans quelques secondes.',
          })
          continue
        }

        let stockItemId = claim.transfer?.stock_item_id ?? null

        // Reprise après panne : le stock peut avoir été créé avant que le journal
        // Mealio ait pu être finalisé. Le marqueur déterministe dans notes permet
        // de retrouver cet article sans en créer un second.
        if (!stockItemId) {
          const targetUserId = storage === 'frosti' ? household.frostiUserId! : household.cellioUserId!
          stockItemId = await findExistingStockByOperationKey(storage, targetUserId, operationKey)
        }

        if (!stockItemId) {
          const stockItem = await createHouseholdStockItem(username, {
            source: storage,
            produit: item.produit,
            qte: delta,
            unite: item.unite?.trim() || 'pièce(s)',
            categorie: ingredient.categorie?.trim() || 'Autre',
            date_entree: new Date().toISOString().slice(0, 10),
            date_peremption: undefined,
            notes: operationKey,
            congelo_id: storage === 'frosti' ? location.location_id : undefined,
            cellar_id: storage === 'cellio' ? location.location_id : undefined,
          })
          stockItemId = stockItem.id
        }

        const { error: transferUpdateError } = await mealioServerDb
          .from('shopping_item_stock_transfers')
          .update({
            stock_item_id: stockItemId,
            status: 'completed',
            attempted_at: new Date().toISOString(),
          })
          .eq('operation_key', operationKey)

        if (transferUpdateError) {
          throw new Error(`Stock créé mais journal de transfert impossible à finaliser : ${transferUpdateError.message}`)
        }

        const newStoredQuantity = storedQuantity + delta
        await persistPurchaseState(item, boughtQuantity, newStoredQuantity)
        storedByItem.set(item.id, newStoredQuantity)

        if (pendingPurchaseEventId) {
          const { error: purchaseUpdateError } = await mealioServerDb
            .from('shopping_purchase_events')
            .update({
              status: 'range',
              storage,
              location_name: location.location_name,
            })
            .eq('id', pendingPurchaseEventId)

          if (purchaseUpdateError) {
            console.warn('⚠️ Achat rangé mais historique non enrichi :', purchaseUpdateError.message)
          }
        }

        storedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          qte: delta,
          unite: item.unite?.trim() || 'pièce(s)',
          storage,
          stock_item_id: stockItem.id,
          location_id: location.location_id,
          location_name: location.location_name,
          rule_label: location.rule_label,
        })
      } catch (error) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: error instanceof Error ? error.message : 'Erreur lors du rangement dans le stock.',
        })
        await recordStorageIssue(item, error instanceof Error ? error.message : 'Erreur lors du rangement dans le stock.')
      }
    }

    let message = 'Produits achetés traités.'
    if (storedItems.length === 0 && skippedItems.length > 0) {
      message = 'Aucun produit acheté n’a pu être rangé automatiquement.'
    } else if (skippedItems.length > 0) {
      message = `${storedItems.length} article(s) rangé(s). ${skippedItems.length} article(s) nécessitent encore une action.`
    } else if (storedItems.length > 0) {
      message = `${storedItems.length} article(s) rangé(s) dans les stocks.`
    }

    return NextResponse.json({
      success: true,
      message,
      list: shoppingList,
      stored: storedItems,
      skipped: skippedItems,
      totalStored: storedItems.length,
      totalSkipped: skippedItems.length,
    })
  } catch (error) {
    console.error('❌ POST /api/shopping-list/store', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Erreur inconnue lors du rangement des courses.',
      },
      { status: 500 },
    )
  }
}
