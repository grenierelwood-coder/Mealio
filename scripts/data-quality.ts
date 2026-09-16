import { createClient } from '@supabase/supabase-js'
import { runDataQualityAudit, type DataQualityDataset } from '../app/utils/data-quality'

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`)
  return value
}

const db = createClient(env('NEXT_PUBLIC_MEALIO_URL'), env('MEALIO_SERVICE_ROLE_KEY'), {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
})

async function main() {
  const [ingredients, synonyms, units, densities, conversions, bridges, shopping, purchases, recurring, thresholds, favorites] = await Promise.all([
    db.from('official_ingredients').select('id,nom,categorie,rayon,default_storage,default_is_fridge,unite_reference'),
    db.from('ingredient_synonyms').select('mot_recette,ingredient_id'),
    db.from('unit_mappings').select('unite,abreviation,type_unite,equivalence_reference,multiplicateur'),
    db.from('ingredient_densities').select('ingredient_id,unite,poids_g_approx'),
    db.from('ingredient_unit_conversions').select('ingredient_id,from_unit,to_unit,multiplier'),
    db.from('ingredient_unit_bridges').select('ingredient_id,from_unit,to_unit,factor'),
    db.from('shopping_items').select('ingredient_id,unite').limit(10000),
    db.from('shopping_purchase_events').select('ingredient_id,unite').limit(10000),
    db.from('recurring_purchase_rules').select('ingredient_id,unite').limit(10000),
    db.from('stock_replenishment_thresholds').select('ingredient_id,unite').limit(10000),
    db.from('favorite_preferences').select('ingredient_id,unite').limit(10000),
  ])

  const results = [ingredients, synonyms, units, densities, conversions, bridges, shopping, purchases, recurring, thresholds, favorites]
  const failed = results.find(result => result.error)
  if (failed?.error) throw new Error(failed.error.message)

  const dataset: DataQualityDataset = {
    ingredients: ingredients.data ?? [],
    synonyms: synonyms.data ?? [],
    units: units.data ?? [],
    densities: densities.data ?? [],
    conversions: conversions.data ?? [],
    bridges: bridges.data ?? [],
    usage: [
      { table: 'shopping_items', rows: shopping.data ?? [] },
      { table: 'shopping_purchase_events', rows: purchases.data ?? [] },
      { table: 'recurring_purchase_rules', rows: recurring.data ?? [] },
      { table: 'stock_replenishment_thresholds', rows: thresholds.data ?? [] },
      { table: 'favorite_preferences', rows: favorites.data ?? [] },
    ],
  }

  const report = runDataQualityAudit(dataset)
  console.log(JSON.stringify(report, null, 2))

  if (report.summary.status === 'FAIL') process.exitCode = 1
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
