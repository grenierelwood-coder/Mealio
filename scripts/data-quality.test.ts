import assert from 'node:assert/strict'
import test from 'node:test'
import { runDataQualityAudit, type DataQualityDataset } from '../app/utils/data-quality'
import { assertDensityAllowed, getQuantityMode } from '../app/utils/quantity-policy'

const base: DataQualityDataset = {
  ingredients: [
    { id: 'miel', nom: 'Miel', categorie: 'Épicerie sucrée', rayon: 'Épicerie', default_storage: 'cellio', default_is_fridge: false, unite_reference: 'Gramme' },
  ],
  synonyms: [],
  units: [
    { unite: 'Gramme', abreviation: 'g', type_unite: 'poids', multiplicateur: 1 },
    { unite: 'Cuillère à soupe', abreviation: 'cs', type_unite: 'divers', multiplicateur: 1 },
    { unite: 'Cuillère à café', abreviation: 'cc', type_unite: 'divers', multiplicateur: 1 },
  ],
  densities: [
    { ingredient_id: 'miel', unite: 'cs', poids_g_approx: 21 },
    { ingredient_id: 'miel', unite: 'cc', poids_g_approx: 7 },
  ],
  conversions: [],
  bridges: [],
  usage: [
    { table: 'shopping_items', rows: [{ ingredient_id: 'miel', unite: 'Gramme' }] },
  ],
}

test('PASS: référentiel cohérent et conversions obsolètes vides', () => {
  const report = runDataQualityAudit(base)
  assert.equal(report.summary.status, 'PASS')
  assert.equal(report.summary.errors, 0)
})

test('FAIL: une conversion obsolète matérialisée est interdite', () => {
  const report = runDataQualityAudit({
    ...base,
    conversions: [{ ingredient_id: 'miel', from_unit: 'cs', to_unit: 'cc', multiplier: 3 }],
  })
  assert.equal(report.summary.status, 'FAIL')
  assert.ok(report.issues.some(i => i.code === 'OBSOLETE_CONVERSIONS_NOT_EMPTY'))
})

test('FAIL: un pont obsolète matérialisé est interdit', () => {
  const report = runDataQualityAudit({
    ...base,
    bridges: [{ ingredient_id: 'miel', from_unit: 'cs', to_unit: 'cc', factor: 3 }],
  })
  assert.equal(report.summary.status, 'FAIL')
  assert.ok(report.issues.some(i => i.code === 'OBSOLETE_BRIDGES_NOT_EMPTY'))
})

test('FAIL: une unité officielle inconnue est détectée', () => {
  const report = runDataQualityAudit({
    ...base,
    ingredients: [{ ...base.ingredients[0], unite_reference: 'Unité fantôme' }],
  })
  assert.ok(report.issues.some(i => i.code === 'REFERENCE_UNIT_UNKNOWN'))
})

test('FAIL: une densité invalide est détectée', () => {
  const report = runDataQualityAudit({
    ...base,
    densities: [{ ingredient_id: 'miel', unite: 'cs', poids_g_approx: 0 }],
  })
  assert.ok(report.issues.some(i => i.code === 'DENSITY_INVALID'))
})

test('FAIL: un synonyme ambigu est détecté', () => {
  const dataset = {
    ...base,
    ingredients: [
      ...base.ingredients,
      { id: 'sucre', nom: 'Sucre', categorie: 'Épicerie sucrée', rayon: 'Épicerie', default_storage: 'cellio', default_is_fridge: false, unite_reference: 'Gramme' },
    ],
    synonyms: [
      { mot_recette: 'sucre', ingredient_id: 'miel' },
      { mot_recette: 'sucre', ingredient_id: 'sucre' },
    ],
  }
  const report = runDataQualityAudit(dataset)
  assert.ok(report.issues.some(i => i.code === 'AMBIGUOUS_SYNONYM'))
})

test('WARNING: une ancienne unité opérationnelle différente de la référence est signalée', () => {
  const report = runDataQualityAudit({
    ...base,
    usage: [{ table: 'shopping_items', rows: [{ ingredient_id: 'miel', unite: 'Cuillère à soupe' }] }],
  })
  assert.equal(report.summary.status, 'PASS')
  assert.ok(report.issues.some(i => i.code === 'HISTORICAL_UNIT_MISMATCH'))
})


test('PASS: tout ingrédient en mode Présence est protégé contre les densités', () => {
  const presenceIngredients = [
    { nom: 'Sel fin', categorie: 'Épicerie salée' },
    { nom: 'Poivre noir', categorie: 'Épicerie salée' },
    { nom: 'Moutarde', categorie: 'Épicerie salée & Condiments' },
    { nom: 'Herbes de Provence', categorie: 'Épices & Herbes séchées' },
  ]

  for (const ingredient of presenceIngredients) {
    assert.equal(getQuantityMode(ingredient), 'presence')
    assert.throws(() => assertDensityAllowed(ingredient), /mode « Présence »/)
  }
})

test('PASS: un ingrédient quantifiable peut recevoir une densité', () => {
  const ingredient = { nom: 'Miel', categorie: 'Épicerie sucrée' }
  assert.equal(getQuantityMode(ingredient), 'quantity')
  assert.doesNotThrow(() => assertDensityAllowed(ingredient))
})
