import { getHouseholdStockServer, resolveHousehold } from './household-server'

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
  frosti: { userId: string | null; count: number; error?: string }
  cellio: { userId: string | null; count: number; error?: string }
  total: number
}

/** Même service serveur pour Courses, Matcher et consommation.
 * Une erreur de lecture interrompt le calcul ; elle ne devient jamais un stock vide.
 * Le nom du foyer reste la jonction entre les UUID propres aux deux applications.
 */
export async function getHouseholdStock(username: string): Promise<HouseholdStock> {
  const household = await resolveHousehold(username)
  const stock = await getHouseholdStockServer(username, household)
  const items = stock.map(item => ({
    id: `${item.source}:${item.id}`,
    produit: item.produit, qte: item.qte, unite: item.unite, source: item.source,
  }))
  return {
    username: household.username, items,
    frosti: { userId: household.frostiUserId, count: items.filter(item => item.source === 'frosti').length },
    cellio: { userId: household.cellioUserId, count: items.filter(item => item.source === 'cellio').length },
    total: items.length,
  }
}
