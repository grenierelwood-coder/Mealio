import { getAuthSession } from '../../../utils/auth-server'
import { NextResponse } from 'next/server'
import { resolveHousehold } from '../../../utils/household-server'
import {
  createStorageRoutingRule,
  deleteStorageRoutingRule,
  listStorageLocations,
  listStorageRoutingRules,
  updateStorageRoutingRule,
} from '../../../utils/storage-routing-server'

async function username() {
  return (await getAuthSession())?.username?.trim() || null
}

function sourceOf(value: unknown): 'frosti' | 'cellio' | null {
  return value === 'frosti' || value === 'cellio' ? value : null
}

async function userIdFor(source: 'frosti' | 'cellio', name: string) {
  const household = await resolveHousehold(name)
  return source === 'frosti' ? household.frostiUserId : household.cellioUserId
}

export async function GET() {
  const name = await username()
  if (!name) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const household = await resolveHousehold(name)
    const [frosti, cellio] = await Promise.all([
      household.frostiUserId
        ? Promise.all([listStorageRoutingRules('frosti', household.frostiUserId), listStorageLocations('frosti', household.frostiUserId)])
        : Promise.resolve([[], []] as const),
      household.cellioUserId
        ? Promise.all([listStorageRoutingRules('cellio', household.cellioUserId), listStorageLocations('cellio', household.cellioUserId)])
        : Promise.resolve([[], []] as const),
    ])
    return NextResponse.json({ username: name, frosti: { rules: frosti[0], locations: frosti[1] }, cellio: { rules: cellio[0], locations: cellio[1] } })
  } catch (error) {
    console.error('GET /api/admin/storage', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return mutate(request, 'create')
}

export async function PATCH(request: Request) {
  return mutate(request, 'update')
}

export async function DELETE(request: Request) {
  const name = await username()
  if (!name) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const body = await request.json()
    const source = sourceOf(body.source)
    if (!source || !body.id) return NextResponse.json({ error: 'Source ou règle invalide.' }, { status: 400 })
    const userId = await userIdFor(source, name)
    if (!userId) return NextResponse.json({ error: `Utilisateur ${source} absent.` }, { status: 404 })
    await deleteStorageRoutingRule(source, userId, body.id)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/admin/storage', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}

async function mutate(request: Request, action: 'create' | 'update') {
  const name = await username()
  if (!name) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  try {
    const body = await request.json()
    const source = sourceOf(body.source)
    if (!source) return NextResponse.json({ error: 'Source invalide.' }, { status: 400 })
    const userId = await userIdFor(source, name)
    if (!userId) return NextResponse.json({ error: `Utilisateur ${source} absent.` }, { status: 404 })

    if (action === 'create') {
      const rule = await createStorageRoutingRule(source, userId, {
        scope: body.scope,
        category: body.category,
        ingredient_id: body.ingredient_id,
        location_id: body.location_id,
        mode: body.mode,
        priority: Number(body.priority ?? 100),
        is_active: body.is_active !== false,
      })
      return NextResponse.json({ rule }, { status: 201 })
    }

    if (!body.id) return NextResponse.json({ error: 'Identifiant de règle manquant.' }, { status: 400 })
    const rule = await updateStorageRoutingRule(source, userId, body.id, {
      scope: body.scope,
      category: body.category,
      ingredient_id: body.ingredient_id,
      location_id: body.location_id,
      mode: body.mode,
      priority: body.priority === undefined ? undefined : Number(body.priority),
      is_active: body.is_active,
    })
    return NextResponse.json({ rule })
  } catch (error) {
    console.error(`${action} /api/admin/storage`, error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}
