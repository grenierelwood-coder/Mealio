import { isPresenceOnlyIngredient } from './quantity-policy'

export type DataQualitySeverity = 'error' | 'warning' | 'info'
export type DataQualityCategory = 'referentiel' | 'synonymes' | 'equivalences' | 'donnees' | 'unites' | 'conversions' | 'quantites'

export type DataQualityIssue = {
  code: string
  severity: DataQualitySeverity
  category: DataQualityCategory
  title: string
  message: string
  ingredientId?: string
  ingredientName?: string
  unit?: string | null
  relatedTable?: string
  relatedCount?: number
  synonym?: string | null
}

export type DataQualityDataset = {
  ingredients: Array<{
    id: string
    nom: string | null
    categorie: string | null
    rayon: string | null
    default_storage: string | null
    default_is_fridge: boolean | null
    unite_reference: string | null
  }>
  synonyms: Array<{ mot_recette: string | null; ingredient_id: string | null }>
  units: Array<{
    unite: string | null
    abreviation: string | null
    type_unite: string | null
    equivalence_reference?: string | null
    multiplicateur?: number | null
  }>
  densities: Array<{ ingredient_id: string | null; unite: string | null; poids_g_approx: number | null }>
  conversions: Array<{
    ingredient_id?: string | null
    from_unit: string | null
    to_unit: string | null
    multiplier?: number | null
  }>
  bridges: Array<{
    ingredient_id?: string | null
    from_unit: string | null
    to_unit: string | null
    factor?: number | null
  }>
  usage: Array<{
    table: string
    rows: Array<{ ingredient_id: string | null; unite: string | null }>
  }>
}

export type DataQualityReport = {
  generatedAt?: string
  summary: {
    ingredients: number
    units: number
    synonyms: number
    densities: number
    conversions: number
    bridges: number
    usageRows: number
    errors: number
    warnings: number
    infos: number
    status: 'PASS' | 'FAIL'
  }
  issues: DataQualityIssue[]
  grouped: Array<DataQualityIssue & { count: number }>
}

