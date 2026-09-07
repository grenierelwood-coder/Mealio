import { frostiDb, cellioDb } from '../lib/supabase'

export interface StockItem {
  produit: string
  qte: number
  unite: string
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
    .select('produit, qte, unite')
    .eq('user_id', userId)

  if (frostiError) {
    console.error("❌ Erreur de lecture Frosti :", frostiError.message)
  }

  // 2. Interrogation de Cellio
  const { data: cellioData, error: cellioError } = await cellioDb
    .from('items') // Adaptez le nom de la table selon votre schéma Cellio
    .select('produit, qte, unite')
    .eq('user_id', userId)

  if (cellioError) {
    console.error("❌ Erreur de lecture Cellio :", cellioError.message)
  }

  // 3. Fusion des deux inventaires
  const combinedStock: StockItem[] = [
    ...(frostiData || []).map(item => ({ produit: item.produit, qte: Number(item.qte), unite: item.unite })),
    ...(cellioData || []).map(item => ({ produit: item.produit, qte: Number(item.qte), unite: item.unite }))
  ]

  console.log(`✅ ${combinedStock.length} articles trouvés au total dans Frosti et Cellio.`)
  return combinedStock
}