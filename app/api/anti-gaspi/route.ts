import { cleanText } from '../../utils/matcher'
import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import {
  getAntiGaspiTonight,
  searchIngredientsForTonight,
  searchCookiwikiIngredientLabels,
  searchRecipesForSelection,
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
      for (const item of ingredients) merged.set(item.id, { ...item, recipeCount: 0 })
      for (const item of cookiwiki) {
        const key = item.officialId ?? `label:${cleanText(item.label)}`
        const existing = merged.get(key)
        if (existing) existing.recipeCount = Math.max(existing.recipeCount, item.recipeCount)
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
    const body = await request.json().catch(() => ({})) || {}
    const selectedIngredientIds = Array.isArray(body?.selectedIngredientIds) ? body.selectedIngredientIds.map(String) : []
    const selectedLabels = Array.isArray(body?.selectedLabels) ? body.selectedLabels.map(String) : []
    if (body.matchMode !== undefined && !['any', 'all'].includes(body.matchMode)) {
      return NextResponse.json({ error: 'Choisir le mode OU ou ET.' }, { status: 400 })
    }
    const selectedKeys = Array.isArray(body?.selectedKeys) ? body.selectedKeys.map(String) : []
    if (selectedIngredientIds.length + selectedLabels.length + selectedKeys.length > 200) {
      return NextResponse.json({ error: 'Sélection trop longue.' }, { status: 400 })
    }
    return NextResponse.json(await searchRecipesForSelection(username, {
      selectedIngredientIds, selectedLabels, selectedKeys, matchMode: body.matchMode ?? 'any',
    }))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}
