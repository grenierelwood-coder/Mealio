/**
 * Conversion des unités utilisées par Mealio.
 *
 * Principe volontairement simple :
 * - poids -> g
 * - volume -> mL
 * - unités discrètes : identité conservée
 * - unité discrète <-> poids : seulement avec une équivalence ingrédient
 * - volume <-> poids : seulement avec une densité ingrédient
 * - aucune conversion « devinée »
 */

export type UnitType = 'poids' | 'volume' | 'unité'

export interface UnitMapping {
  unite: string
  abreviation: string | null
  type_unite: string | null
  equivalence_reference?: string | null
  multiplicateur: number | null
}

export interface IngredientDensity {
  ingredient_id: string
  unite: string
  poids_g_approx: number
}

export interface UnitReferenceData {
  unitMappings: UnitMapping[]
  densities: IngredientDensity[]
}

export type ConversionFailureReason =
  | 'invalid_quantity'
  | 'no_unit_mapping'
  | 'no_bridge_data'
  | 'incompatible_families'

export type ConversionSuccess = {
  ok: true
  qty: number
  unit: string
  converted: boolean
  reason: string
}

export type ConversionFailure = {
  ok: false
  reason: ConversionFailureReason
}

export type ConversionResult = ConversionSuccess | ConversionFailure

const DISCRETE_UNITS = new Set([
  'piece',
  'unite',
  'tranche',
  'gousse',
  'sachet',
  'paquet',
  'boite',
  'bouteille',
  'pot',
  'barquette',
  'brin',
  'feuille',
  'botte',
  'pave',
])

/** Normalisation linguistique : ne fusionne jamais « unité » et « pièce ». */
export function normalizeUnitKey(unit: string): string {
  const raw = String(unit ?? '')
    .trim()
    .toLowerCase()
    .replace(/\(s\)/g, '')
    .replace(/\s+/g, ' ')

  const aliases: Record<string, string> = {
    'c.à.s': 'cs',
    'c.a.s': 'cs',
    'càs': 'cs',
    cas: 'cs',
    'c à s': 'cs',
    'c a s': 'cs',
    'c.s': 'cs',
    cs: 'cs',
    'cuillere a soupe': 'cs',
    'cuillère à soupe': 'cs',

    'c.à.c': 'cc',
    'c.a.c': 'cc',
    'càc': 'cc',
    cac: 'cc',
    'c à c': 'cc',
    'c a c': 'cc',
    'c.c': 'cc',
    cc: 'cc',
    'cuillere a cafe': 'cc',
    'cuillère à café': 'cc',

    ml: 'ml', millilitre: 'ml', millilitres: 'ml',
    cl: 'cl', centilitre: 'cl', centilitres: 'cl',
    dl: 'dl', decilitre: 'dl', decilitres: 'dl',
    l: 'l', litre: 'l', litres: 'l',
    g: 'g', gr: 'g', gramme: 'g', grammes: 'g',
    mg: 'mg', milligramme: 'mg', milligrammes: 'mg',
    kg: 'kg', kilogramme: 'kg', kilogrammes: 'kg',

    piece: 'piece', pièce: 'piece', pièces: 'piece', pieces: 'piece',
    'piece s': 'piece', 'pièce s': 'piece', 'pièces s': 'piece',

    // IMPORTANT : « unité » reste une unité distincte de « pièce ».
    unite: 'unite', unité: 'unite', unités: 'unite',
    'unite s': 'unite', 'unité s': 'unite',

    tranche: 'tranche', tranches: 'tranche', 'tranche s': 'tranche',
    gousse: 'gousse', gousses: 'gousse',
    sachet: 'sachet', sachets: 'sachet',
    paquet: 'paquet', paquets: 'paquet',
    boite: 'boite', boîte: 'boite', boites: 'boite', boîtes: 'boite',
    bouteille: 'bouteille', bouteilles: 'bouteille',
    pot: 'pot', pots: 'pot',
    barquette: 'barquette', barquettes: 'barquette',
    brin: 'brin', brins: 'brin',
    feuille: 'feuille', feuilles: 'feuille',
    botte: 'botte', bottes: 'botte',
    pave: 'pave', pavé: 'pave', pavés: 'pave', paves: 'pave',
  }

  if (aliases[raw]) return aliases[raw]
  const cleaned = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return aliases[cleaned] ?? cleaned
}

