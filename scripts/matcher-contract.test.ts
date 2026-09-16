import test from 'node:test'
import assert from 'node:assert/strict'

import {
  aggregateRequirements,
  analyzeRecipe,
  compareToStock,
  convertStockQuantity,
  createMatcherTrace,
  resolveIngredientDeterministic,
  resolveRecipeIngredients,
} from '../app/utils/matcher'
import {
  assertDensityAllowed,
  getQuantityMode,
  isDensityAllowed,
} from '../app/utils/quantity-policy'
import {
  IDS,
  ingredient,
  makeReferenceData,
  stock,
  stockItem,
} from './matcher-test-fixtures'

const ref = makeReferenceData()
const TEST_STOP_WORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'et', 'à', 'a', 'au', 'aux',
  'en', 'pour', 'avec', 'sans', 'frais', 'fraiche', 'fraîche',
])

function requirement(ingredientId: string, produit: string, qte: number, unite: string, mode: 'quantity' | 'presence' = 'quantity') {
  return {
    produit,
    ingredient_id: ingredientId,
    qte,
    unite,
    quantity_mode: mode,
    needs_review: false,
    contributions: [],
  }
}

test('résolution déterministe : exact, synonyme et refus du faux positif', () => {
  const exact = resolveIngredientDeterministic('Farine de blé', ref)
  assert.equal(exact.id, IDS.farine)
  assert.equal(exact.source, 'lexical')

  const synonym = resolveIngredientDeterministic('zucchini', ref)
  assert.equal(synonym.id, IDS.courgette)
  assert.equal(synonym.source, 'synonym')

  const unknown = resolveIngredientDeterministic('Ananas', ref)
  assert.equal(unknown.id, null)
  assert.equal(unknown.source, 'unresolved')
})

test('normalisation de ligne : quantité, unité et synonymes', async () => {
  const resolved = await resolveRecipeIngredients(
    [ingredient('belles courgettes', 2, 'pièces')],
    ref,
    'r1',
    'Test',
  )

  assert.equal(resolved.length, 1)
  assert.equal(resolved[0].ingredient_id, IDS.courgette)
  assert.equal(resolved[0].qte, 2)
  assert.equal(resolved[0].quantity_mode, 'quantity')
})

test('servings : le besoin est correctement redimensionné', async () => {
  const resolved = await resolveRecipeIngredients(
    [ingredient('Farine de blé', 200, 'g')],
    ref,
    'r1',
    'Test',
    2,
  )

  assert.equal(resolved[0].qte, 400)
  assert.equal(resolved[0].unite, 'g')
})

test('miel : cs et cc utilisent uniquement les densités explicites', async () => {
  const resolved = await resolveRecipeIngredients(
    [ingredient('Miel', 2, 'cs')],
    ref,
    'r1',
    'Test',
  )

  assert.equal(resolved[0].qte, 42)
  assert.equal(resolved[0].unite, 'g')

  const csToCc = convertStockQuantity(ref, IDS.miel, 2, 'cs', 'cc')
  assert.ok(csToCc)
  assert.equal(csToCc?.unit, 'mL')
  assert.equal(csToCc?.qty, 30)

  const gramsToCs = convertStockQuantity(ref, IDS.miel, 42, 'g', 'cs')
  assert.ok(gramsToCs)
  assert.equal(gramsToCs?.unit, 'mL')
  assert.equal(gramsToCs?.qty, 30)

  const forbidden = convertStockQuantity(ref, IDS.miel, 42, 'g', 'l')
  assert.equal(forbidden, null)
})

test('presence-only : jamais de calcul quantitatif ni de densité', async () => {
  assert.equal(getQuantityMode({ nom: 'Sel fin', categorie: 'Épicerie salée & Condiments' }), 'presence')
  assert.equal(isDensityAllowed({ nom: 'Sel fin', categorie: 'Épicerie salée & Condiments' }), false)
  assert.throws(() => assertDensityAllowed({ nom: 'Sel fin', categorie: 'Épicerie salée & Condiments' }))

  const refWithLegacyDensity = makeReferenceData()
  refWithLegacyDensity.densities.push({ ingredient_id: IDS.sel, unite: 'g', poids_g_approx: 6 })

  const converted = convertStockQuantity(refWithLegacyDensity, IDS.sel, 2, 'g', 'g')
  assert.ok(converted)
  assert.equal(converted?.qty, 2)

  const resolved = await resolveRecipeIngredients(
    [ingredient('Sel fin', 3, 'cc')],
    refWithLegacyDensity,
    'r1',
    'Test',
  )

  assert.equal(resolved[0].quantity_mode, 'presence')
  assert.equal(resolved[0].qte, 1)
  assert.equal(resolved[0].unite, 'Pièce')
})

