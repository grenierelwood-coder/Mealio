import { mealioServerDb } from '../lib/supabase-server'

function normalizeUnit(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

export async function canonicalUnit(raw: string | null | undefined): Promise<string> {
  const wanted = String(raw ?? '').trim()
  if (!wanted) throw new Error('Unité obligatoire.')

  const { data, error } = await mealioServerDb
    .from('unit_mappings')
    .select('unite,abreviation')

  if (error) throw new Error(`Impossible de lire le référentiel des unités : ${error.message}`)

  const wantedKey = normalizeUnit(wanted)
  const row = (data ?? []).find((candidate: any) => {
    const nameKey = normalizeUnit(candidate.unite)
    const abbreviationKey = normalizeUnit(candidate.abreviation)
    return nameKey === wantedKey || (abbreviationKey && abbreviationKey === wantedKey)
  })

  if (!row?.unite) throw new Error(`Unité « ${wanted} » inconnue dans unit_mappings.`)
  return String(row.unite).trim()
}

export async function getOfficialIngredientReferenceUnit(ingredientId: string): Promise<string> {
  const id = String(ingredientId ?? '').trim()
  if (!id) throw new Error('Ingrédient officiel obligatoire.')

  const { data, error } = await mealioServerDb
    .from('official_ingredients')
    .select('id,nom,unite_reference')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`Impossible de lire l’ingrédient officiel : ${error.message}`)
  if (!data) throw new Error('Ingrédient officiel introuvable.')

  const reference = String(data.unite_reference ?? '').trim()
  if (!reference) {
    throw new Error(`L’ingrédient « ${data.nom} » n’a pas encore d’unité de référence.`)
  }

  return reference
}

/**
 * Règle métier centrale : dès qu'un enregistrement est lié à un ingrédient
 * officiel, son unité doit être exactement l'unité de référence de cet ingrédient.
 * Les alias/abréviations sont acceptés uniquement comme saisie, puis ramenés
 * vers le libellé canonique de unit_mappings.
 */
export async function assertOfficialIngredientUnit(
  ingredientId: string,
  requestedUnit: string | null | undefined,
): Promise<string> {
  const [reference, requested] = await Promise.all([
    getOfficialIngredientReferenceUnit(ingredientId),
    canonicalUnit(requestedUnit),
  ])

  if (normalizeUnit(reference) !== normalizeUnit(requested)) {
    const { data } = await mealioServerDb
      .from('official_ingredients')
      .select('nom')
      .eq('id', ingredientId)
      .maybeSingle()

    throw new Error(
      `Unité refusée pour « ${data?.nom ?? 'cet ingrédient'} » : « ${requested} » ne correspond pas à son unité de référence « ${reference} ». Modifiez d’abord l’unité de référence de l’ingrédient.`
    )
  }

  return reference
}
