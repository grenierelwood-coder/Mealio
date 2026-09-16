import { getAuthSession } from '../../../../utils/auth-server'
import { NextResponse } from 'next/server'
import { mealioServerDb } from '../../../../lib/supabase-server'
import { resolveHousehold } from '../../../../utils/household-server'
import { resolveStorageLocation, type StorageSource } from '../../../../utils/storage-routing-server'

function sourceOf(value: unknown): StorageSource | null {
  return value === 'frosti' || value === 'cellio' ? value : null
}

export async function GET(request: Request) {
  const username = (await getAuthSession())?.username?.trim()

  if (!username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const url = new URL(request.url)
  const source = sourceOf(url.searchParams.get('source'))
  const ingredientId = url.searchParams.get('ingredient_id')?.trim()

  if (!source || !ingredientId) {
    return NextResponse.json(
      { error: 'source et ingredient_id sont obligatoires.' },
      { status: 400 },
    )
  }

  try {
    const household = await resolveHousehold(username)
    const userId = source === 'frosti' ? household.frostiUserId : household.cellioUserId

    if (!userId) {
      return NextResponse.json(
        { error: `Utilisateur ${source} absent pour le foyer ${username}.` },
        { status: 404 },
      )
    }

    const { data: ingredient, error } = await mealioServerDb
      .from('official_ingredients')
      .select('id,nom,categorie,default_is_fridge')
      .eq('id', ingredientId)
      .maybeSingle()

    if (error) {
      throw new Error(`Erreur lecture ingrédient : ${error.message}`)
    }

    if (!ingredient) {
      return NextResponse.json({ error: 'Ingrédient officiel introuvable.' }, { status: 404 })
    }

    const destination = await resolveStorageLocation(source, userId, ingredient)

    return NextResponse.json({
      source,
      ingredient,
      destination,
    })
  } catch (error) {
    console.error('GET /api/admin/storage/preview', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne.' },
      { status: 500 },
    )
  }
}
