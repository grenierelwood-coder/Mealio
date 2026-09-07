import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getHouseholdStockServer } from '../../utils/household-server'

export async function GET() {
  const cookieStore = await cookies()
  const username = cookieStore.get('congelo_username')?.value?.trim()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  try {
    const items = await getHouseholdStockServer(username)

    const frosti = items.filter(
      item => item.source === 'frosti'
    )

    const cellio = items.filter(
      item => item.source === 'cellio'
    )

    return NextResponse.json({
      username,
      items,
      frosti,
      cellio,
      total: items.length,
    })
  } catch (error) {
    console.error('❌ Erreur /api/stock :', error)

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