import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import { mealioServerDb } from '../../lib/supabase-server'

export async function GET() {
  const username = (await getAuthSession())?.username?.trim()

  if (!username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const { data, error } = await mealioServerDb
    .from('official_ingredients')
    .select('id,nom,categorie,default_storage,default_is_fridge,unite_reference')
    .order('nom', { ascending: true })

  if (error) {
    return NextResponse.json({ error: `Impossible de charger les ingrédients : ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ingredients: data ?? [] })
}
