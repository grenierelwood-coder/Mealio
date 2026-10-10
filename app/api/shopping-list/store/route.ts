import {storePurchaseLot,storedQuantityFor} from '../../../utils/purchase-storage-server'
import {assertSameOrigin} from '../../../utils/ecosystem-policy'
import { getAuthSession } from '../../../utils/auth-server'
import { NextResponse } from 'next/server'
import { assertOfficialIngredientUnit } from '../../../utils/official-unit-policy'

import {
  mealioServerDb,
  frostiServerDb,
  cellioServerDb,
} from '../../../lib/supabase-server'
import {
  createHouseholdStockItem, operationUuid,
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


export async function POST(request?:Request) {
  try {
    if(request)assertSameOrigin(request)
    const username = (await getAuthSession())?.username?.trim()

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
      storedByItem.set(item.id, storedQuantityFor(item,transfers))
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
        // Défense en profondeur : un historique d'achat officiel ne peut pas
        // être créé avec une unité différente de la référence Mealio.
        if (item.ingredient_id) {
          await assertOfficialIngredientUnit(item.ingredient_id, item.unite)
        }

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

        const receipt=await storePurchaseLot(username,item,ingredient,storage,location)
        const stockItemId=receipt.stock_item_id
        const newStoredQuantity=receipt.stored_quantity
        await persistPurchaseState(item,boughtQuantity,newStoredQuantity)
        storedByItem.set(item.id, newStoredQuantity)

        if (pendingPurchaseEventId) {
          const { error: purchaseUpdateError } = await mealioServerDb
            .from('shopping_purchase_events')
            .update({
              status: 'range',
              storage:receipt.source,
              location_name:receipt.location_name,
            })
            .eq('id', pendingPurchaseEventId)

          if (purchaseUpdateError) {
            console.warn('⚠️ Achat rangé mais historique non enrichi :', purchaseUpdateError.message)
          }
        }

        storedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          qte: receipt.quantity,
          unite: item.unite?.trim() || 'pièce(s)',
          storage:receipt.source,
          stock_item_id: stockItemId ?? '',
          location_id: receipt.location_id,
          location_name: receipt.location_name,
          rule_label: receipt.rule_label,
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