test('plusieurs lignes de stock exactes sont toutes additionnées', async () => {
  const result = await compareToStock(
    [requirement(IDS.farine, 'Farine de blé', 500, 'g')],
    stock(
      stockItem('s1', 'Farine de blé', 100, 'g', IDS.farine),
      stockItem('s2', 'Farine de blé', 150, 'g', IDS.farine),
      stockItem('s3', 'Farine de blé', 200, 'g', IDS.farine),
    ),
    ref,
    createMatcherTrace('Farine de blé'),
    { stopWords: TEST_STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )

  assert.equal(result[0].qte_stock, 450)
  assert.equal(result[0].qte_a_acheter, 50)
})

test('stock supérieur au besoin : aucun achat', async () => {
  const result = await compareToStock(
    [requirement(IDS.farine, 'Farine de blé', 300, 'g')],
    stock(stockItem('s1', 'Farine de blé', 450, 'g', IDS.farine)),
    ref,
    undefined,
    { stopWords: TEST_STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )

  assert.equal(result[0].qte_a_acheter, 0)
})

test('stock insuffisant : achat égal au manque', async () => {
  const result = await compareToStock(
    [requirement(IDS.farine, 'Farine de blé', 500, 'g')],
    stock(stockItem('s1', 'Farine de blé', 120, 'g', IDS.farine)),
    ref,
    undefined,
    { stopWords: TEST_STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )

  assert.equal(result[0].qte_a_acheter, 380)
})

test('anti-faux-positif : courgette ne doit pas matcher poireau', async () => {
  const result = await compareToStock(
    [requirement(IDS.courgette, 'Courgette', 2, 'piece')],
    stock(stockItem('s1', 'Poireau', 10, 'piece', IDS.poireau)),
    ref,
    undefined,
    { stopWords: TEST_STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )

  assert.equal(result[0].qte_stock, 0)
  assert.equal(result[0].qte_a_acheter, 2)
})

test('anti-faux-positif : farine de blé ne doit pas consommer farine de riz', async () => {
  const result = await compareToStock(
    [requirement(IDS.farine, 'Farine de blé', 500, 'g')],
    stock(stockItem('s1', 'Farine de riz', 1000, 'g', IDS.farineRiz)),
    ref,
    undefined,
    { stopWords: TEST_STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )

  assert.equal(result[0].qte_stock, 0)
  assert.equal(result[0].qte_a_acheter, 500)
})

test('presence : stock présent = aucun achat, stock absent = présence à acheter', async () => {
  const present = await compareToStock(
    [requirement(IDS.sel, 'Sel fin', 1, 'Pièce', 'presence')],
    stock(stockItem('s1', 'Sel fin', 1, 'boîte', IDS.sel)),
    ref,
    undefined,
    { stopWords: TEST_STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(present[0].qte_a_acheter, 0)

  const absent = await compareToStock(
    [requirement(IDS.sel, 'Sel fin', 1, 'Pièce', 'presence')],
    stock(),
    ref,
    undefined,
    { stopWords: TEST_STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(absent[0].qte_a_acheter, 1)
})

test('pipeline complet : recette → résolution → agrégation → stock → achat', async () => {
  const result = await analyzeRecipe(
    {
      id: 'recipe-1',
      nom: 'Crêpes test',
      baseServings: 4,
      servings: 4,
      ingredients: [
        ingredient('Farine de blé', 500, 'g'),
        ingredient('Miel', 2, 'cs'),
        ingredient('Sel fin', 1, 'cc'),
      ],
    },
    stock(
      stockItem('s1', 'Farine de blé', 300, 'g', IDS.farine),
      stockItem('s2', 'Miel', 20, 'g', IDS.miel),
      stockItem('s3', 'Sel fin', 1, 'boîte', IDS.sel),
    ),
    ref,
    undefined,
    { stopWords: TEST_STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )

  const flour = result.compared.find(x => x.ingredient_id === IDS.farine)
  const honey = result.compared.find(x => x.ingredient_id === IDS.miel)
  const salt = result.compared.find(x => x.ingredient_id === IDS.sel)

  assert.ok(flour)
  assert.ok(honey)
  assert.ok(salt)
  assert.equal(flour?.qte_a_acheter, 200)
  assert.equal(honey?.qte_a_acheter, 22)
  assert.equal(salt?.qte_a_acheter, 0)
})

test('agrégation : deux recettes partagent correctement le même besoin', () => {
  const a = {
    produit: 'Farine de blé', ingredient_id: IDS.farine, qte: 200, unite: 'g',
    quantity_mode: 'quantity' as const, needs_review: false,
    contributions: [{ recipe_id: 'r1', recipe_nom: 'A', qte_contribuee: 200 }],
  }
  const b = {
    produit: 'Farine de blé', ingredient_id: IDS.farine, qte: 350, unite: 'g',
    quantity_mode: 'quantity' as const, needs_review: false,
    contributions: [{ recipe_id: 'r2', recipe_nom: 'B', qte_contribuee: 350 }],
  }
  const result = aggregateRequirements([[a], [b]])
  assert.equal(result.length, 1)
  assert.equal(result[0].qte, 550)
  assert.equal(result[0].contributions.length, 2)
})
