import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import { getHouseholdStockServer, updateHouseholdStockItem } from '../../utils/household-server'

async function getUsername() {
  return (await getAuthSession())?.username?.trim() || null
}

export async function GET() {
  const username = await getUsername()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const items = await getHouseholdStockServer(username)
    return NextResponse.json({ items })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const username = await getUsername()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const body = await request.json()
    const updates = Array.isArray(body.items) ? body.items : []
    if (!updates.length) return NextResponse.json({ error: 'Aucune correction de stock.' }, { status: 400 })

    const results = []
    for (const update of updates) {
      if (!update?.id || !update?.source) continue
      const qte = Number(update.qte)
      if (!Number.isFinite(qte) || qte < 0) continue
      results.push(await updateHouseholdStockItem(username, String(update.id), {
        source: update.source,
        qte,
      }))
    }

    return NextResponse.json({ items: results })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}
