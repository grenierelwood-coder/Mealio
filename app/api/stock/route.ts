import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getHouseholdStockServer, resolveHousehold } from '../../utils/household-server'
import { frostiServerDb, cellioServerDb } from '../../lib/supabase-server'

export async function GET() {
  const cookieStore = await cookies()
  const username = cookieStore.get('congelo_username')?.value?.trim()

  if (!username) {
    return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  }

  try {
    const [items, household] = await Promise.all([
      getHouseholdStockServer(username),
      resolveHousehold(username),
    ])

    const [frostiLocations, cellioLocations] = await Promise.all([
      household.frostiUserId
        ? frostiServerDb
            .from('freezers')
            .select('id,name,is_fridge')
            .eq('user_id', household.frostiUserId)
        : Promise.resolve({ data: [], error: null }),
      household.cellioUserId
        ? cellioServerDb
            .from('cellars')
            .select('id,name,is_secondary')
            .eq('user_id', household.cellioUserId)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (frostiLocations.error) throw new Error(`Erreur lecture emplacements Frosti : ${frostiLocations.error.message}`)
    if (cellioLocations.error) throw new Error(`Erreur lecture emplacements Cellio : ${cellioLocations.error.message}`)

    const frostiMap = new Map((frostiLocations.data ?? []).map((location: any) => [location.id, location]))
    const cellioMap = new Map((cellioLocations.data ?? []).map((location: any) => [location.id, location]))

    const enrichedItems = items.map(item => {
      if (item.source === 'frosti') {
        const location = item.congelo_id ? frostiMap.get(item.congelo_id) : null
        return {
          ...item,
          location_id: item.congelo_id ?? null,
          location_name: location?.name ?? null,
          location_is_fridge: location?.is_fridge ?? null,
        }
      }

      const location = item.cellar_id ? cellioMap.get(item.cellar_id) : null
      return {
        ...item,
        location_id: item.cellar_id ?? null,
        location_name: location?.name ?? null,
        location_is_secondary: location?.is_secondary ?? null,
      }
    })

    const frosti = enrichedItems.filter(item => item.source === 'frosti')
    const cellio = enrichedItems.filter(item => item.source === 'cellio')

    const locations = [
      ...(frostiLocations.data ?? []).map((location: any) => ({
        id: location.id,
        name: location.name,
        source: 'frosti' as const,
        is_fridge: location.is_fridge ?? null,
      })),
      ...(cellioLocations.data ?? []).map((location: any) => ({
        id: location.id,
        name: location.name,
        source: 'cellio' as const,
        is_secondary: location.is_secondary ?? null,
      })),
    ].sort((a, b) => a.name.localeCompare(b.name, 'fr'))

    return NextResponse.json({
      username,
      items: enrichedItems,
      frosti,
      cellio,
      locations,
      total: enrichedItems.length,
    })
  } catch (error) {
    console.error('❌ Erreur /api/stock :', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erreur interne.' },
      { status: 500 },
    )
  }
}