export function normalizeDataQualityValue(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function categoryForCode(code: string): DataQualityCategory {
  if (code.includes('SYNONYM')) return 'synonymes'
  if (code.includes('DENSITY') || code.includes('EQUIVALENCE')) return 'equivalences'
  if (code.includes('CONVERSION') || code.includes('BRIDGE')) return 'conversions'
  if (code.includes('QUANTITY')) return 'quantites'
  if (code.includes('UNIT') || code.includes('REFERENCE_UNIT')) return 'unites'
  if (code.includes('USAGE') || code.includes('HISTORICAL') || code.includes('ORPHAN_USAGE')) return 'donnees'
  return 'referentiel'
}

function positiveNumber(value: unknown): boolean {
  const n = Number(value)
  return Number.isFinite(n) && n > 0
}

function pushIssue(issues: DataQualityIssue[], issue: Omit<DataQualityIssue, 'category'> & { category?: DataQualityCategory }) {
  issues.push({ ...issue, category: issue.category ?? categoryForCode(issue.code) })
}

export function runDataQualityAudit(dataset: DataQualityDataset): DataQualityReport {
  const issues: DataQualityIssue[] = []
  const ingredients = dataset.ingredients
  const ingredientById = new Map(ingredients.map(i => [i.id, i]))
  const unitByNorm = new Map<string, DataQualityDataset['units'][number]>()

  for (const unit of dataset.units) {
    const key = normalizeDataQualityValue(unit.unite)
    if (key) unitByNorm.set(key, unit)
  }

  // ---------------------------------------------------------------------------
  // 1. Référentiel officiel des ingrédients
  // ---------------------------------------------------------------------------
  for (const ingredient of ingredients) {
    const name = String(ingredient.nom ?? '').trim()
    const category = String(ingredient.categorie ?? '').trim()
    const rayon = String(ingredient.rayon ?? '').trim()

    if (!name) {
      pushIssue(issues, {
        code: 'INGREDIENT_NAME_MISSING', severity: 'error',
        title: 'Nom manquant', message: 'L’ingrédient officiel n’a pas de nom.',
        ingredientId: ingredient.id,
      })
    }
    if (!category) {
      pushIssue(issues, {
        code: 'CATEGORY_MISSING', severity: 'error',
        title: 'Catégorie manquante', message: 'La catégorie est vide.',
        ingredientId: ingredient.id, ingredientName: name,
      })
    }
    if (!rayon) {
      pushIssue(issues, {
        code: 'RAYON_MISSING', severity: 'error',
        title: 'Rayon manquant', message: 'Le rayon est vide.',
        ingredientId: ingredient.id, ingredientName: name,
      })
    }
    if (ingredient.default_storage !== 'frosti' && ingredient.default_storage !== 'cellio') {
      pushIssue(issues, {
        code: 'STORAGE_MISSING', severity: 'error',
        title: 'Destination de stock manquante',
        message: 'La destination doit être « frosti » ou « cellio ».',
        ingredientId: ingredient.id, ingredientName: name,
      })
    }
    if (ingredient.default_is_fridge === null || ingredient.default_is_fridge === undefined) {
      pushIssue(issues, {
        code: 'FRIDGE_MISSING', severity: 'error',
        title: 'Règle frigo manquante', message: 'Le champ frigo n’est pas défini.',
        ingredientId: ingredient.id, ingredientName: name,
      })
    }

    // Les ingrédients « présence » n'ont pas besoin d'une unité de calcul.
    if (!isPresenceOnlyIngredient(ingredient)) {
      const reference = String(ingredient.unite_reference ?? '').trim()
      if (!reference) {
        pushIssue(issues, {
          code: 'REFERENCE_UNIT_MISSING', severity: 'error',
          title: 'Unité de référence manquante',
          message: 'Aucune unité de référence n’est définie.',
          ingredientId: ingredient.id, ingredientName: name,
        })
      } else if (!unitByNorm.has(normalizeDataQualityValue(reference))) {
        pushIssue(issues, {
          code: 'REFERENCE_UNIT_UNKNOWN', severity: 'error',
          title: 'Unité de référence inconnue',
          message: `L’unité « ${reference} » n’existe pas dans unit_mappings.`,
          ingredientId: ingredient.id, ingredientName: name, unit: reference,
        })
      }
    }
  }

  // Même nom après normalisation = erreur de référentiel.
  const names = new Map<string, typeof ingredients>()
  for (const ingredient of ingredients) {
    const key = normalizeDataQualityValue(ingredient.nom)
    if (!key) continue
    const group = names.get(key) ?? []
    group.push(ingredient)
    names.set(key, group)
  }
  for (const group of names.values()) {
    if (group.length <= 1) continue
    pushIssue(issues, {
      code: 'DUPLICATE_INGREDIENT_NAME', severity: 'error',
      title: 'Noms d’ingrédients en doublon',
      message: `Même nom après normalisation : ${group.map(i => i.nom).join(' / ')}.`,
      ingredientId: group[0].id, ingredientName: group[0].nom ?? undefined,
    })
  }

  // ---------------------------------------------------------------------------
  // 2. Référentiel des unités
  // ---------------------------------------------------------------------------
  const unitNames = new Map<string, typeof dataset.units>()
  const unitAliases = new Map<string, Array<{ unit: string; kind: string }>>()
  for (const unit of dataset.units) {
    const name = String(unit.unite ?? '').trim()
    const abbreviation = String(unit.abreviation ?? '').trim()
    const nameKey = normalizeDataQualityValue(name)

    if (!name) {
      pushIssue(issues, {
        code: 'UNIT_NAME_MISSING', severity: 'error',
        title: 'Nom d’unité manquant', message: 'Une ligne de unit_mappings n’a pas de nom.',
        relatedTable: 'unit_mappings',
      })
      continue
    }

    if (!nameKey) continue
    const group = unitNames.get(nameKey) ?? []
    group.push(unit)
    unitNames.set(nameKey, group)

    if (abbreviation) {
      const aliasKey = normalizeDataQualityValue(abbreviation)
      const aliases = unitAliases.get(aliasKey) ?? []
      aliases.push({ unit: name, kind: 'abréviation' })
      unitAliases.set(aliasKey, aliases)
    }

    const family = normalizeDataQualityValue(unit.type_unite)
    if (!family) {
      pushIssue(issues, {
        code: 'UNIT_FAMILY_MISSING', severity: 'error',
        title: 'Famille d’unité manquante', message: `« ${name} » n’a pas de famille.`,
        relatedTable: 'unit_mappings', unit: name,
      })
    } else if (!['poids', 'volume', 'divers'].includes(family)) {
      pushIssue(issues, {
        code: 'UNIT_FAMILY_UNKNOWN', severity: 'error',
        title: 'Famille d’unité inconnue', message: `« ${name} » a une famille « ${unit.type_unite} » non reconnue.`,
        relatedTable: 'unit_mappings', unit: name,
      })
    }

    if (unit.multiplicateur !== null && unit.multiplicateur !== undefined && !positiveNumber(unit.multiplicateur)) {
      pushIssue(issues, {
        code: 'UNIT_MULTIPLIER_INVALID', severity: 'error',
        title: 'Multiplicateur d’unité invalide', message: `Le multiplicateur de « ${name} » doit être positif.`,
        relatedTable: 'unit_mappings', unit: name,
      })
    }
  }

  for (const group of unitNames.values()) {
    if (group.length > 1) {
      pushIssue(issues, {
        code: 'DUPLICATE_UNIT_NAME', severity: 'error',
        title: 'Unités en doublon',
        message: `Même unité après normalisation : ${group.map(u => u.unite).join(' / ')}.`,
        relatedTable: 'unit_mappings', unit: group[0].unite,
      })
    }
  }
  for (const [alias, entries] of unitAliases) {
    const distinct = new Set(entries.map(e => normalizeDataQualityValue(e.unit)))
    if (distinct.size > 1) {
      pushIssue(issues, {
        code: 'AMBIGUOUS_UNIT_ABBREVIATION', severity: 'error',
        title: 'Abréviation d’unité ambiguë',
        message: `L’abréviation « ${alias} » désigne plusieurs unités : ${entries.map(e => e.unit).join(' / ')}.`,
        relatedTable: 'unit_mappings', unit: entries[0].unit,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Synonymes
  // ---------------------------------------------------------------------------
  const synonymNames = new Map<string, typeof dataset.synonyms>()
  for (const synonym of dataset.synonyms) {
    const term = String(synonym.mot_recette ?? '').trim()
    if (!term) {
      pushIssue(issues, {
        code: 'SYNONYM_MISSING', severity: 'error',
        title: 'Synonyme vide', message: 'Un synonyme ne contient aucun terme.',
        relatedTable: 'ingredient_synonyms',
      })
      continue
    }
    if (!synonym.ingredient_id || !ingredientById.has(synonym.ingredient_id)) {
      pushIssue(issues, {
        code: 'ORPHAN_SYNONYM', severity: 'error',
        title: 'Synonyme orphelin', message: `« ${term} » pointe vers un ingrédient inexistant.`,
        relatedTable: 'ingredient_synonyms', synonym: term,
      })
    }
    const key = normalizeDataQualityValue(term)
    const group = synonymNames.get(key) ?? []
    group.push(synonym)
    synonymNames.set(key, group)
  }
  for (const [key, group] of synonymNames) {
    const targets = new Set(group.map(s => s.ingredient_id))
    if (targets.size > 1) {
      pushIssue(issues, {
        code: 'AMBIGUOUS_SYNONYM', severity: 'error',
        title: 'Synonyme ambigu',
        message: `« ${group[0].mot_recette} » pointe vers plusieurs ingrédients.`,
        relatedTable: 'ingredient_synonyms', synonym: group[0].mot_recette,
      })
    }
    const target = ingredientById.get(group[0].ingredient_id ?? '')
    if (target && normalizeDataQualityValue(target.nom) === key) {
      pushIssue(issues, {
        code: 'REDUNDANT_SYNONYM', severity: 'warning',
        title: 'Synonyme redondant',
        message: `« ${group[0].mot_recette} » est identique au nom de sa cible « ${target.nom} ».`,
        relatedTable: 'ingredient_synonyms', ingredientId: target.id,
        ingredientName: target.nom ?? undefined, synonym: group[0].mot_recette,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Densités : source unique des conversions culinaires spécifiques.
  // ---------------------------------------------------------------------------
  const densitiesByIngredient = new Map<string, typeof dataset.densities>()
  for (const density of dataset.densities) {
    const ingredient = ingredientById.get(density.ingredient_id ?? '')
    if (!ingredient) {
      pushIssue(issues, {
        code: 'ORPHAN_DENSITY', severity: 'error',
        title: 'Densité orpheline', message: 'La densité pointe vers un ingrédient inexistant.',
        relatedTable: 'ingredient_densities', unit: density.unite,
      })
      continue
    }
    if (isPresenceOnlyIngredient(ingredient)) {
      pushIssue(issues, {
        code: 'PRESENCE_DENSITY_UNEXPECTED', severity: 'warning',
        title: 'Densité sur un ingrédient « présence »',
        message: `« ${ingredient.nom} » est géré en présence : sa densité n'est normalement pas nécessaire.`,
        relatedTable: 'ingredient_densities', ingredientId: ingredient.id,
        ingredientName: ingredient.nom ?? undefined, unit: density.unite,
      })
    }
    if (!density.unite || !unitByNorm.has(normalizeDataQualityValue(density.unite))) {
      pushIssue(issues, {
        code: 'DENSITY_UNIT_UNKNOWN', severity: 'error',
        title: 'Unité de densité inconnue',
        message: `« ${density.unite ?? '—'} » n’existe pas dans unit_mappings.`,
        relatedTable: 'ingredient_densities', ingredientId: ingredient.id,
        ingredientName: ingredient.nom ?? undefined, unit: density.unite,
      })
    }
    if (!positiveNumber(density.poids_g_approx)) {
      pushIssue(issues, {
        code: 'DENSITY_INVALID', severity: 'error',
        title: 'Densité invalide',
        message: `Le poids associé à 1 ${density.unite ?? 'unité'} doit être strictement positif.`,
        relatedTable: 'ingredient_densities', ingredientId: ingredient.id,
        ingredientName: ingredient.nom ?? undefined, unit: density.unite,
      })
    }
    const key = `${density.ingredient_id}|${normalizeDataQualityValue(density.unite)}`
    const group = densitiesByIngredient.get(key) ?? []
    group.push(density)
    densitiesByIngredient.set(key, group)
  }
  for (const [key, group] of densitiesByIngredient) {
    if (group.length > 1) {
      const [ingredientId] = key.split('|')
      const ingredient = ingredientById.get(ingredientId)
      pushIssue(issues, {
        code: 'DUPLICATE_DENSITY', severity: 'error',
        title: 'Densités en doublon',
        message: `Plusieurs densités existent pour « ${ingredient?.nom ?? ingredientId} » et l’unité « ${group[0].unite} ».`,
        relatedTable: 'ingredient_densities', ingredientId,
        ingredientName: ingredient?.nom ?? undefined, unit: group[0].unite,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Anciennes tables de conversions : elles doivent rester vides.
  // ---------------------------------------------------------------------------
  if (dataset.conversions.length > 0) {
    pushIssue(issues, {
      code: 'OBSOLETE_CONVERSIONS_NOT_EMPTY', severity: 'error',
      title: 'Anciennes conversions encore présentes',
      message: `${dataset.conversions.length} ligne(s) existent dans ingredient_unit_conversions. Cette table est désormais historique et doit rester vide.`,
      relatedTable: 'ingredient_unit_conversions', relatedCount: dataset.conversions.length,
    })
  }
  if (dataset.bridges.length > 0) {
    pushIssue(issues, {
      code: 'OBSOLETE_BRIDGES_NOT_EMPTY', severity: 'error',
      title: 'Anciens ponts d’unités encore présents',
      message: `${dataset.bridges.length} ligne(s) existent dans ingredient_unit_bridges. Cette table est désormais historique et doit rester vide.`,
      relatedTable: 'ingredient_unit_bridges', relatedCount: dataset.bridges.length,
    })
  }

  // ---------------------------------------------------------------------------
  // 6. Données opérationnelles : toute ligne liée à un ingrédient officiel
  //    doit respecter son unité de référence. Une divergence historique est
  //    signalée en warning, pas en erreur, afin de ne pas confondre audit et
  //    migration de données anciennes.
  // ---------------------------------------------------------------------------
  for (const table of dataset.usage) {
    const mismatch = new Map<string, { ingredient: typeof ingredients[number]; unit: string; count: number }>()
    for (const row of table.rows) {
      if (!row.ingredient_id) continue
      const ingredient = ingredientById.get(row.ingredient_id)
      if (!ingredient) {
        pushIssue(issues, {
          code: 'ORPHAN_USAGE', severity: 'error',
          title: 'Donnée opérationnelle orpheline',
          message: `Une ligne de ${table.table} référence un ingrédient inexistant.`,
          relatedTable: table.table,
        })
        continue
      }
      if (isPresenceOnlyIngredient(ingredient)) continue
      const unit = String(row.unite ?? '').trim()
      if (!unit) {
        pushIssue(issues, {
          code: 'USAGE_UNIT_MISSING', severity: 'error',
          title: 'Unité opérationnelle manquante',
          message: `Une ligne de ${table.table} liée à « ${ingredient.nom} » n’a pas d’unité.`,
          relatedTable: table.table, ingredientId: ingredient.id,
          ingredientName: ingredient.nom ?? undefined,
        })
        continue
      }
      if (!unitByNorm.has(normalizeDataQualityValue(unit))) {
        pushIssue(issues, {
          code: 'USAGE_UNIT_UNKNOWN', severity: 'error',
          title: 'Unité opérationnelle inconnue',
          message: `« ${unit} » n’existe pas dans unit_mappings.`,
          relatedTable: table.table, ingredientId: ingredient.id,
          ingredientName: ingredient.nom ?? undefined, unit,
        })
        continue
      }
      const reference = String(ingredient.unite_reference ?? '').trim()
      if (reference && normalizeDataQualityValue(unit) !== normalizeDataQualityValue(reference)) {
        const key = `${ingredient.id}|${normalizeDataQualityValue(unit)}`
        const current = mismatch.get(key)
        mismatch.set(key, { ingredient, unit, count: (current?.count ?? 0) + 1 })
      }
    }
    for (const value of mismatch.values()) {
      pushIssue(issues, {
        code: 'HISTORICAL_UNIT_MISMATCH', severity: 'warning',
        title: 'Unité historique différente',
        message: `${value.count} ligne(s) de ${table.table} utilisent « ${value.unit} » alors que la référence actuelle est « ${value.ingredient.unite_reference} ».`,
        relatedTable: table.table, relatedCount: value.count,
        ingredientId: value.ingredient.id, ingredientName: value.ingredient.nom ?? undefined,
        unit: value.unit,
      })
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length
  const warnings = issues.filter(i => i.severity === 'warning').length
  const infos = issues.filter(i => i.severity === 'info').length
  const grouped = Array.from(new Set(issues.map(i => i.code))).map(code => {
    const first = issues.find(i => i.code === code)!
    return { ...first, count: issues.filter(i => i.code === code).length }
  })

  return {
    summary: {
      ingredients: ingredients.length,
      units: dataset.units.length,
      synonyms: dataset.synonyms.length,
      densities: dataset.densities.length,
      conversions: dataset.conversions.length,
      bridges: dataset.bridges.length,
      usageRows: dataset.usage.reduce((total, table) => total + table.rows.length, 0),
      errors,
      warnings,
      infos,
      status: errors === 0 ? 'PASS' : 'FAIL',
    },
    issues,
    grouped,
  }
}
