import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import { getHouseholdStockServer, resolveHousehold } from '../../utils/household-server'
import { mealioServerDb, frostiServerDb, cellioServerDb } from '../../lib/supabase-server'

export async function GET() {
  const username = (await getAuthSession())?.username?.trim()

  if (!username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  try {
    const [items, household] = await Promise.all([
      getHouseholdStockServer(username),
      resolveHousehold(username),
    ])

    const [frostiLocations, cellioLocations, officialIngredients, ingredientSynonyms] = await Promise.all([
      household.frostiUserId
        ? frostiServerDb
            .from('freezers')
            .select('id,name,is_fridge')
            .eq('user_id', household.frostiUserId)
        : Promise.resolve({ data: [], error: null }),
      household.cellioUserId
        ? cellioServerDb
            .from('cellars')
            .select('id,name,is_secondary')
            .eq('user_id', household.cellioUserId)
        : Promise.resolve({ data: [], error: null }),
      mealioServerDb
        .from('official_ingredients')
        .select('id,nom,rayon'),
      mealioServerDb
        .from('ingredient_synonyms')
        .select('mot_recette,ingredient_id'),
    ])

    if (frostiLocations.error) throw new Error(`Erreur lecture emplacements Frosti : ${frostiLocations.error.message}`)
    if (cellioLocations.error) throw new Error(`Erreur lecture emplacements Cellio : ${cellioLocations.error.message}`)
    if (officialIngredients.error) throw new Error(`Erreur lecture référentiel ingrédients : ${officialIngredients.error.message}`)
    if (ingredientSynonyms.error) throw new Error(`Erreur lecture synonymes ingrédients : ${ingredientSynonyms.error.message}`)

    const frostiMap = new Map((frostiLocations.data ?? []).map((location: any) => [location.id, location]))
    const cellioMap = new Map((cellioLocations.data ?? []).map((location: any) => [location.id, location]))

    const normalizeName = (value: string) => value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '')

    const rayonByName = new Map<string, string>()
    for (const ingredient of officialIngredients.data ?? []) {
      const rayon = ingredient.rayon?.trim()
      if (rayon) rayonByName.set(normalizeName(ingredient.nom), rayon)
    }
    const ingredientIdBySynonym = new Map<string, string>()
    for (const synonym of ingredientSynonyms.data ?? []) {
      ingredientIdBySynonym.set(normalizeName(synonym.mot_recette), synonym.ingredient_id)
    }
    const rayonById = new Map<string, string>()
    for (const ingredient of officialIngredients.data ?? []) {
      if (ingredient.rayon?.trim()) rayonById.set(ingredient.id, ingredient.rayon.trim())
    }

    const resolveRayon = (produit: string) => {
      const key = normalizeName(produit)
      return rayonByName.get(key) ?? rayonById.get(ingredientIdBySynonym.get(key) ?? '') ?? null
    }

    const enrichedItems = items.map(item => {
      if (item.source === 'frosti') {
        const location = item.congelo_id ? frostiMap.get(item.congelo_id) : null
        return {
          ...item,
          rayon: resolveRayon(item.produit),
          location_id: item.congelo_id ?? null,
          location_name: location?.name ?? null,
          location_is_fridge: location?.is_fridge ?? null,
        }
      }

      const location = item.cellar_id ? cellioMap.get(item.cellar_id) : null
      return {
        ...item,
        location_id: item.cellar_id ?? null,
        location_name: location?.name ?? null,
        location_is_secondary: location?.is_secondary ?? null,
      }
    })

    const frosti = enrichedItems.filter(item => item.source === 'frosti')
    const cellio = enrichedItems.filter(item => item.source === 'cellio')

    const locations = [
      ...(frostiLocations.data ?? []).map((location: any) => ({
        id: location.id,
        name: location.name,
        source: 'frosti' as const,
        is_fridge: location.is_fridge ?? null,
      })),
      ...(cellioLocations.data ?? []).map((location: any) => ({
        id: location.id,
        name: location.name,
        source: 'cellio' as const,
        is_secondary: location.is_secondary ?? null,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name, 'fr'))

    return NextResponse.json({
      username,
      items: enrichedItems,
      frosti,
      cellio,
      locations,
      total: enrichedItems.length,
    })
  } catch (error) {
    console.error('❌ Erreur /api/stock :', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne.' },
      { status: 500 },
    )
  }
}
