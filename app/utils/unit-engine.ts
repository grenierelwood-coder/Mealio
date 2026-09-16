/**
 * Mealio — moteur unique des unités.
 *
 * RÈGLE ABSOLUE : aucune conversion de quantité ne doit être calculée
 * ailleurs dans Mealio.
 *
 * - unit_mappings = définition canonique des unités + famille + facteur
 * - official_ingredients.unite_reference = unité interne de référence
 * - ingredient_densities = conversions explicites volume/poids ou divers/poids
 * - aucune conversion implicite entre unités de la famille "divers"
 * - une conversion inter-familles connue reste soumise à confirmation
 */

export type UnitFamily = 'poids' | 'volume' | 'divers'

export type UnitMappingLike = {
  unite: string
  abreviation?: string | null
  type_unite?: string | null
  equivalence_reference?: string | null
  multiplicateur?: number | null
}

export type IngredientReferenceLike = {
  id: string
  unite_reference?: string | null
}

export type IngredientDensityLike = {
  ingredient_id: string
  unite: string
  poids_g_approx: number
}

export type ExplicitIngredientUnitConversion = {
  ingredient_id: string
  from_unit: string
  to_unit: string
  multiplier: number
  description?: string | null
}

export type UnitEngineData = {
  unitMappings: UnitMappingLike[]
  densities?: IngredientDensityLike[]
  explicitConversions?: ExplicitIngredientUnitConversion[]
  officialById?: Map<string, IngredientReferenceLike>
}

export type UnitDefinition = {
  unit: string
  family: UnitFamily
  factorToFamilyBase: number
}

export type ConversionStatus =
  | 'converted'
  | 'same_unit'
  | 'needs_confirmation'
  | 'missing_reference_unit'
  | 'unknown_source_unit'
  | 'unknown_target_unit'
  | 'impossible'
  | 'invalid_quantity'

export type QuantityConversion = {
  status: ConversionStatus
  quantity: number | null
  unit: string | null
  sourceUnit: string
  targetUnit: string
  sourceFamily: UnitFamily | null
  targetFamily: UnitFamily | null
  requiresConfirmation: boolean
  reason: string
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
}

function unitKey(value: string | null | undefined): string {
  const key = normalize(value)
  const aliases: Record<string, string> = {
    'c.à.s': 'cs', 'c.a.s': 'cs', 'càs': 'cs', 'cas': 'cs', 'c à s': 'cs', 'c a s': 'cs', 'c.s': 'cs',
    'c.à.c': 'cc', 'c.a.c': 'cc', 'càc': 'cc', 'cac': 'cc', 'c à c': 'cc', 'c a c': 'cc', 'c.c': 'cc',
    'ml': 'ml', 'millilitre': 'ml', 'millilitres': 'ml',
    'cl': 'cl', 'centilitre': 'cl', 'centilitres': 'cl',
    'dl': 'dl', 'decilitre': 'dl', 'decilitres': 'dl',
    'l': 'l', 'litre': 'l', 'litres': 'l',
    'g': 'g', 'gr': 'g', 'gramme': 'g', 'grammes': 'g',
    'mg': 'mg', 'milligramme': 'mg', 'milligrammes': 'mg',
    'kg': 'kg', 'kilogramme': 'kg', 'kilogrammes': 'kg',
    'oz': 'oz', 'once': 'oz', 'onces': 'oz',
    'lb': 'lb', 'livre': 'lb', 'livres': 'lb',
    'piece': 'piece', 'pieces': 'piece', 'unite': 'piece', 'unites': 'piece',
    'pièce': 'piece', 'pièces': 'piece', 'unité': 'piece', 'unités': 'piece',
    'piece(s)': 'piece', 'pièce(s)': 'piece',
  }
  return aliases[key] ?? key
}

function familyOf(raw: string | null | undefined): UnitFamily | null {
  const key = normalize(raw)
  if (key === 'poids') return 'poids'
  if (key === 'volume') return 'volume'
  if (key === 'divers' || key === 'unité' || key === 'unite') return 'divers'
  return null
}

function parseReferenceFactor(reference: string | null | undefined, family: UnitFamily): number | null {
  if (!reference) return null
  const normalized = String(reference).replace(',', '.').toLowerCase()
  const pattern = family === 'poids'
    ? /(\d+(?:\.\d+)?)\s*g\b/
    : family === 'volume'
      ? /(\d+(?:\.\d+)?)\s*ml\b/
      : null
  if (!pattern) return null
  const match = normalized.match(pattern)
  const value = match ? Number(match[1]) : NaN
  return Number.isFinite(value) && value > 0 ? value : null
}