function parseReferenceFactor(reference: string | null | undefined, type: string | null): number {
  if (!reference) return 1
  const targetUnit = type === 'poids'
    ? /(\d+(?:[.,]\d+)?)\s*g\b/i
    : type === 'volume'
      ? /(\d+(?:[.,]\d+)?)\s*ml\b/i
      : null
  if (!targetUnit) return 1
  const match = reference.replace(',', '.').match(targetUnit)
  if (!match) return 1
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : 1
}

function findUnitMapping(refData: UnitReferenceData, unit: string): UnitMapping | undefined {
  const key = normalizeUnitKey(unit)
  return refData.unitMappings.find(u =>
    normalizeUnitKey(u.unite) === key || normalizeUnitKey(u.abreviation ?? '') === key
  )
}

function findDensity(refData: UnitReferenceData, ingredientId: string, unit: string): IngredientDensity | undefined {
  const key = normalizeUnitKey(unit)
  return refData.densities.find(d =>
    d.ingredient_id === ingredientId && normalizeUnitKey(d.unite) === key
  )
}

function findDensityForType(
  refData: UnitReferenceData,
  ingredientId: string,
  type: 'poids' | 'volume'
): IngredientDensity | undefined {
  return refData.densities.find(d => {
    if (d.ingredient_id !== ingredientId) return false
    return findUnitMapping(refData, d.unite)?.type_unite === type
  })
}

export function canonicalUnit(
  refData: UnitReferenceData,
  unit: string
): { unit: string; factor: number; type: UnitType } | null {
  const cleaned = normalizeUnitKey(unit)

  if (cleaned === 'mg') return { unit: 'g', factor: 0.001, type: 'poids' }
  if (cleaned === 'g') return { unit: 'g', factor: 1, type: 'poids' }
  if (cleaned === 'kg') return { unit: 'g', factor: 1000, type: 'poids' }
  if (cleaned === 'ml') return { unit: 'mL', factor: 1, type: 'volume' }
  if (cleaned === 'cl') return { unit: 'mL', factor: 10, type: 'volume' }
  if (cleaned === 'dl') return { unit: 'mL', factor: 100, type: 'volume' }
  if (cleaned === 'l') return { unit: 'mL', factor: 1000, type: 'volume' }

  const mapping = findUnitMapping(refData, unit)
  if (!mapping) return null

  const type = mapping.type_unite as UnitType | null
  if (!type || !['poids', 'volume', 'unité'].includes(type)) return null

  let factor = parseReferenceFactor(mapping.equivalence_reference, type)
  if (factor === 1) {
    const configured = Number(mapping.multiplicateur ?? 1)
    if (Number.isFinite(configured) && configured > 0) factor = configured
  }

  if (type === 'poids') return { unit: 'g', factor, type }
  if (type === 'volume') return { unit: 'mL', factor, type }

  // Une unité discrète garde son identité. Aucun « unité = pièce » implicite.
  return { unit: cleaned, factor: 1, type }
}

