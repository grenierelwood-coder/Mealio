import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../../utils/auth-server'
import { mealioServerDb } from '../../../../lib/supabase-server'
import { runDataQualityAudit, type DataQualityDataset } from '../../../../utils/data-quality'

export async function GET() {
  if (!await getAuthSession()) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const [ingredients, synonyms, units, densities, conversions, bridges, shopping, purchases, recurring, thresholds, favorites] = await Promise.all([
    mealioServerDb.from('official_ingredients').select('id,nom,categorie,rayon,default_storage,default_is_fridge,unite_reference').order('nom'),
    mealioServerDb.from('ingredient_synonyms').select('mot_recette,ingredient_id'),
    mealioServerDb.from('unit_mappings').select('unite,abreviation,type_unite,equivalence_reference,multiplicateur'),
    mealioServerDb.from('ingredient_densities').select('ingredient_id,unite,poids_g_approx'),
    mealioServerDb.from('ingredient_unit_conversions').select('ingredient_id,from_unit,to_unit,multiplier'),
    mealioServerDb.from('ingredient_unit_bridges').select('ingredient_id,from_unit,to_unit,factor'),
    mealioServerDb.from('shopping_items').select('ingredient_id,unite').limit(10000),
    mealioServerDb.from('shopping_purchase_events').select('ingredient_id,unite').limit(10000),
    mealioServerDb.from('recurring_purchase_rules').select('ingredient_id,unite').limit(10000),
    mealioServerDb.from('stock_replenishment_thresholds').select('ingredient_id,unite').limit(10000),
    mealioServerDb.from('favorite_preferences').select('ingredient_id,unite').limit(10000),
  ])

  const results = [ingredients, synonyms, units, densities, conversions, bridges, shopping, purchases, recurring, thresholds, favorites]
  const failed = results.find(result => result.error)
  if (failed?.error) {
    return NextResponse.json({ error: failed.error.message }, { status: 500 })
  }

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
  return NextResponse.json({ generatedAt: new Date().toISOString(), ...report })
}
