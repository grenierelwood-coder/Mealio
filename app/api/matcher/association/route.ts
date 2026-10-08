import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { cleanText, loadReferenceData } from '../../../utils/matcher'
import { mealioServerDb } from '../../../lib/supabase-server'

export async function POST(request: Request) {
  if (!await getAuthSession()) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 500 ||
      typeof body.ingredient_id !== 'string') return NextResponse.json({ error: 'Libellé et ingrédient requis.' }, { status: 400 })
  try {
    const ref = await loadReferenceData()
    const target = ref.officialById.get(body.ingredient_id)
    if (!target) return NextResponse.json({ error: 'Ingrédient officiel introuvable.' }, { status: 404 })
    const name = body.name.trim(), key = cleanText(name)
    const existing = ref.officialList.find(i => cleanText(i.nom) === key)?.id ?? ref.synonymMap.get(key)
    if (existing && existing !== target.id) return NextResponse.json({ error: 'Ce libellé désigne déjà un autre ingrédient. Corriger l’association existante dans Admin avant de la remplacer.' }, { status: 409 })
    if (!existing) {
      const { error } = await mealioServerDb.rpc('save_matcher_association', { p_name: name, p_ingredient_id: target.id })
      if (error) throw new Error(error.message)
    }
    return NextResponse.json({ ok: true, ingredient: target.nom, already_known: Boolean(existing) })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Enregistrement impossible.' }, { status: 500 })
  }
}
