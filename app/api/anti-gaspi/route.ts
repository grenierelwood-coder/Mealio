import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import {
  getAntiGaspiTonight,
  searchIngredientsForTonight,
  searchCookiwikiIngredientLabels,
  searchRecipesForSelectedLabels,
  searchRecipesForSelectedIngredients,
  searchRecipesForSelectedStock,
} from '../../utils/anti-gaspi-server'

export async function GET(request: Request) {
  const username = (await getAuthSession())?.username?.trim()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const url = new URL(request.url)
    const query = url.searchParams.get('q')?.trim() ?? ''
    if (query) {
      const ingredients = await searchIngredientsForTonight(username, query)
      const cookiwiki = await searchCookiwikiIngredientLabels(query)
      const merged = new Map<string, any>()
      for (const item of ingredients) merged.set(item.nom.toLowerCase(), { ...item, recipeCount: 0 })
      for (const item of cookiwiki) {
        const key = item.label.toLowerCase()
        const existing = merged.get(key)
        if (existing) existing.recipeCount = item.recipeCount
        else merged.set(key, { id: item.officialId ?? `label:${item.label}`, nom: item.label, categorie: '', inStock: false, stockLabels: [], recipeCount: item.recipeCount })
      }
      return NextResponse.json({ ingredients: Array.from(merged.values()).sort((a, b) => (b.inStock - a.inStock) || (b.recipeCount - a.recipeCount) || a.nom.localeCompare(b.nom, 'fr')).slice(0, 30) })
    }
    return NextResponse.json(await getAntiGaspiTonight(username))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const username = (await getAuthSession())?.username?.trim()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const body = await request.json().catch(() => ({}))
    const selectedIngredientIds = Array.isArray(body?.selectedIngredientIds) ? body.selectedIngredientIds.map(String) : []
    const selectedLabels = Array.isArray(body?.selectedLabels) ? body.selectedLabels.map(String) : []
    // Les IDs officiels sont la source de vérité.
    // Les labels ne servent que de secours pour les anciens clients.
    if (selectedIngredientIds.length) {
      return NextResponse.json(await searchRecipesForSelectedIngredients(username, selectedIngredientIds))
    }
    if (selectedLabels.length) {
      return NextResponse.json(await searchRecipesForSelectedLabels(selectedLabels))
    }
    const selectedKeys = Array.isArray(body?.selectedKeys) ? body.selectedKeys.map(String) : []
    return NextResponse.json(await searchRecipesForSelectedStock(username, selectedKeys))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}
