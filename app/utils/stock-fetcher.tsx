import { getHouseholdStockServer, resolveHousehold } from './household-server'

export interface StockItem {
  id: string
  produit: string
  qte: number
  unite: string
  recipe_id?:string|null
  preparation_id?:string|null
  preparation_origin?:'bought'|'homemade'|null
  portions_per_unit?:number|null
  ingredient_id?: string|null
  content_quantity?: number|null
  content_unit?: string|null
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
    ...item,
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
