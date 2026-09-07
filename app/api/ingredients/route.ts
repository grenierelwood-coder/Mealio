import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { mealioServerDb } from '../../lib/supabase-server'

export async function GET() {
  const cookieStore = await cookies()
  const username = cookieStore.get('congelo_username')?.value?.trim()

  if (!username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  const { data, error } = await mealioServerDb
    .from('official_ingredients')
    .select('id,nom,categorie,default_storage,default_is_fridge')
    .order('nom', { ascending: true })

  if (error) {
    return NextResponse.json({ error: `Impossible de charger les ingrédients : ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ingredients: data ?? [] })
}
