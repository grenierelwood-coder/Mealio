import { getAuthSession } from '../../../utils/auth-server'
import { NextResponse } from 'next/server'
import { addReplenishmentToActiveList, getReplenishmentSuggestions } from '../../../utils/replenishment-server'

async function getUser() {
  return (await getAuthSession())?.username?.trim() || null
}

export async function POST(request: Request) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const body = await request.json()
    if(body.source==='almost_finished' || body.source==='history') {
      const suggestion=(await getReplenishmentSuggestions(user)).find(s=>s.source===body.source && s.ingredient_id===body.ingredient_id)
      if(!suggestion) throw new Error('Cette proposition n’est plus active. Actualisez les courses.')
      return NextResponse.json(await addReplenishmentToActiveList(user,{...suggestion,rule_id:suggestion.rule_id}))
    }
    const produit = String(body.produit ?? '').trim()
    const unite = String(body.unite ?? '').trim() || 'Pièce'
    const quantity = Number(body.quantity)
    const source = body.source === 'recurring' ? 'recurring' : body.source === 'favorite' ? 'favorite' : 'threshold'
    if (!produit || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Produit et quantité valides obligatoires.')

    const result = await addReplenishmentToActiveList(user, {
      produit,
      ingredient_id: body.ingredient_id ? String(body.ingredient_id) : null,
      quantity,
      unite,
      source,
      rule_id: body.rule_id ? String(body.rule_id) : null,
    })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}
