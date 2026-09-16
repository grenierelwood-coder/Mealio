import { getAuthSession } from '../../../../utils/auth-server'
import { NextResponse } from 'next/server'
import { mealioServerDb } from '../../../../lib/supabase-server'

async function getUsername() {
  return (await getAuthSession())?.username?.trim() || null
}

export async function GET() {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  try {
    const { data, error } = await mealioServerDb
      .from('official_ingredients')
      .select('id,nom,categorie')
      .order('nom', { ascending: true })

    if (error) {
      throw new Error(`Erreur lecture ingrédients officiels : ${error.message}`)
    }

    return NextResponse.json({
      username,
      ingredients: data ?? [],
    })
  } catch (error) {
    console.error('GET /api/admin/storage/ingredients', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne.' },
      { status: 500 },
    )
  }
}
