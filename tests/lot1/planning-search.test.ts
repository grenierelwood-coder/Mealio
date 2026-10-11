import test from 'node:test'
import assert from 'node:assert/strict'
import { filterPlanningRecipes, matchesPlanningRecipe, matchesPlanningRole } from '../../app/utils/planning-recipe-search'
import { GET } from '../../app/api/recipes/route'
// @ts-expect-error local doubles
import { calls, setDbResolver } from '../../test-support/db.mjs'

const recipe = { id: 'r1', nom: 'Gratin de légumes', title: 'Gratin de légumes', ingredients: [{ name: 'Courgettes', qty: 2 }], tags: ['Accompagnement'], difficulty: 'Facile' }
test('planning : retrouve le titre sans accent ni distinction de casse', () => {
  assert.equal(matchesPlanningRecipe(recipe, 'LEGUMES'), true)
  assert.equal(matchesPlanningRecipe({ title: 'Crème brûlée' }, 'creme brulee'), true)
})
test('planning : retrouve un ingrédient absent du titre', () => assert.equal(matchesPlanningRecipe(recipe, 'courgette'), true))
test('planning : tous les mots sont requis, même répartis entre titre et ingrédients', () => {
  assert.equal(matchesPlanningRecipe(recipe, 'courgette, gratin'), true)
  assert.equal(matchesPlanningRecipe(recipe, 'gratin saumon'), false)
})
test('planning : exclusion d’ingrédient et champ titre de secours', () => {
  assert.equal(matchesPlanningRecipe(recipe, 'gratin -courgette'), false)
  assert.equal(matchesPlanningRecipe({ nom: 'Quiche aux poireaux' }, 'poireau'), true)
})
test('planning : descriptions et tags ne produisent pas de faux ingrédients', () => {
  assert.equal(matchesPlanningRecipe({ title: 'Poulet rôti', ...{ description: 'Servir avec des courgettes' }, tags: ['courgette'] }, 'courgette'), false)
})
test('planning : recherche aussi les composants et alternatives sans modifier les quantités', () => {
  const structured = { ingredients: [{ name: 'Mélange', components: [{ name: 'Noix' }] }, { alternatives: [{ name: 'Amandes' }] }] }
  const before = JSON.stringify(structured)
  assert.equal(matchesPlanningRecipe(structured, 'noix amande'), true)
  assert.equal(JSON.stringify(structured), before)
})
test('planning : Plat choisi ne masque pas les accompagnements par défaut', () => {
  assert.deepEqual(filterPlanningRecipes([recipe], 'gratin', 'Toutes', 'plat'), [recipe])
  assert.deepEqual(filterPlanningRecipes([recipe], 'gratin', 'Toutes', 'plat', true), [])
  assert.deepEqual(filterPlanningRecipes([recipe], 'gratin', 'Toutes', 'accompagnement', true), [recipe])
})
test('planning : tags multiples et filtre explicite de difficulté', () => {
  assert.equal(matchesPlanningRole({ tags: ['Entrée', 'Plat'] }, 'plat'), true)
  assert.equal(matchesPlanningRole({ tags: [] }, 'plat'), true)
  assert.equal(matchesPlanningRole({ tags: ['dessert'] }, 'autre'), true)
  assert.equal(filterPlanningRecipes([recipe], '', 'Difficile', 'plat').length, 0)
})
test('catalogue : charge la recette au-delà de la limite de 1000 lignes', async () => {
  const rows = Array.from({ length: 1001 }, (_, n) => ({ id: `r${n}`, title: n === 1000 ? 'Tarte aux courgettes' : `Recette ${n}`, ingredients: [], tags: [] }))
  setDbResolver((call: { range: number[] }) => ({ data: rows.slice(call.range[0], call.range[1] + 1), error: null }))
  const response = await GET()
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.total, 1001)
  assert.equal(filterPlanningRecipes(body.recipes, 'courgette', 'Toutes', 'plat').length, 1)
  assert.deepEqual(calls.map((call: { range: number[] }) => call.range), [[0, 499], [500, 999], [1000, 1499]])
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})
test('catalogue : termine une page vide et conserve les valeurs nullable', async () => {
  setDbResolver(() => ({ data: [{ id: 'r', title: 'Soupe', ingredients: null, tags: null }], error: null }))
  const body = await (await GET()).json()
  assert.deepEqual(body.recipes[0].ingredients, [])
  assert.deepEqual(body.recipes[0].tags, [])
  setDbResolver(() => ({ data: [], error: null }))
  assert.equal((await (await GET()).json()).total, 0)
  assert.equal(calls.length, 1)
})
test('catalogue : une erreur de page ne présente pas une liste partielle comme complète', async () => {
  setDbResolver((call: { range: number[] }) => call.range[0] === 0
    ? { data: Array.from({ length: 500 }, (_, n) => ({ id: `r${n}`, title: 'r' })), error: null }
    : { data: null, error: { message: 'Lecture interrompue' } })
  const response = await GET()
  assert.equal(response.status, 500)
  const body = await response.json()
  assert.match(body.error, /Lecture interrompue/)
  assert.equal(body.recipes, undefined)
})
