import { getAuthSession } from '../../../utils/auth-server'
import { NextResponse } from 'next/server'
import {
  createHouseholdStockItem,
  updateHouseholdStockItem,
  deleteHouseholdStockItem,
} from '../../../utils/household-server'

async function getUsername(): Promise<string | null> {
  const session = await getAuthSession()
  return session?.username?.trim() || null
}

export async function POST(request: Request) {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()

    const item = await createHouseholdStockItem(
      username,
      {
        source: body.source,
        produit: body.produit,
        qte: body.qte,
        unite: body.unite,
        categorie: body.categorie,
        date_entree: body.date_entree,
        date_peremption: body.date_peremption,
        notes: body.notes,
        congelo_id: body.congelo_id,
        cellar_id: body.cellar_id,
      }
    )

    return NextResponse.json(
      { item },
      { status: 201 }
    )
  } catch (error) {
    console.error('❌ Erreur POST /api/stock/items :', error)

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Erreur interne.',
      },
      { status: 500 }
    )
  }
}

export async function PATCH(request: Request) {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json(
        { error: 'Identifiant article obligatoire.' },
        { status: 400 }
      )
    }

    if (!body.source) {
      return NextResponse.json(
        { error: 'Source obligatoire.' },
        { status: 400 }
      )
    }

    const item = await updateHouseholdStockItem(
      username,
      body.id,
      {
        source: body.source,
        produit: body.produit,
        qte: body.qte,
        unite: body.unite,
        categorie: body.categorie,
        date_entree: body.date_entree,
        date_peremption: body.date_peremption,
        notes: body.notes,
        congelo_id: body.congelo_id,
        cellar_id: body.cellar_id,
      }
    )

    return NextResponse.json({ item })
  } catch (error) {
    console.error('❌ Erreur PATCH /api/stock/items :', error)

    const message =
      error instanceof Error
        ? error.message
        : 'Erreur interne.'

    const status =
      message.includes('introuvable')
        ? 404
        : 500

    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}

export async function DELETE(request: Request) {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json(
        { error: 'Identifiant article obligatoire.' },
        { status: 400 }
      )
    }

    if (!body.source) {
      return NextResponse.json(
        { error: 'Source obligatoire.' },
        { status: 400 }
      )
    }

    await deleteHouseholdStockItem(
      username,
      body.id,
      body.source
    )

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error('❌ Erreur DELETE /api/stock/items :', error)

    const message =
      error instanceof Error
        ? error.message
        : 'Erreur interne.'

    const status =
      message.includes('introuvable')
        ? 404
        : 500

    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}