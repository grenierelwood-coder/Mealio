import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import { mealioServerDb } from '../../../lib/supabase-server'
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

interface TransferRow {
  shopping_item_id: string
  stock_item_id: string | null
  storage: StorageSource | null
  location_id: string | null
  location_name: string | null
  rule_label: string | null
}

function normalizeStorage(value: string | null | undefined): StorageSource | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'frosti') return 'frosti'
  if (normalized === 'cellio') return 'cellio'
  return null
}

function getBoughtQuantity(item: ShoppingItemRow): number {
  const bought = Number(item.qte_achetee ?? 0)
  if (Number.isFinite(bought) && bought > 0) return bought

  if (item.is_checked) {
    const purchaseQuantity = Number(item.qte_achat ?? item.qte ?? 0)
    if (Number.isFinite(purchaseQuantity) && purchaseQuantity > 0) {
      return purchaseQuantity
    }
  }

  return 0
}

function isQuantityFullyPurchased(item: ShoppingItemRow): boolean {
  const required = Number(item.qte ?? 0)
  const bought = getBoughtQuantity(item)

  return Number.isFinite(required) && required > 0 && bought >= required
}

async function markStoredItemAsCompleted(item: ShoppingItemRow): Promise<void> {
  // A product that has actually been bought in sufficient quantity is
  // considered completed at the shopping-list level too. This is persisted
  // in Mealio so that a page reload does not bring the already-ranged item
  // back into the active shopping list.
  if (!isQuantityFullyPurchased(item)) return
  if (item.is_checked === true) return

  const { error } = await mealioServerDb
    .from('shopping_items')
    .update({ is_checked: true })
    .eq('id', item.id)

  if (error) {
    throw new Error(`Article rangé mais impossible de clôturer son statut courses : ${error.message}`)
  }
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

    const { data: shoppingList, error: listError } = await mealioServerDb
      .from('shopping_lists')
      .select(`id,created_at,user_id,name,status,period_start,period_end`)
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (listError) {
      throw new Error(`Erreur lecture liste de courses : ${listError.message}`)
    }

    if (!shoppingList) {
      return NextResponse.json({ error: 'Aucune liste de courses active.' }, { status: 404 })
    }

    const { data: shoppingItems, error: itemsError } = await mealioServerDb
      .from('shopping_items')
      .select(`id,produit,ingredient_id,qte,qte_achat,qte_achetee,unite,is_checked`)
      .eq('list_id', shoppingList.id)

    if (itemsError) {
      throw new Error(`Erreur lecture articles de courses : ${itemsError.message}`)
    }

    const items = (shoppingItems ?? []) as ShoppingItemRow[]
    const boughtItems = items.filter(
      item => item.is_checked === true || Number(item.qte_achetee ?? 0) > 0,
    )

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
      .select('shopping_item_id,stock_item_id,storage,location_id,location_name,rule_label')
      .in('shopping_item_id', boughtItems.map(item => item.id))

    if (transferReadError) {
      throw new Error(`Erreur lecture des transferts de stock : ${transferReadError.message}`)
    }

    const transferMap = new Map<string, TransferRow>()
    for (const row of (existingTransfers ?? []) as TransferRow[]) {
      transferMap.set(row.shopping_item_id, row)
    }

    const alreadyStored = boughtItems.filter(item => transferMap.has(item.id))
    const pendingBoughtItems = boughtItems.filter(item => !transferMap.has(item.id))

    const skippedItems: SkippedItem[] = []
    const routableItems = pendingBoughtItems.filter(item => {
      if (!item.ingredient_id) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Aucun ingrédient officiel associé.',
        })
        return false
      }
      return true
    })

    const ingredientIds = Array.from(
      new Set(
        routableItems
          .map(item => item.ingredient_id)
          .filter((id): id is string => typeof id === 'string' && id.trim().length > 0),
      ),
    )

    if (ingredientIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: skippedItems.length
          ? `${skippedItems.length} article(s) acheté(s) ne possèdent pas d'ingrédient officiel et n'ont pas été rangé(s) automatiquement.`
          : 'Aucun article ne peut être rangé automatiquement.',
        stored: [],
        skipped: skippedItems,
        totalStored: 0,
        totalSkipped: skippedItems.length,
      })
    }

    const { data: officialIngredients, error: ingredientsError } = await mealioServerDb
      .from('official_ingredients')
      .select(`id,nom,categorie,default_storage,default_is_fridge`)
      .in('id', ingredientIds)

    if (ingredientsError) {
      throw new Error(`Erreur lecture ingrédients officiels : ${ingredientsError.message}`)
    }

    const ingredientMap = new Map<string, OfficialIngredientRow>()
    for (const ingredient of (officialIngredients ?? []) as OfficialIngredientRow[]) {
      ingredientMap.set(ingredient.id, ingredient)
    }

    const storedItems: StoredItem[] = []

    for (const item of alreadyStored) {
      const transfer = transferMap.get(item.id)!
      if (transfer.stock_item_id && transfer.storage && transfer.location_id) {
        await markStoredItemAsCompleted(item)
        storedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          qte: getBoughtQuantity(item),
          unite: item.unite?.trim() || 'Pièce',
          storage: transfer.storage,
          stock_item_id: transfer.stock_item_id,
          location_id: transfer.location_id,
          location_name: transfer.location_name ?? 'emplacement déjà enregistré',
          rule_label: transfer.rule_label ?? 'Déjà rangé',
        })
      }
    }

    for (const item of routableItems) {
      const ingredient = ingredientMap.get(item.ingredient_id!)

      if (!ingredient) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Ingrédient officiel introuvable.',
        })
        continue
      }

      const storage = normalizeStorage(ingredient.default_storage)
      if (!storage) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: `Aucun stockage par défaut défini pour "${ingredient.nom}".`,
        })
        continue
      }

      if (storage === 'frosti' && !household.frostiUserId) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Le stockage Frosti est requis mais ce foyer ne possède pas de compte Frosti.',
        })
        continue
      }

      if (storage === 'cellio' && !household.cellioUserId) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Le stockage Cellio est requis mais ce foyer ne possède pas de compte Cellio.',
        })
        continue
      }

      const quantity = getBoughtQuantity(item)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        skippedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          reason: 'Quantité achetée invalide ou nulle.',
        })
        continue
      }

      try {
        // Mealio choisit Frosti ou Cellio via official_ingredients.
        // L'application cible choisit ensuite l'emplacement physique via ses propres règles.
        const location = await resolveStorageLocation(storage, storage === 'frosti'
          ? household.frostiUserId!
          : household.cellioUserId!, ingredient)

        if (!location) {
          skippedItems.push({
            shopping_item_id: item.id,
            produit: item.produit,
            reason: `Aucune règle de rangement active ne permet de déterminer l'emplacement ${storage} pour "${ingredient.nom}".`,
          })
          continue
        }

        const stockItem = await createHouseholdStockItem(username, {
          source: storage,
          produit: item.produit,
          qte: quantity,
          unite: item.unite?.trim() || 'pièce(s)',
          categorie: ingredient.categorie?.trim() || 'Autre',
          date_entree: new Date().toISOString().slice(0, 10),
          congelo_id: storage === 'frosti' ? location.location_id : undefined,
          cellar_id: storage === 'cellio' ? location.location_id : undefined,
        })

        const { error: transferInsertError } = await mealioServerDb
          .from('shopping_item_stock_transfers')
          .insert({
            shopping_item_id: item.id,
            stock_item_id: stockItem.id,
            storage,
            location_id: location.location_id,
            location_name: location.location_name,
            rule_label: location.rule_label,
          })

        if (transferInsertError) {
          throw new Error(`Article rangé mais journal de transfert impossible à enregistrer : ${transferInsertError.message}`)
        }

        await markStoredItemAsCompleted(item)

        storedItems.push({
          shopping_item_id: item.id,
          produit: item.produit,
          qte: quantity,
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
          reason: error instanceof Error
            ? error.message
            : 'Erreur lors du rangement dans le stock.',
        })
      }
    }

    let message = 'Produits achetés rangés dans les stocks.'
    if (storedItems.length === 0 && skippedItems.length > 0) {
      message = 'Aucun produit acheté n’a pu être rangé automatiquement.'
    } else if (skippedItems.length > 0) {
      message = `${storedItems.length} article(s) rangé(s) dans les stocks. ${skippedItems.length} article(s) non rangé(s) automatiquement.`
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
        error: error instanceof Error
          ? error.message
          : 'Erreur inconnue lors du rangement des courses.',
      },
      { status: 500 },
    )
  }
}
