import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  validateMatcherDecision,
  rejectMatcherDecision,
  forgetMatcherDecision,
  StockItem,
} from '../../../utils/matcher'

interface FeedbackBody {
  action?: 'validate' | 'reject' | 'forget'
  ingredientName?: string
  stockItem?: StockItem
  reason?: string
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies()
  const userId = cookieStore.get('congelo_user_id')?.value
  if (!userId) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  let body: FeedbackBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 })
  }

  if (!body.action || !body.ingredientName || !body.stockItem?.id || !body.stockItem?.produit) {
    return NextResponse.json({ error: 'action, ingredientName et stockItem.id/produit sont requis.' }, { status: 400 })
  }

  try {
    if (body.action === 'validate') {
      await validateMatcherDecision(body.ingredientName, body.stockItem, body.reason)
    } else if (body.action === 'reject') {
      await rejectMatcherDecision(body.ingredientName, body.stockItem, body.reason)
    } else if (body.action === 'forget') {
      await forgetMatcherDecision(body.ingredientName, body.stockItem)
    } else {
      return NextResponse.json({ error: 'Action inconnue.' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('❌ Erreur feedback matcher :', error)
    return NextResponse.json({ error: 'Erreur interne.' }, { status: 500 })
  }
}