export function convertStockQuantity(
  refData: UnitReferenceData,
  ingredientId: string | null,
  qty: number,
  fromUnit: string,
  targetUnit: string
): ConversionResult {
  if (!Number.isFinite(qty)) return { ok: false, reason: 'invalid_quantity' }

  const from = canonicalUnit(refData, fromUnit)
  const target = canonicalUnit(refData, targetUnit)
  if (!from || !target) return { ok: false, reason: 'no_unit_mapping' }

  const normalizedFromUnit = normalizeUnitKey(fromUnit)
  const normalizedTargetUnit = normalizeUnitKey(targetUnit)

  if (
    normalizedFromUnit === normalizedTargetUnit &&
    DISCRETE_UNITS.has(normalizedFromUnit)
  ) {
    return {
      ok: true,
      qty,
      unit: normalizedTargetUnit,
      converted: false,
      reason: 'Même unité',
    }
  }

  if (from.type === target.type && from.unit === target.unit) {
    return {
      ok: true,
      qty: qty * from.factor / target.factor,
      unit: target.unit,
      converted: cleanUnitText(fromUnit) !== cleanUnitText(targetUnit),
      reason: cleanUnitText(fromUnit) === cleanUnitText(targetUnit) ? 'Même unité' : `${fromUnit} → ${targetUnit}`,
    }
  }

  if (from.type === 'unité' && target.type === 'poids' && ingredientId) {
    const density = findDensity(refData, ingredientId, fromUnit) ?? findDensity(refData, ingredientId, from.unit)
    const gramsPerUnit = density ? Number(density.poids_g_approx) : NaN
    if (density && Number.isFinite(gramsPerUnit) && gramsPerUnit > 0) {
      return {
        ok: true,
        qty: qty * from.factor * gramsPerUnit / target.factor,
        unit: target.unit,
        converted: true,
        reason: `${fromUnit} → ${targetUnit} via équivalence poids/unité`,
      }
    }
    return { ok: false, reason: 'no_bridge_data' }
  }

  if (from.type === 'poids' && target.type === 'unité' && ingredientId) {
    const density = findDensity(refData, ingredientId, targetUnit) ?? findDensity(refData, ingredientId, target.unit)
    const gramsPerUnit = density ? Number(density.poids_g_approx) : NaN
    if (density && Number.isFinite(gramsPerUnit) && gramsPerUnit > 0) {
      return {
        ok: true,
        qty: qty * from.factor / gramsPerUnit,
        unit: target.unit,
        converted: true,
        reason: `${fromUnit} → ${targetUnit} via équivalence poids/unité`,
      }
    }
    return { ok: false, reason: 'no_bridge_data' }
  }

  if (from.type === 'volume' && target.type === 'poids' && ingredientId) {
    const density = findDensity(refData, ingredientId, fromUnit)
      ?? findDensity(refData, ingredientId, from.unit)
      ?? findDensityForType(refData, ingredientId, 'volume')
    if (!density) return { ok: false, reason: 'no_bridge_data' }
    const densityUnit = canonicalUnit(refData, density.unite)
    const gramsPerDensityUnit = Number(density.poids_g_approx)
    if (!densityUnit || densityUnit.type !== 'volume' || !Number.isFinite(gramsPerDensityUnit) || gramsPerDensityUnit <= 0) {
      return { ok: false, reason: 'no_bridge_data' }
    }
    return {
      ok: true,
      qty: (qty * from.factor / densityUnit.factor) * gramsPerDensityUnit / target.factor,
      unit: target.unit,
      converted: true,
      reason: `${fromUnit} → ${targetUnit} via densité`,
    }
  }

  if (from.type === 'poids' && target.type === 'volume' && ingredientId) {
    const density = findDensity(refData, ingredientId, targetUnit)
      ?? findDensity(refData, ingredientId, target.unit)
      ?? findDensityForType(refData, ingredientId, 'volume')
    if (!density) return { ok: false, reason: 'no_bridge_data' }
    const densityUnit = canonicalUnit(refData, density.unite)
    const gramsPerDensityUnit = Number(density.poids_g_approx)
    if (!densityUnit || densityUnit.type !== 'volume' || !Number.isFinite(gramsPerDensityUnit) || gramsPerDensityUnit <= 0) {
      return { ok: false, reason: 'no_bridge_data' }
    }
    return {
      ok: true,
      qty: (qty * from.factor / gramsPerDensityUnit) * densityUnit.factor / target.factor,
      unit: target.unit,
      converted: true,
      reason: `${fromUnit} → ${targetUnit} via densité`,
    }
  }

  return { ok: false, reason: 'incompatible_families' }
}

function cleanUnitText(value: string): string {
  return String(value ?? '').trim().toLowerCase()
}