function canonicalFromMapping(mapping: UnitMappingLike): UnitDefinition | null {
  const family = familyOf(mapping.type_unite)
  if (!family || !mapping.unite?.trim()) return null

  let factor = parseReferenceFactor(mapping.equivalence_reference, family)
  if (factor == null) {
    const configured = Number(mapping.multiplicateur)
    factor = Number.isFinite(configured) && configured > 0 ? configured : 1
  }

  return {
    unit: mapping.unite.trim(),
    family,
    factorToFamilyBase: factor,
  }
}

export function getUnitDefinition(data: UnitEngineData, rawUnit: string | null | undefined): UnitDefinition | null {
  const wanted = unitKey(rawUnit)
  if (!wanted) return null

  const matches = data.unitMappings
    .map(mapping => ({ mapping, definition: canonicalFromMapping(mapping) }))
    .filter((entry): entry is { mapping: UnitMappingLike; definition: UnitDefinition } => {
      if (!entry.definition) return false
      const canonical = unitKey(entry.mapping.unite)
      const abbreviation = unitKey(entry.mapping.abreviation)
      return canonical === wanted || (!!abbreviation && abbreviation === wanted)
    })

  if (!matches.length) return null

  // Un alias doit être unique dans le référentiel. Si plusieurs lignes
  // correspondent malgré tout, on refuse la conversion plutôt que de choisir
  // arbitrairement une unité.
  const distinct = new Map(matches.map(entry => [entry.definition.unit, entry.definition]))
  if (distinct.size !== 1) return null

  return Array.from(distinct.values())[0]
}

export function canonicalUnitFromRaw(
  rawUnit: string | null | undefined,
  unitMappings: UnitMappingLike[],
): string | null {
  return getUnitDefinition({ unitMappings }, rawUnit)?.unit ?? null
}

export function isKnownUnit(rawUnit: string | null | undefined, unitMappings: UnitMappingLike[]): boolean {
  return getUnitDefinition({ unitMappings }, rawUnit) !== null
}

export function getIngredientReferenceUnit(
  data: UnitEngineData,
  ingredientId: string | null | undefined,
): UnitDefinition | null {
  if (!ingredientId || !data.officialById) return null
  const ingredient = data.officialById.get(ingredientId)
  if (!ingredient?.unite_reference) return null
  return getUnitDefinition(data, ingredient.unite_reference)
}

function findDensity(
  data: UnitEngineData,
  ingredientId: string,
  rawUnit: string,
): IngredientDensityLike | null {
  const wanted = unitKey(rawUnit)
  return (data.densities ?? []).find(row =>
    row.ingredient_id === ingredientId && unitKey(row.unite) === wanted
  ) ?? null
}

function findDensityForCompatibleVolume(
  data: UnitEngineData,
  ingredientId: string,
  source: UnitDefinition,
): { density: IngredientDensityLike; densityUnit: UnitDefinition } | null {
  for (const density of data.densities ?? []) {
    if (density.ingredient_id !== ingredientId) continue
    const densityUnit = getUnitDefinition(data, density.unite)
    if (densityUnit?.family === source.family && source.family === 'volume') {
      return { density, densityUnit }
    }
  }
  return null
}

function densityForCrossFamily(
  data: UnitEngineData,
  ingredientId: string,
  source: UnitDefinition,
  sourceRawUnit: string,
  target: UnitDefinition,
  targetRawUnit: string,
): { density: IngredientDensityLike; densityUnit: UnitDefinition } | null {
  // Priorité à une densité attachée exactement à l'unité source/target.
  const exactSource = findDensity(data, ingredientId, sourceRawUnit)
  if (exactSource) {
    const densityUnit = getUnitDefinition(data, exactSource.unite)
    if (densityUnit) return { density: exactSource, densityUnit }
  }

  const exactTarget = findDensity(data, ingredientId, targetRawUnit)
  if (exactTarget) {
    const densityUnit = getUnitDefinition(data, exactTarget.unite)
    if (densityUnit) return { density: exactTarget, densityUnit }
  }

  if (source.family === 'volume' && target.family === 'poids') {
    return findDensityForCompatibleVolume(data, ingredientId, source)
  }

  return null
}

