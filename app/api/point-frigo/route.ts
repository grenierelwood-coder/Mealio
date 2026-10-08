import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import { getHouseholdStockServer, updateHouseholdStockItem } from '../../utils/household-server'
import { cleanText, loadReferenceData, resolveStockIngredientId } from '../../utils/matcher'
export { GET } from '../stock/route'

export async function PATCH(request: Request) {
  const username = (await getAuthSession())?.username?.trim()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })
  const updated: string[] = []
  try {
    const body = await request.json()
    if (!body || !['frosti', 'cellio'].includes(body.source) ||
        !(body.location_id === null || typeof body.location_id === 'string') ||
        !Array.isArray(body.items) || !body.items.length || body.items.length > 1000) {
      return NextResponse.json({ error: 'Sélectionner un lieu et fournir ses corrections.' }, { status: 400 })
    }
    const [stock, ref] = await Promise.all([getHouseholdStockServer(username), loadReferenceData(username)])
    const seen = new Set<string>()
    // Validate the entire batch before the first write. No hidden changes in another location.
    for (const change of body.items) {
      const owned = stock.find(i => i.id === change.id && i.source === body.source)
      if (!owned || change.source !== body.source ||
          (owned.source === 'frosti' ? owned.congelo_id ?? null : owned.cellar_id ?? null) !== body.location_id) {
        return NextResponse.json({ error: 'Un article ne correspond pas au lieu et au foyer sélectionnés.' }, { status: 409 })
      }
      if (seen.has(change.id) || typeof change.qte !== 'number' || !Number.isFinite(change.qte) || change.qte < 0 ||
          typeof change.unite !== 'string' || !change.unite.trim()) return NextResponse.json({ error: 'Correction invalide ou doublon.' }, { status: 400 })
      seen.add(change.id)
      if (change.expected_qte !== owned.qte || change.expected_unite !== owned.unite) {
        return NextResponse.json({ error: 'Le stock a changé depuis son affichage. Actualiser l’inventaire.' }, { status: 409 })
      }
      const ingredient = ref.officialById.get(resolveStockIngredientId(ref, owned.produit) || '')
      if (!ref.pantryProducts?.get(ingredient?.id||'')?.enabled && ingredient?.nom === 'Ail' && cleanText(change.unite) !== 'gousse') {
        return NextResponse.json({ error: 'Ail : compter les gousses et choisir Gousse ; Pièce est interdite.' }, { status: 400 })
      }
      if (change.unite !== owned.unite && !ref.unitMappings.some(u => cleanText(u.unite) === cleanText(change.unite))) {
        return NextResponse.json({ error: 'Unité inconnue du référentiel.' }, { status: 400 })
      }
    }
    for (const change of body.items) {
      await updateHouseholdStockItem(username, change.id, { source: body.source, qte: change.qte, unite: change.unite.trim() })
      updated.push(change.id)
    }
    return NextResponse.json({ ok: true, updated })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Enregistrement impossible.', updated }, { status: 500 })
  }
}
