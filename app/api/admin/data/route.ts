import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { mealioServerDb } from '../../../lib/supabase-server'

const TABLES = ['official_ingredients','ingredient_synonyms','unit_mappings','ingredient_densities','ingredient_unit_conversions','ignored_words','ai_resolution_log','matcher_memory','matcher_exclusions','shopping_lists','shopping_items','shopping_purchase_events','favorite_preferences','recurring_purchase_rules','stock_replenishment_thresholds','ingredient_unit_bridges'] as const
const META: Record<string,string> = { official_ingredients:'Référentiel canonique des ingrédients', ingredient_synonyms:'Termes de recettes reliés à un ingrédient officiel', unit_mappings:'Référentiel des unités et familles', ingredient_densities:'Équivalences culinaires vers les grammes', ingredient_unit_conversions:'Conversions explicites propres à un ingrédient', ignored_words:'Mots parasites ignorés par le Matcher', ai_resolution_log:'Journal des résolutions IA', matcher_memory:'Mémoire du Matcher', matcher_exclusions:'Exclusions du Matcher', shopping_lists:'Listes de courses', shopping_items:'Lignes de courses', shopping_purchase_events:'Historique des achats', favorite_preferences:'Favoris de réapprovisionnement', recurring_purchase_rules:'Achats récurrents', stock_replenishment_thresholds:'Seuils de réapprovisionnement', ingredient_unit_bridges:'Ponts d’unités' }
const RELATIONS = [
 ['official_ingredients','id','ingredient_synonyms','ingredient_id','Synonymes'], ['official_ingredients','id','ingredient_densities','ingredient_id','Équivalences de poids'], ['official_ingredients','id','ingredient_unit_conversions','ingredient_id','Conversions explicites'], ['official_ingredients','id','shopping_items','ingredient_id','Courses'], ['official_ingredients','id','favorite_preferences','ingredient_id','Favoris'], ['official_ingredients','id','recurring_purchase_rules','ingredient_id','Achats récurrents'], ['official_ingredients','id','stock_replenishment_thresholds','ingredient_id','Seuils'], ['official_ingredients','id','ingredient_unit_bridges','ingredient_id','Ponts d’unités'], ['shopping_lists','id','shopping_items','shopping_list_id','Lignes de courses'], ['shopping_items','id','shopping_purchase_events','shopping_item_id','Historique achats'], ['unit_mappings','unite','ingredient_densities','unite','Unité des équivalences'],
] as const

export async function GET(request: Request) {
  if (!await getAuthSession()) return NextResponse.json({ error:'Non authentifié.' }, { status:401 })
  const { searchParams } = new URL(request.url)
  const table = searchParams.get('table')
  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const pageSize = Math.min(50, Math.max(10, Number(searchParams.get('pageSize') || 25)))
  const search = (searchParams.get('search') || '').trim()
  if (!table) return NextResponse.json({ tables: TABLES.map(name => ({ name, description: META[name] })), relations: RELATIONS })
  if (!TABLES.includes(table as typeof TABLES[number])) return NextResponse.json({ error:'Table non autorisée.' }, { status:400 })
  let query = mealioServerDb.from(table).select('*', { count:'exact' })
  const from = (page-1)*pageSize
  const to = from+pageSize-1
  const searchable = table === 'official_ingredients' ? 'nom' : table === 'ingredient_synonyms' ? 'mot_recette' : table === 'unit_mappings' ? 'unite' : null
  if (search && searchable) query = query.ilike(searchable, `%${search}%`)
  const result = await query.range(from,to)
  if (result.error) return NextResponse.json({ error: result.error.message }, { status:500 })
  return NextResponse.json({ table, page, pageSize, total: result.count ?? 0, rows: result.data ?? [], description: META[table] })
}
