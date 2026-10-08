import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { mealioServerDb } from '../../../lib/supabase-server'
import { loadPantryProducts } from '../../../utils/pantry-server'
import { canonicalUnit } from '../../../utils/official-unit-policy'

export async function GET() {
  const session = await getAuthSession()
  if (!session) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const [products, ingredients, units] = await Promise.all([
      loadPantryProducts(session.username),
      mealioServerDb.from('official_ingredients').select('id,nom,categorie,unite_reference').order('nom'),
      mealioServerDb.from('unit_mappings').select('unite').order('unite'),
    ])
    if (ingredients.error) throw new Error(ingredients.error.message)
    if (units.error) throw new Error(units.error.message)
    const byId = new Map<string, any>((ingredients.data ?? []).map((row: any) => [row.id, row]))
    return NextResponse.json({
      household: session.username,
      products: [...products.values()].map(row => ({ ...row, ...byId.get(row.ingredient_id) as object })),
      ingredients: ingredients.data ?? [], units: units.data ?? [],
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Lecture impossible.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const session = await getAuthSession()
  if (!session) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body.ingredient_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.ingredient_id) ||
      typeof body.enabled !== 'boolean' || !['number','string'].includes(typeof body.default_quantity) ||
      !Number.isFinite(Number(body.default_quantity)) || Number(body.default_quantity) <= 0 ||
      typeof body.default_unit !== 'string' || !body.default_unit.trim()) {
    return NextResponse.json({ error: 'Ingrédient, quantité positive, unité et mode obligatoires.' }, { status: 400 })
  }
  try {
    const unit = await canonicalUnit(body.default_unit)
    const { data: ingredient, error: ingredientError } = await mealioServerDb.from('official_ingredients')
      .select('id').eq('id', body.ingredient_id).maybeSingle()
    if (ingredientError) throw new Error(ingredientError.message)
    if (!ingredient) return NextResponse.json({ error: 'Ingrédient introuvable.' }, { status: 404 })
    const { data, error } = await mealioServerDb.from('household_pantry_products').upsert({
      user_id: session.username,
      ingredient_id: body.ingredient_id, default_quantity: Number(body.default_quantity),
      default_unit: unit, enabled: body.enabled, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,ingredient_id' }).select('ingredient_id,default_quantity,default_unit,enabled').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ product: data })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Enregistrement impossible.' }, { status: 400 })
  }
}
