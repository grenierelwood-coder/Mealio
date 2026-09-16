/**
 * Mealio — Matcher Lab V33.1
 *
 * Lance une batterie autonome de tests métier et produit un rapport TXT.
 * Aucun .env.local n'est requis pour les tests purs : des valeurs Supabase
 * de test sont injectées uniquement pour permettre le chargement du module.
 *
 * Le contrôle DB réel est lancé séparément uniquement si les variables
 * Mealio Supabase sont disponibles dans l'environnement.
 */
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

// IMPORTANT : ces valeurs sont uniquement destinées au chargement du module.
// Les tests purs n'effectuent aucun appel réseau Supabase.
process.env.NEXT_PUBLIC_MEALIO_URL ||= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_FROSTI_URL ||= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_CELLIO_URL ||= 'https://example.supabase.co'
process.env.NEXT_PUBLIC_COOKIWIKI_URL ||= 'https://example.supabase.co'
process.env.MEALIO_SERVICE_ROLE_KEY ||= 'matcher-test-key'
process.env.FROSTI_SERVICE_ROLE_KEY ||= 'matcher-test-key'
process.env.CELLIO_SERVICE_ROLE_KEY ||= 'matcher-test-key'
process.env.COOKIWIKI_SERVICE_ROLE_KEY ||= 'matcher-test-key'