export function convertQuantity(params: {
  data: UnitEngineData
  ingredientId?: string | null
  quantity: number
  fromUnit: string
  toUnit?: string | null
  confirmedCrossFamily?: boolean
}): QuantityConversion {
  const {
    data,
    ingredientId = null,
    quantity,
    fromUnit,
    toUnit,
    confirmedCrossFamily = false,
  } = params

  if (!Number.isFinite(quantity)) {
    return {
      status: 'invalid_quantity', quantity: null, unit: null,
      sourceUnit: fromUnit, targetUnit: toUnit ?? '',
      sourceFamily: null, targetFamily: null,
      requiresConfirmation: false,
      reason: 'La quantité n’est pas numérique.',
    }
  }

  const source = getUnitDefinition(data, fromUnit)
  if (!source) {
    return {
      status: 'unknown_source_unit', quantity: null, unit: null,
      sourceUnit: fromUnit, targetUnit: toUnit ?? '',
      sourceFamily: null, targetFamily: null,
      requiresConfirmation: false,
      reason: `Unité source « ${fromUnit} » inconnue dans le référentiel Mealio.`,
    }
  }

  let targetUnit = toUnit?.trim() ?? ''
  if (!targetUnit) {
    const reference = getIngredientReferenceUnit(data, ingredientId)
    if (!reference) {
      return {
        status: 'missing_reference_unit', quantity: null, unit: null,
        sourceUnit: fromUnit, targetUnit: '',
        sourceFamily: source.family, targetFamily: null,
        requiresConfirmation: false,
        reason: `L’ingrédient ${ingredientId ?? ''} n’a pas d’unité de référence Mealio définie.`,
      }
    }
    targetUnit = reference.unit
  }

  const target = getUnitDefinition(data, targetUnit)
  if (!target) {
    return {
      status: 'unknown_target_unit', quantity: null, unit: null,
      sourceUnit: fromUnit, targetUnit,
      sourceFamily: source.family, targetFamily: null,
      requiresConfirmation: false,
      reason: `Unité cible « ${targetUnit} » inconnue dans le référentiel Mealio.`,
    }
  }

  if (unitKey(source.unit) === unitKey(target.unit)) {
    return {
      status: 'same_unit', quantity, unit: target.unit,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: false,
      reason: 'Même unité canonique.',
    }
  }

  if (source.family === target.family) {
    // "divers" est une famille de regroupement, pas une permission de convertir.
    if (source.family === 'divers') {
      return {
        status: 'impossible', quantity: null, unit: null,
        sourceUnit: fromUnit, targetUnit: target.unit,
        sourceFamily: source.family, targetFamily: target.family,
        requiresConfirmation: false,
        reason: `Aucune conversion automatique certaine entre « ${source.unit} » et « ${target.unit} ».`,
      }
    }

    const baseQuantity = quantity * source.factorToFamilyBase
    const converted = baseQuantity / target.factorToFamilyBase

    return {
      status: 'converted', quantity: converted, unit: target.unit,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: false,
      reason: `${source.unit} → ${target.unit} : conversion déterministe dans la famille ${source.family}.`,
    }
  }

  if (!ingredientId) {
    return {
      status: 'impossible', quantity: null, unit: null,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: false,
      reason: 'Une conversion inter-familles exige un ingrédient officiel.',
    }
  }

  const explicit = (data.explicitConversions ?? []).find(rule =>
    rule.ingredient_id === ingredientId &&
    unitKey(rule.from_unit) === unitKey(source.unit) &&
    unitKey(rule.to_unit) === unitKey(target.unit) &&
    Number.isFinite(Number(rule.multiplier)) &&
    Number(rule.multiplier) > 0
  )

  if (explicit) {
    if (!confirmedCrossFamily && source.family !== target.family) {
      return {
        status: 'needs_confirmation', quantity: null, unit: null,
        sourceUnit: fromUnit, targetUnit: target.unit,
        sourceFamily: source.family, targetFamily: target.family,
        requiresConfirmation: true,
        reason: `La conversion ${source.unit} → ${target.unit} repose sur une règle explicite et nécessite une confirmation.`,
      }
    }
    return {
      status: 'converted', quantity: quantity * Number(explicit.multiplier), unit: target.unit,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: source.family !== target.family,
      reason: `${source.unit} → ${target.unit} via règle explicite${explicit.description ? ` (${explicit.description})` : ''}.`,
    }
  }

  const densityBundle = densityForCrossFamily(
    data,
    ingredientId,
    source,
    fromUnit,
    target,
    targetUnit,
  )

  if (!densityBundle) {
    return {
      status: 'impossible', quantity: null, unit: null,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: false,
      reason: `Aucune conversion fiable entre les familles ${source.family} et ${target.family} n’est définie pour cet ingrédient.`,
    }
  }

  if (!confirmedCrossFamily) {
    return {
      status: 'needs_confirmation', quantity: null, unit: null,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: true,
      reason: `La conversion ${source.family} → ${target.family} est possible via une règle explicite, mais nécessite la confirmation de l’utilisateur.`,
    }
  }

  const gramsPerDensityUnit = Number(densityBundle.density.poids_g_approx)
  if (!Number.isFinite(gramsPerDensityUnit) || gramsPerDensityUnit <= 0) {
    return {
      status: 'impossible', quantity: null, unit: null,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: false,
      reason: 'La règle de conversion référencée possède une valeur de densité invalide.',
    }
  }

  let grams: number
  if (source.family === 'volume' && target.family === 'poids') {
    const sourceBase = quantity * source.factorToFamilyBase
    const densityBase = densityBundle.densityUnit.factorToFamilyBase
    grams = (sourceBase / densityBase) * gramsPerDensityUnit
    return {
      status: 'converted', quantity: grams / target.factorToFamilyBase, unit: target.unit,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: true,
      reason: `${source.unit} → ${target.unit} via densité explicite (confirmation validée).`,
    }
  }

  if (source.family === 'poids' && target.family === 'volume') {
    const sourceGrams = quantity * source.factorToFamilyBase
    const densityBase = densityBundle.densityUnit.factorToFamilyBase
    const targetBaseVolume = (sourceGrams / gramsPerDensityUnit) * densityBase
    return {
      status: 'converted', quantity: targetBaseVolume / target.factorToFamilyBase, unit: target.unit,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: true,
      reason: `${source.unit} → ${target.unit} via densité explicite (confirmation validée).`,
    }
  }

  // Les conversions divers ↔ poids restent possibles uniquement avec une
  // densité/masse explicite attachée à l'unité concernée.
  if (source.family === 'divers' && target.family === 'poids') {
    const sourceDensity = findDensity(data, ingredientId, fromUnit)
    if (!sourceDensity) {
      return {
        status: 'impossible', quantity: null, unit: null,
        sourceUnit: fromUnit, targetUnit: target.unit,
        sourceFamily: source.family, targetFamily: target.family,
        requiresConfirmation: false,
        reason: 'Aucune masse explicite n’est définie pour cette unité discrète.',
      }
    }
    const grams = quantity * Number(sourceDensity.poids_g_approx)
    return {
      status: 'converted', quantity: grams / target.factorToFamilyBase, unit: target.unit,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: true,
      reason: `${source.unit} → ${target.unit} via masse explicite (confirmation validée).`,
    }
  }

  if (source.family === 'poids' && target.family === 'divers') {
    const targetDensity = findDensity(data, ingredientId, targetUnit)
    if (!targetDensity) {
      return {
        status: 'impossible', quantity: null, unit: null,
        sourceUnit: fromUnit, targetUnit: target.unit,
        sourceFamily: source.family, targetFamily: target.family,
        requiresConfirmation: false,
        reason: 'Aucune masse explicite n’est définie pour cette unité discrète.',
      }
    }
    const grams = quantity * source.factorToFamilyBase
    return {
      status: 'converted', quantity: grams / Number(targetDensity.poids_g_approx), unit: target.unit,
      sourceUnit: fromUnit, targetUnit: target.unit,
      sourceFamily: source.family, targetFamily: target.family,
      requiresConfirmation: true,
      reason: `${source.unit} → ${target.unit} via masse explicite (confirmation validée).`,
    }
  }

  return {
    status: 'impossible', quantity: null, unit: null,
    sourceUnit: fromUnit, targetUnit: target.unit,
    sourceFamily: source.family, targetFamily: target.family,
    requiresConfirmation: false,
    reason: 'Conversion inter-familles non définie.',
  }
}

