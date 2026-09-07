import { frostiDb, cellioDb } from '../lib/supabase'

export interface StockItem {
  id: string
  produit: string
  qte: number
  unite: string
  source?: 'frosti' | 'cellio'
}

export interface HouseholdStock {
  username: string
  items: StockItem[]
  frosti: {
    userId: string | null
    count: number
    error?: string
  }
  cellio: {
    userId: string | null
    count: number
    error?: string
  }
  total: number
}

/**
 * Récupère les stocks réels du foyer dans Frosti + Cellio.
 *
 * IMPORTANT :
 * Les UUID utilisateurs sont propres à chaque application.
 * La jonction inter-applications se fait par username.
 *
 * Exemple :
 *
 *   Mealio session
 *       ↓
 *     username = KH
 *       ↓
 *   ┌───────────────┬───────────────┐
 *   │               │               │
 * Frosti         Cellio
 * app_users      app_users
 * username=KH    username=KH
 *   ↓               ↓
 * UUID Frosti    UUID Cellio
 *   ↓               ↓
 * items          items
 */
export async function getHouseholdStock(
  username: string
): Promise<HouseholdStock> {

  const household = username.trim()

  if (!household) {
    throw new Error('Username du foyer manquant.')
  }

  console.log(
    `📦 Récupération des stocks pour le foyer "${household}"...`
  )

  // ============================================================
  // 1. FROSTI : résolution username → UUID
  // ============================================================

  const {
    data: frostiUser,
    error: frostiUserError,
  } = await frostiDb
    .from('app_users')
    .select('id, username')
    .eq('username', household)
    .maybeSingle()

  if (frostiUserError) {
    console.error(
      '❌ Erreur recherche utilisateur Frosti :',
      frostiUserError.message
    )
  }

  let frostiItems: StockItem[] = []

  if (frostiUser?.id) {

    const {
      data,
      error,
    } = await frostiDb
      .from('items')
      .select('id, produit, qte, unite')
      .eq('user_id', frostiUser.id)

    if (error) {
      console.error(
        '❌ Erreur lecture stock Frosti :',
        error.message
      )
    } else {
      frostiItems = (data ?? []).map(item => ({
        id: `frosti:${item.id}`,
        produit: item.produit,
        qte: Number(item.qte ?? 0),
        unite: item.unite,
        source: 'frosti' as const,
      }))
    }

  } else {

    console.warn(
      `⚠️ Foyer "${household}" introuvable dans Frosti.`
    )
  }

  // ============================================================
  // 2. CELLIO : résolution username → UUID
  // ============================================================

  const {
    data: cellioUser,
    error: cellioUserError,
  } = await cellioDb
    .from('app_users')
    .select('id, username')
    .eq('username', household)
    .maybeSingle()

  if (cellioUserError) {
    console.error(
      '❌ Erreur recherche utilisateur Cellio :',
      cellioUserError.message
    )
  }

  let cellioItems: StockItem[] = []

  if (cellioUser?.id) {

    const {
      data,
      error,
    } = await cellioDb
      .from('items')
      .select('id, produit, qte, unite')
      .eq('user_id', cellioUser.id)

    if (error) {
      console.error(
        '❌ Erreur lecture stock Cellio :',
        error.message
      )
    } else {
      cellioItems = (data ?? []).map(item => ({
        id: `cellio:${item.id}`,
        produit: item.produit,
        qte: Number(item.qte ?? 0),
        unite: item.unite,
        source: 'cellio' as const,
      }))
    }

  } else {

    console.warn(
      `⚠️ Foyer "${household}" introuvable dans Cellio.`
    )
  }

  // ============================================================
  // 3. FUSION
  // ============================================================

  const items = [
    ...frostiItems,
    ...cellioItems,
  ]

  const result: HouseholdStock = {
    username: household,

    items,

    frosti: {
      userId: frostiUser?.id ?? null,
      count: frostiItems.length,
      ...(frostiUserError
        ? { error: frostiUserError.message }
        : {}),
    },

    cellio: {
      userId: cellioUser?.id ?? null,
      count: cellioItems.length,
      ...(cellioUserError
        ? { error: cellioUserError.message }
        : {}),
    },

    total: items.length,
  }

  console.log(
    `✅ Foyer ${household} : ` +
    `Frosti=${result.frosti.count}, ` +
    `Cellio=${result.cellio.count}, ` +
    `Total=${result.total}`
  )

  return result
}