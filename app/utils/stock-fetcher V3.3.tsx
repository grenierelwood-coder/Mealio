import { frostiDb, cellioDb } from '../lib/supabase'

export interface StockItem {
  id: string
  produit: string
  qte: number
  unite: string
  source?: string
}

/**
 * Récupère et fusionne les stocks réels de Frosti (frigo/congélateur) et Cellio (cave/réserve)
 * @param userId L'identifiant du foyer (ex: 'foyer-123')
 */
export async function getHouseholdStock(userId: string): Promise<StockItem[]> {
  console.log(`📦 Récupération des stocks réels pour le foyer : ${userId}...`)

  // 1. Interrogation de Frosti
  const { data: frostiData, error: frostiError } = await frostiDb
    .from('items') // Adaptez le nom de la table selon votre schéma Frosti
    .select('id, produit, qte, unite')
    .eq('user_id', userId)

  if (frostiError) {
    console.error("❌ Erreur de lecture Frosti :", frostiError.message)
  }

  // 2. Interrogation de Cellio
  const { data: cellioData, error: cellioError } = await cellioDb
    .from('items') // Adaptez le nom de la table selon votre schéma Cellio
    .select('id, produit, qte, unite')
    .eq('user_id', userId)

  if (cellioError) {
    console.error("❌ Erreur de lecture Cellio :", cellioError.message)
  }

  // 3. Fusion des deux inventaires
  const combinedStock: StockItem[] = [
    ...(frostiData || []).map(item => ({ id: `frosti:${item.id}`, produit: item.produit, qte: Number(item.qte), unite: item.unite, source: 'frosti' })),
    ...(cellioData || []).map(item => ({ id: `cellio:${item.id}`, produit: item.produit, qte: Number(item.qte), unite: item.unite, source: 'cellio' }))
  ]

  console.log(`✅ ${combinedStock.length} articles trouvés au total dans Frosti et Cellio.`)
  return combinedStock
}