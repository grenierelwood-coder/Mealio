import { frostiDb, cellioDb } from '../lib/supabase'

export interface StockItem {
  id: string
  produit: string
  qte: number
  unite: string
  source?: 'frosti' | 'cellio'
  date_peremption?: string | null
  categorie?: string | null
}

type AppUser = {
  id: string
  username: string
}

type RawStockItem = {
  id: string
  produit: string
  qte: number
  unite: string | null
  categorie?: string | null
  date_peremption?: string | null
}

/**
 * V3.4 : les bases Frosti et Cellio possèdent chacune leur propre app_users.
 * Les UUID ne sont donc PAS identiques entre les deux applications.
 * On part du userId de session (historiquement congelo_user_id), puis on
 * retrouve le même foyer par username dans l'autre base.
 */
async function resolveHouseholdUsers(userId: string): Promise<{
  frostiUserId: string | null
  cellioUserId: string | null
  username: string | null
}> {
  const frostiById = await frostiDb
    .from('app_users')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle()

  if (frostiById.error) {
    console.error('[STOCK] Frosti app_users:', frostiById.error.message)
  }

  if (frostiById.data) {
    const username = String((frostiById.data as AppUser).username)
    const cellioByUsername = await cellioDb
      .from('app_users')
      .select('id, username')
      .eq('username', username)
      .maybeSingle()

    if (cellioByUsername.error) {
      console.error('[STOCK] Cellio app_users:', cellioByUsername.error.message)
    }

    return {
      frostiUserId: String(frostiById.data.id),
      cellioUserId: cellioByUsername.data ? String(cellioByUsername.data.id) : null,
      username,
    }
  }

  // Compatibilité si la session venait de Cellio plutôt que de Frosti.
  const cellioById = await cellioDb
    .from('app_users')
    .select('id, username')
    .eq('id', userId)
    .maybeSingle()

  if (cellioById.error) {
    console.error('[STOCK] Cellio app_users:', cellioById.error.message)
  }

  if (cellioById.data) {
    const username = String((cellioById.data as AppUser).username)
    const frostiByUsername = await frostiDb
      .from('app_users')
      .select('id, username')
      .eq('username', username)
      .maybeSingle()

    if (frostiByUsername.error) {
      console.error('[STOCK] Frosti app_users:', frostiByUsername.error.message)
    }

    return {
      frostiUserId: frostiByUsername.data ? String(frostiByUsername.data.id) : null,
      cellioUserId: String(cellioById.data.id),
      username,
    }
  }

  console.warn(`[STOCK] Aucun foyer trouvé pour userId=${userId}`)
  return { frostiUserId: null, cellioUserId: null, username: null }
}

/**
 * Récupère le stock réel de Frosti + Cellio.
 * Les UUID de foyer étant propres à chaque base, le rapprochement se fait
 * par username et non par réutilisation aveugle du même UUID.
 *
 * Les articles dont la DLC est strictement antérieure à aujourd'hui ne sont
 * pas considérés comme disponibles pour un achat de recette.
 */
export async function getHouseholdStock(userId: string): Promise<StockItem[]> {
  console.log(`📦 Récupération des stocks réels pour le foyer : ${userId}...`)

  const users = await resolveHouseholdUsers(userId)
  if (!users.frostiUserId && !users.cellioUserId) return []

  const today = new Date().toISOString().slice(0, 10)

  const [frostiResult, cellioResult] = await Promise.all([
    users.frostiUserId
      ? frostiDb
          .from('items')
          .select('id, produit, qte, unite, categorie, date_peremption')
          .eq('user_id', users.frostiUserId)
      : Promise.resolve({ data: [], error: null }),
    users.cellioUserId
      ? cellioDb
          .from('items')
          .select('id, produit, qte, unite, categorie, date_peremption')
          .eq('user_id', users.cellioUserId)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (frostiResult.error) {
    console.error('❌ Erreur de lecture Frosti :', frostiResult.error.message)
  }
  if (cellioResult.error) {
    console.error('❌ Erreur de lecture Cellio :', cellioResult.error.message)
  }

  const isUsable = (item: RawStockItem) => {
    if (!item.produit || Number(item.qte) <= 0) return false
    if (item.date_peremption && item.date_peremption < today) return false
    return true
  }

  const combinedStock: StockItem[] = [
    ...((frostiResult.data ?? []) as RawStockItem[])
      .filter(isUsable)
      .map(item => ({
        id: `frosti:${item.id}`,
        produit: item.produit,
        qte: Number(item.qte),
        unite: item.unite || 'pièce',
        categorie: item.categorie ?? null,
        date_peremption: item.date_peremption ?? null,
        source: 'frosti' as const,
      })),
    ...((cellioResult.data ?? []) as RawStockItem[])
      .filter(isUsable)
      .map(item => ({
        id: `cellio:${item.id}`,
        produit: item.produit,
        qte: Number(item.qte),
        unite: item.unite || 'pièce',
        categorie: item.categorie ?? null,
        date_peremption: item.date_peremption ?? null,
        source: 'cellio' as const,
      })),
  ]

  console.log(
    `✅ ${combinedStock.length} articles disponibles (${users.username ?? 'foyer inconnu'}) : Frosti=${frostiResult.data?.length ?? 0}, Cellio=${cellioResult.data?.length ?? 0}`
  )

  return combinedStock
}
