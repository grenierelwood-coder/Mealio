import { NextRequest, NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { getHouseholdStock } from '../../../utils/stock-fetcher'
import { loadReferenceData, resolveStockIngredientId } from '../../../utils/matcher'
import {
  validateMatcherDecision,
  rejectMatcherDecision,
  forgetMatcherDecision,
  type StockItem,
} from '../../../utils/matcher'

interface FeedbackBody {
  action?: 'validate' | 'reject' | 'forget'
  ingredientName?: string
  stockItem?: StockItem
  reason?: string
}

export async function POST(request: NextRequest) {
  const session = await getAuthSession()
  if (!session) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  let body: FeedbackBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 })
  }

  if (!body || typeof body.ingredientName !== 'string' || !body.ingredientName.trim() ||
      !body.stockItem || typeof body.stockItem.id !== 'string' || typeof body.stockItem.produit !== 'string' ||
      !body.stockItem.id || !body.stockItem.produit ||
      !['validate', 'reject', 'forget'].includes(String(body.action))) {
    return NextResponse.json({ error: 'action, ingredientName et stockItem.id/produit sont requis.' }, { status: 400 })
  }

  try {
    const householdStock = await getHouseholdStock(session.username)
    const ownedStock = householdStock.items.find(item => item.id === body.stockItem!.id)
    if (!ownedStock) return NextResponse.json({ error: 'Article de stock introuvable dans ce foyer.' }, { status: 404 })
    const refData = await loadReferenceData()
    const ingredientId = resolveStockIngredientId(refData, body.ingredientName)
    const stockId = resolveStockIngredientId(refData, ownedStock.produit)
    if (body.action === 'validate' && ingredientId && stockId && ingredientId !== stockId) {
      return NextResponse.json({ error: 'Deux ingrédients officiels différents ne peuvent pas être validés comme équivalents.' }, { status: 409 })
    }
    if (body.reason != null && typeof body.reason !== 'string') {
      return NextResponse.json({ error: 'La raison doit être un texte.' }, { status: 400 })
    }
    if (body.action === 'validate') {
      await validateMatcherDecision(body.ingredientName, ownedStock, body.reason)
    } else if (body.action === 'reject') {
      await rejectMatcherDecision(body.ingredientName, ownedStock, body.reason)
    } else if (body.action === 'forget') {
      await forgetMatcherDecision(body.ingredientName, ownedStock)
    } else {
      return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('❌ Erreur feedback matcher :', error)
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