export function assertReferenceUnit(
  data: UnitEngineData,
  ingredientId: string,
): UnitDefinition {
  const reference = getIngredientReferenceUnit(data, ingredientId)
  if (!reference) {
    throw new Error(`UNIT_REFERENCE_MISSING:${ingredientId}: L’unité de référence Mealio de cet ingrédient n’est pas définie. Un administrateur doit la renseigner avant de poursuivre.`)
  }
  return reference
}

export function convertToIngredientReference(params: {
  data: UnitEngineData
  ingredientId: string
  quantity: number
  fromUnit: string
  confirmedCrossFamily?: boolean
}): QuantityConversion {
  const reference = getIngredientReferenceUnit(params.data, params.ingredientId)
  if (!reference) {
    return {
      status: 'missing_reference_unit', quantity: null, unit: null,
      sourceUnit: params.fromUnit, targetUnit: '',
      sourceFamily: getUnitDefinition(params.data, params.fromUnit)?.family ?? null,
      targetFamily: null,
      requiresConfirmation: false,
      reason: `L’ingrédient ${params.ingredientId} n’a pas d’unité de référence Mealio.`,
    }
  }

  return convertQuantity({
    data: params.data,
    ingredientId: params.ingredientId,
    quantity: params.quantity,
    fromUnit: params.fromUnit,
    toUnit: reference.unit,
    confirmedCrossFamily: params.confirmedCrossFamily,
  })
}