async function main() {

const {
  aggregateRequirements,
  analyzeRecipe,
  compareToStock,
  convertStockQuantity,
  createMatcherTrace,
  resolveIngredientDeterministic,
  resolveRecipeIngredients,
} = await import('../app/utils/matcher')

const { assertDensityAllowed, getQuantityMode, isDensityAllowed } =
  await import('../app/utils/quantity-policy')

const { IDS, ingredient, makeReferenceData, stock, stockItem } =
  await import('./matcher-test-fixtures')

const ref = makeReferenceData()
const STOP_WORDS = new Set([
  'de', 'du', 'des', 'la', 'le', 'les', 'et', 'à', 'a', 'au', 'aux',
  'en', 'pour', 'avec', 'sans', 'frais', 'fraiche', 'fraîche',
])

function requirement(
  ingredientId: string,
  produit: string,
  qte: number,
  unite: string,
  mode: 'quantity' | 'presence' = 'quantity',
) {
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

const tests: Array<{ name: string; run: () => Promise<void> | void; critical?: boolean }> = []
function test(name: string, run: () => Promise<void> | void, critical = false) {
  tests.push({ name, run, critical })
}

test('Résolution exacte / synonyme / inconnu', () => {
  assert.equal(resolveIngredientDeterministic('Farine de blé', ref).id, IDS.farine)
  assert.equal(resolveIngredientDeterministic('zucchini', ref).id, IDS.courgette)
  assert.equal(resolveIngredientDeterministic('Ananas', ref).id, null)
}, true)

test('Normalisation ligne recette', async () => {
  const r = await resolveRecipeIngredients(
    [ingredient('belles courgettes', 2, 'pièces')], ref, 'r1', 'Test',
  )
  assert.equal(r[0].ingredient_id, IDS.courgette)
  assert.equal(r[0].qte, 2)
  assert.equal(r[0].quantity_mode, 'quantity')
}, true)

test('Redimensionnement portions', async () => {
  const r = await resolveRecipeIngredients(
    [ingredient('Farine de blé', 200, 'g')], ref, 'r1', 'Test', 2,
  )
  assert.equal(r[0].qte, 400)
}, true)

test('Miel : densités explicites uniquement', async () => {
  const r = await resolveRecipeIngredients(
    [ingredient('Miel', 2, 'cs')], ref, 'r1', 'Test',
  )
  assert.equal(r[0].qte, 42)
  assert.equal(r[0].unite, 'g')
  assert.equal(convertStockQuantity(ref, IDS.miel, 42, 'g', 'l'), null)
}, true)

test('Presence-only : aucune densité utilisable', async () => {
  const sel = { nom: 'Sel fin', categorie: 'Épicerie salée & Condiments' }
  assert.equal(getQuantityMode(sel), 'presence')
  assert.equal(isDensityAllowed(sel), false)
  assert.throws(() => assertDensityAllowed(sel))

  const legacy = makeReferenceData()
  legacy.densities.push({ ingredient_id: IDS.sel, unite: 'g', poids_g_approx: 6 })
  const converted = convertStockQuantity(legacy, IDS.sel, 2, 'g', 'g')
  assert.equal(converted?.qty, 2)

  const r = await resolveRecipeIngredients(
    [ingredient('Sel fin', 3, 'cc')], legacy, 'r1', 'Test',
  )
  assert.equal(r[0].quantity_mode, 'presence')
  assert.equal(r[0].qte, 1)
}, true)

test('Plusieurs lignes de stock sont additionnées', async () => {
  const r = await compareToStock(
    [requirement(IDS.farine, 'Farine de blé', 500, 'g')],
    stock(
      stockItem('s1', 'Farine de blé', 100, 'g', IDS.farine),
      stockItem('s2', 'Farine de blé', 150, 'g', IDS.farine),
      stockItem('s3', 'Farine de blé', 200, 'g', IDS.farine),
    ), ref, createMatcherTrace('Farine de blé'),
    { stopWords: STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(r[0].qte_stock, 450)
  assert.equal(r[0].qte_a_acheter, 50)
}, true)

test('Stock supérieur : aucun achat', async () => {
  const r = await compareToStock(
    [requirement(IDS.farine, 'Farine de blé', 300, 'g')],
    stock(stockItem('s1', 'Farine de blé', 450, 'g', IDS.farine)),
    ref, undefined,
    { stopWords: STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(r[0].qte_a_acheter, 0)
}, true)

test('Stock insuffisant : achat = manque', async () => {
  const r = await compareToStock(
    [requirement(IDS.farine, 'Farine de blé', 500, 'g')],
    stock(stockItem('s1', 'Farine de blé', 120, 'g', IDS.farine)),
    ref, undefined,
    { stopWords: STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(r[0].qte_a_acheter, 380)
}, true)

test('Anti-faux-positif : courgette ≠ poireau', async () => {
  const r = await compareToStock(
    [requirement(IDS.courgette, 'Courgette', 2, 'piece')],
    stock(stockItem('s1', 'Poireau', 10, 'piece', IDS.poireau)),
    ref, undefined,
    { stopWords: STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(r[0].qte_stock, 0)
  assert.equal(r[0].qte_a_acheter, 2)
}, true)

test('Anti-faux-positif CRITIQUE : farine de blé ≠ farine de riz', async () => {
  const r = await compareToStock(
    [requirement(IDS.farine, 'Farine de blé', 500, 'g')],
    stock(stockItem('s1', 'Farine de riz', 1000, 'g', IDS.farineRiz)),
    ref, undefined,
    { stopWords: STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(r[0].qte_stock, 0)
  assert.equal(r[0].qte_a_acheter, 500)
}, true)

test('Presence : stock présent = aucun achat', async () => {
  const r = await compareToStock(
    [requirement(IDS.sel, 'Sel fin', 1, 'Pièce', 'presence')],
    stock(stockItem('s1', 'Sel fin', 1, 'boîte', IDS.sel)),
    ref, undefined,
    { stopWords: STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(r[0].qte_a_acheter, 0)
}, true)

test('Presence : stock absent = achat présence', async () => {
  const r = await compareToStock(
    [requirement(IDS.sel, 'Sel fin', 1, 'Pièce', 'presence')], stock(), ref, undefined,
    { stopWords: STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  assert.equal(r[0].qte_a_acheter, 1)
}, true)

test('Pipeline complet recette → besoin → stock → achat', async () => {
  const r = await analyzeRecipe(
    {
      id: 'recipe-1', nom: 'Crêpes test', baseServings: 4, servings: 4,
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
    ), ref, undefined,
    { stopWords: STOP_WORDS, memory: new Map(), exclusions: new Set(), persistMemory: false },
  )
  const flour = r.compared.find(x => x.ingredient_id === IDS.farine)
  const honey = r.compared.find(x => x.ingredient_id === IDS.miel)
  const salt = r.compared.find(x => x.ingredient_id === IDS.sel)
  assert.equal(flour?.qte_a_acheter, 200)
  assert.equal(honey?.qte_a_acheter, 22)
  assert.equal(salt?.qte_a_acheter, 0)
}, true)

test('Agrégation de deux recettes', () => {
  const a = { produit: 'Farine de blé', ingredient_id: IDS.farine, qte: 200, unite: 'g', quantity_mode: 'quantity' as const, needs_review: false, contributions: [{ recipe_id: 'r1', recipe_nom: 'A', qte_contribuee: 200 }] }
  const b = { produit: 'Farine de blé', ingredient_id: IDS.farine, qte: 350, unite: 'g', quantity_mode: 'quantity' as const, needs_review: false, contributions: [{ recipe_id: 'r2', recipe_nom: 'B', qte_contribuee: 350 }] }
  const r = aggregateRequirements([[a], [b]])
  assert.equal(r.length, 1)
  assert.equal(r[0].qte, 550)
  assert.equal(r[0].contributions.length, 2)
}, true)

function timestamp() {
  const d = new Date()
  return d.toISOString().replace(/[:.]/g, '-')
}

const reportDir = path.resolve(process.cwd(), 'test-reports')
fs.mkdirSync(reportDir, { recursive: true })
const reportPath = path.join(reportDir, `matcher-lab-${timestamp()}.txt`)
const lines: string[] = []
const log = (line = '') => { lines.push(line); console.log(line) }

log('MEALIO — MATCHER TEST LAB')
log('V33.1 — exécution clé en main')
log(`Date : ${new Date().toLocaleString('fr-FR')}`)
log('')
log('Les tests sont exécutés avec des données de référence locales.')
log('Aucune écriture Supabase ni appel Claude n’est nécessaire pour cette batterie.')
log('')

let passed = 0
let failed = 0
let criticalFailed = 0

for (const t of tests) {
  const start = Date.now()
  try {
    await t.run()
    passed++
    log(`PASS | ${Date.now() - start} ms | ${t.name}`)
  } catch (error) {
    failed++
    if (t.critical) criticalFailed++
    log(`FAIL${t.critical ? ' [CRITIQUE]' : ''} | ${Date.now() - start} ms | ${t.name}`)
    log(`      ${error instanceof Error ? error.stack || error.message : String(error)}`)
  }
}

log('')
log('==============================')
log('RÉSULTAT')
log('==============================')
log(`Tests exécutés : ${tests.length}`)
log(`PASS : ${passed}`)
log(`FAIL : ${failed}`)
log(`Échecs critiques : ${criticalFailed}`)
log('')
if (failed === 0) {
  log('STATUT : PASS — batterie Matcher verte.')
} else if (criticalFailed > 0) {
  log('STATUT : BLOQUÉ — au moins un test critique échoue.')
} else {
  log('STATUT : ATTENTION — des tests non critiques échouent.')
}

fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8')
console.log(`\nRapport TXT : ${reportPath}`)
process.exitCode = failed === 0 ? 0 : 1
}

main().catch((error) => {
  console.error('\nERREUR FATALE DU TEST LAB :')
  console.error(error instanceof Error ? (error.stack || error.message) : String(error))
  process.exitCode = 2
})
