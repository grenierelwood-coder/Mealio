import { mealioServerDb } from '../lib/supabase-server'
import { getAuthSession } from './auth-server'
import { validPantryProduct, type PantryProduct } from './pantry-policy'

/** Defaults are templates; authenticated household overrides always take precedence. */
export async function loadPantryProducts(username?: string): Promise<Map<string, PantryProduct>> {
  const household = username ?? (await getAuthSession())?.username
  const products = new Map<string, PantryProduct>()
  for (const table of household ? ['pantry_products', 'household_pantry_products'] : ['pantry_products']) {
    let query = mealioServerDb.from(table).select('ingredient_id,default_quantity,default_unit,enabled')
    if (table === 'household_pantry_products') query = query.eq('user_id', household!)
    const { data, error } = await query
    if (error) throw new Error(`Référentiel épicerie indisponible : ${error.message}`)
    for (const row of (data ?? []) as PantryProduct[]) {
      if (!validPantryProduct(row)) throw new Error(`Format d’achat épicerie invalide. Vérifier ${table}.`)
      products.set(row.ingredient_id, { ...row, default_quantity: Number(row.default_quantity) })
    }
  }
  return products
}
