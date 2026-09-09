import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'

import {
  mealioServerDb,
  frostiServerDb,
  cellioServerDb,
} from '../../../../lib/supabase-server'
import { createHouseholdStockItem, resolveHousehold } from '../../../../utils/household-server'
import { resolveStorageLocation, type StorageSource } from '../../../../utils/storage-routing-server'

interface IssueRow {
  id: string
  list_id: string
  shopping_item_id: string
  produit: string
  unit: string | null
  message: string
  resolution_hint: string | null
  status: string
  created_at: string | null
  resolved_at: string | null
}

interface ShoppingItemRow {
  id: string
  list_id: string
  produit: string
  ingredient_id: string | null
  qte: number | null
  qte_achetee: number | null
  stock_stored_quantity: number | null
  unite: string | null
  is_checked: boolean | null
}

interface IngredientRow {
  id: string
  nom: string
  categorie: string | null
  default_storage: string | null
  default_is_fridge: boolean | null
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

interface PurchaseEventRow {
  id: string
  shopping_item_id: string
  quantity: number | null
  status: string
}

function numberOrZero(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

function normalizeStorage(value: string | null | undefined): StorageSource | null {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'frosti') return 'frosti'
  if (normalized === 'cellio') return 'cellio'
  return null
}

function buildStorageOperationKey(itemId: string, storedQuantity: number, delta: number): string {
  return `mealio:${itemId}:from:${storedQuantity}:to:${storedQuantity + delta}`
}

function sumTransferred(itemId: string, transfers: TransferRow[]): number {
  return transfers
    .filter(row => row.shopping_item_id === itemId)
    .reduce((sum, row) => sum + numberOrZero(row.quantity), 0)
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

async function updateIssue(issueId: string, values: Record<string, unknown>) {
  const { error } = await mealioServerDb
    .from('shopping_issues')
    .update(values)
    .eq('id', issueId)
  if (error) throw new Error(`Impossible de mettre à jour le problème de rangement : ${error.message}`)
}

async function processIssue(
  issue: IssueRow,
  item: ShoppingItemRow,
  ingredient: IngredientRow | null,
  transfers: TransferRow[],
  purchaseEvents: PurchaseEventRow[],
  username: string,
  household: Awaited<ReturnType<typeof resolveHousehold>>,
): Promise<{ ok: boolean; produit: string; message: string; destination?: { storage: StorageSource; location_name: string; rule_label: string } }> {
  const boughtQuantity = numberOrZero(item.qte_achetee)
  const storedQuantity = Math.max(
    numberOrZero(item.stock_stored_quantity),
    sumTransferred(item.id, transfers),
  )
  const delta = Math.max(boughtQuantity - storedQuantity, 0)

  if (delta <= 0) {
    await mealioServerDb
      .from('shopping_items')
      .update({
        stock_stored_quantity: storedQuantity,
        is_checked: numberOrZero(item.qte) > 0 && boughtQuantity >= numberOrZero(item.qte),
      })
      .eq('id', item.id)

    await mealioServerDb
      .from('shopping_purchase_events')
      .update({ status: 'range' })
      .eq('shopping_item_id', item.id)
      .eq('status', 'a_ranger')

    await updateIssue(issue.id, { status: 'resolved', resolved_at: new Date().toISOString() })
    return { ok: true, produit: item.produit, message: 'Article déjà entièrement rangé.' }
  }

  if (!ingredient) {
    const message = 'Aucun ingrédient officiel associé à cet article.'
    await updateIssue(issue.id, {
      message,
      resolution_hint: 'Associer l’article à un ingrédient officiel dans Courses, puis relancer le rangement.',
    })
    return { ok: false, produit: item.produit, message }
  }

  const storage = normalizeStorage(ingredient.default_storage)
  if (!storage) {
    const message = `Aucun stockage par défaut défini pour « ${ingredient.nom} ».`
    await updateIssue(issue.id, {
      message,
      resolution_hint: 'Dans le référentiel ingrédients, renseigner le stockage par défaut, puis relancer le rangement.',
    })
    return { ok: false, produit: item.produit, message }
  }

  const storageUserId = storage === 'frosti' ? household.frostiUserId : household.cellioUserId
  if (!storageUserId) {
    const message = `Le stockage ${storage} est requis mais ce foyer ne possède pas de compte ${storage}.`
    await updateIssue(issue.id, {
      message,
      resolution_hint: `Associer le foyer à ${storage}, puis relancer le rangement.`,
    })
    return { ok: false, produit: item.produit, message }
  }

  try {
    // SOURCE UNIQUE DE LA DÉCISION DE RANGEMENT : le moteur existant.
    const location = await resolveStorageLocation(storage, storageUserId, ingredient)

    if (!location) {
      const message = `Aucune règle de rangement active ne permet de déterminer l’emplacement ${storage} pour « ${ingredient.nom} ».`
      await updateIssue(issue.id, {
        message,
        resolution_hint: 'Créer ou activer la règle correspondante dans Admin → Règles de rangement, puis relancer.',
      })
      return { ok: false, produit: item.produit, message }
    }

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
      if (claim.transfer?.status === 'completed' && claim.transfer.stock_item_id) {
        const newStoredQuantity = storedQuantity + delta
        await mealioServerDb
          .from('shopping_items')
          .update({
            stock_stored_quantity: newStoredQuantity,
            is_checked: numberOrZero(item.qte) > 0 && boughtQuantity >= numberOrZero(item.qte),
          })
          .eq('id', item.id)
        await mealioServerDb
          .from('shopping_purchase_events')
          .update({ status: 'range', storage, location_name: location.location_name })
          .eq('shopping_item_id', item.id)
          .eq('status', 'a_ranger')
        await updateIssue(issue.id, { status: 'resolved', resolved_at: new Date().toISOString() })
        return {
          ok: true,
          produit: item.produit,
          message: 'Article rangé (opération déjà finalisée).',
          destination: { storage, location_name: location.location_name, rule_label: location.rule_label },
        }
      }

      return { ok: false, produit: item.produit, message: 'Le rangement est déjà en cours. Réessayez dans quelques secondes.' }
    }

    let stockItemId = claim.transfer?.stock_item_id ?? null
    if (!stockItemId) {
      stockItemId = await findExistingStockByOperationKey(storage, storageUserId, operationKey)
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
    const { error: itemUpdateError } = await mealioServerDb
      .from('shopping_items')
      .update({
        stock_stored_quantity: newStoredQuantity,
        is_checked: numberOrZero(item.qte) > 0 && boughtQuantity >= numberOrZero(item.qte),
      })
      .eq('id', item.id)
    if (itemUpdateError) throw new Error(`Impossible de mettre à jour l’état de « ${item.produit} » : ${itemUpdateError.message}`)

    const { error: purchaseUpdateError } = await mealioServerDb
      .from('shopping_purchase_events')
      .update({ status: 'range', storage, location_name: location.location_name })
      .eq('shopping_item_id', item.id)
      .eq('status', 'a_ranger')
    if (purchaseUpdateError) console.warn('⚠️ Achat rangé mais historique non enrichi :', purchaseUpdateError.message)

    await updateIssue(issue.id, { status: 'resolved', resolved_at: new Date().toISOString() })

    return {
      ok: true,
      produit: item.produit,
      message: `Rangé : ${location.location_name}.`,
      destination: { storage, location_name: location.location_name, rule_label: location.rule_label },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur lors du rangement.'
    await updateIssue(issue.id, {
      message,
      resolution_hint: 'Corriger le problème indiqué puis relancer le rangement.',
    })
    return { ok: false, produit: item.produit, message }
  }
}

async function loadPending(username: string) {
  const { data: lists, error: listError } = await mealioServerDb
    .from('shopping_lists')
    .select('id,name,period_start,period_end,created_at')
    .eq('user_id', username)
  if (listError) throw new Error(`Erreur lecture des listes : ${listError.message}`)

  const listIds = (lists ?? []).map(row => row.id as string)
  if (listIds.length === 0) return []

  const { data: issues, error: issuesError } = await mealioServerDb
    .from('shopping_issues')
    .select('id,list_id,shopping_item_id,produit,unit,message,resolution_hint,status,created_at,resolved_at')
    .in('list_id', listIds)
    .eq('phase', 'storage')
    .eq('status', 'open')
    .order('created_at', { ascending: true })
  if (issuesError) throw new Error(`Erreur lecture des articles à ranger : ${issuesError.message}`)

  const issueRows = (issues ?? []) as IssueRow[]
  if (issueRows.length === 0) return []

  const itemIds = [...new Set(issueRows.map(issue => issue.shopping_item_id))]
  const { data: items, error: itemsError } = await mealioServerDb
    .from('shopping_items')
    .select('id,list_id,produit,ingredient_id,qte,qte_achetee,stock_stored_quantity,unite,is_checked')
    .in('id', itemIds)
  if (itemsError) throw new Error(`Erreur lecture des articles de courses : ${itemsError.message}`)

  const itemMap = new Map<string, ShoppingItemRow>((items ?? []).map(item => [item.id, item as ShoppingItemRow]))
  const ingredientIds = [...new Set((items ?? []).map(item => item.ingredient_id).filter((id): id is string => !!id))]
  const { data: ingredients, error: ingredientsError } = ingredientIds.length
    ? await mealioServerDb.from('official_ingredients').select('id,nom,categorie,default_storage,default_is_fridge').in('id', ingredientIds)
    : { data: [], error: null }
  if (ingredientsError) throw new Error(`Erreur lecture des ingrédients officiels : ${ingredientsError.message}`)

  const ingredientMap = new Map<string, IngredientRow>((ingredients ?? []).map(ingredient => [ingredient.id, ingredient as IngredientRow]))
  const { data: transfers, error: transfersError } = await mealioServerDb
    .from('shopping_item_stock_transfers')
    .select('shopping_item_id,stock_item_id,storage,location_id,location_name,rule_label,quantity,operation_key,status,attempted_at')
    .in('shopping_item_id', itemIds)
  if (transfersError) throw new Error(`Erreur lecture des transferts : ${transfersError.message}`)

  const { data: purchaseEvents, error: purchaseError } = await mealioServerDb
    .from('shopping_purchase_events')
    .select('id,shopping_item_id,quantity,status')
    .in('shopping_item_id', itemIds)
  if (purchaseError) throw new Error(`Erreur lecture de l’historique des achats : ${purchaseError.message}`)

  const listMap = new Map<string, any>((lists ?? []).map(list => [list.id, list]))
  return issueRows.map(issue => {
    const item = itemMap.get(issue.shopping_item_id)
    const ingredient = item?.ingredient_id ? ingredientMap.get(item.ingredient_id) : null
    const itemTransfers = ((transfers ?? []) as TransferRow[]).filter(row => row.shopping_item_id === issue.shopping_item_id)
    return {
      issue,
      item: item ?? null,
      ingredient: ingredient ?? null,
      list: listMap.get(issue.list_id) ?? null,
      stored_quantity: item ? Math.max(numberOrZero(item.stock_stored_quantity), sumTransferred(item.id, itemTransfers)) : 0,
      bought_quantity: item ? numberOrZero(item.qte_achetee) : 0,
    }
  }).filter(row => row.item !== null)
}

export async function GET() {
  try {
    const username = (await cookies()).get('congelo_username')?.value?.trim()
    if (!username) return NextResponse.json({ error: 'Utilisateur non authentifié.' }, { status: 401 })
    const items = await loadPending(username)
    return NextResponse.json({ ok: true, username, items })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur de chargement.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const username = (await cookies()).get('congelo_username')?.value?.trim()
    if (!username) return NextResponse.json({ error: 'Utilisateur non authentifié.' }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const requestedIssueId = typeof body?.issueId === 'string' ? body.issueId.trim() : ''
    const pending = await loadPending(username)
    const selected = requestedIssueId
      ? pending.filter(row => row.issue.id === requestedIssueId)
      : pending

    if (requestedIssueId && selected.length === 0) {
      return NextResponse.json({ error: 'Article à ranger introuvable ou déjà traité.' }, { status: 404 })
    }

    if (selected.length === 0) {
      return NextResponse.json({ ok: true, processed: [], message: 'Aucun article à ranger.' })
    }

    const household = await resolveHousehold(username)
    const itemIds = selected.map(row => row.item!.id)
    const { data: transfers, error: transfersError } = await mealioServerDb
      .from('shopping_item_stock_transfers')
      .select('shopping_item_id,stock_item_id,storage,location_id,location_name,rule_label,quantity,operation_key,status,attempted_at')
      .in('shopping_item_id', itemIds)
    if (transfersError) throw new Error(`Erreur lecture des transferts : ${transfersError.message}`)

    const { data: purchaseEvents, error: purchaseError } = await mealioServerDb
      .from('shopping_purchase_events')
      .select('id,shopping_item_id,quantity,status')
      .in('shopping_item_id', itemIds)
    if (purchaseError) throw new Error(`Erreur lecture de l’historique des achats : ${purchaseError.message}`)

    const processed = []
    for (const row of selected) {
      const result = await processIssue(
        row.issue,
        row.item!,
        row.ingredient,
        ((transfers ?? []) as TransferRow[]).filter(t => t.shopping_item_id === row.item!.id),
        ((purchaseEvents ?? []) as PurchaseEventRow[]).filter(event => event.shopping_item_id === row.item!.id),
        username,
        household,
      )
      processed.push({ issue_id: row.issue.id, ...result })
    }

    const successCount = processed.filter(item => item.ok).length
    const failedCount = processed.length - successCount
    return NextResponse.json({
      ok: true,
      processed,
      successCount,
      failedCount,
      message: failedCount === 0
        ? `${successCount} article(s) rangé(s).`
        : `${successCount} article(s) rangé(s), ${failedCount} article(s) restent à traiter.`,
    })
  } catch (error) {
    console.error('POST /api/admin/storage/pending', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur lors du relancement du rangement.' }, { status: 500 })
  }
}
