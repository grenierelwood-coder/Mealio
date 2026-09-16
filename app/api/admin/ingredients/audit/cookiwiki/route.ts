import { NextResponse } from 'next/server'
import { cookiwikiServerDb } from '../../../../../lib/supabase-server'
import { getAuthSession } from '../../../../../utils/auth-server'
import { cleanText, loadReferenceData, resolveIngredientDeterministic } from '../../../../../utils/matcher'
import { isPresenceOnlyIngredient } from '../../../../../utils/quantity-policy'

export const dynamic = 'force-dynamic'
const PAGE_SIZE = 1000

type CookiwikiIngredient = { name?: string | null; qty?: number | string | null; unit?: string | null; [key: string]: unknown }
type Recipe = { id: string; title: string; ingredients: CookiwikiIngredient[] | null }
type AuditExample = { recipeId: string; recipeTitle: string; ingredient: string; quantity: number | string | null; unit: string | null }
type Problem = { raw: string; normalized: string; count: number; recipes: Array<{ id: string; title: string }>; candidateScore: number | null; examples: AuditExample[]; ingredients: string[] }

const normalizeUnitKey = (value: unknown) => String(value ?? '').trim().toLowerCase()

async function loadAllRecipes(): Promise<Recipe[]> {
  const all: Recipe[] = []
  let from = 0
  while (true) {
    const { data, error } = await cookiwikiServerDb.from('recipes').select('id,title,ingredients').order('title', { ascending: true }).range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Cookiwiki : ${error.message}`)
    const rows = (data ?? []) as Recipe[]
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

export async function GET() {
  try {
    const session = await getAuthSession()
    if (!session) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

    const [recipes, refData] = await Promise.all([loadAllRecipes(), loadReferenceData()])
    const unitMap = new Map(refData.unitMappings.map(u => [normalizeUnitKey(u.unite), u.unite]))
    const aliasMap = new Map<string, string>()
    for (const unit of refData.unitMappings) if (unit.abreviation) aliasMap.set(normalizeUnitKey(unit.abreviation), unit.unite)

    let recipeCount = 0, ingredientLineCount = 0, recognizedCount = 0, ignoredCount = 0, unresolvedCount = 0, unitKnownCount = 0, unitUnknownCount = 0
    const problems = new Map<string, Problem>(), unitProblems = new Map<string, Problem>()

    for (const recipe of recipes) {
      recipeCount += 1
      for (const ingredient of recipe.ingredients ?? []) {
        const raw = String(ingredient.name ?? '').trim()
        if (!raw) continue
        ingredientLineCount += 1
        const result = resolveIngredientDeterministic(raw, refData)
        if (result.source === 'ignored') ignoredCount += 1
        else if (result.id) recognizedCount += 1
        else {
          unresolvedCount += 1
          const key = cleanText(raw) || raw.toLowerCase()
          const example: AuditExample = { recipeId: recipe.id, recipeTitle: recipe.title, ingredient: raw, quantity: ingredient.qty ?? null, unit: ingredient.unit ?? null }
          const current = problems.get(key)
          if (current) {
            current.count += 1
            if (!current.recipes.some(r => r.id === recipe.id)) current.recipes.push({ id: recipe.id, title: recipe.title })
            if (!current.ingredients.includes(raw)) current.ingredients.push(raw)
            if (current.examples.length < 12) current.examples.push(example)
          } else problems.set(key, { raw, normalized: key, count: 1, recipes: [{ id: recipe.id, title: recipe.title }], candidateScore: result.score, examples: [example], ingredients: [raw] })
        }

        const resolvedOfficial = result.id ? refData.officialById.get(result.id) ?? null : null
        // Pour une épice/assaisonnement, l'unité de recette reste informative
        // mais ne participe plus au calcul Mealio. Elle ne doit donc pas polluer
        // l'audit des unités inconnues.
        if (resolvedOfficial && isPresenceOnlyIngredient(resolvedOfficial)) continue

        const rawUnit = String(ingredient.unit ?? '').trim()
        if (!rawUnit) continue
        const canonical = aliasMap.get(normalizeUnitKey(rawUnit)) ?? rawUnit
        if (unitMap.has(normalizeUnitKey(canonical))) unitKnownCount += 1
        else {
          unitUnknownCount += 1
          const key = normalizeUnitKey(rawUnit)
          const example: AuditExample = { recipeId: recipe.id, recipeTitle: recipe.title, ingredient: raw, quantity: ingredient.qty ?? null, unit: rawUnit }
          const current = unitProblems.get(key)
          if (current) {
            current.count += 1
            if (!current.recipes.some(r => r.id === recipe.id)) current.recipes.push({ id: recipe.id, title: recipe.title })
            if (!current.ingredients.includes(raw)) current.ingredients.push(raw)
            if (current.examples.length < 12) current.examples.push(example)
          } else unitProblems.set(key, { raw: rawUnit, normalized: key, count: 1, recipes: [{ id: recipe.id, title: recipe.title }], candidateScore: null, examples: [example], ingredients: [raw] })
        }
      }
    }

    const denominator = Math.max(1, ingredientLineCount - ignoredCount)
    const unitDenominator = Math.max(1, unitKnownCount + unitUnknownCount)
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      mode: 'deterministic',
      note: 'Audit sans appel IA : normalisation, synonymes, correspondance exacte et moteur lexical déterministe uniquement.',
      summary: {
        recipes: recipeCount, ingredientLines: ingredientLineCount, recognized: recognizedCount, ignored: ignoredCount, unresolved: unresolvedCount,
        ingredientCoverage: Number(((recognizedCount / denominator) * 100).toFixed(2)), unitKnown: unitKnownCount, unitUnknown: unitUnknownCount,
        unitCoverage: Number(((unitKnownCount / unitDenominator) * 100).toFixed(2)), distinctUnresolvedIngredients: problems.size, distinctUnknownUnits: unitProblems.size,
      },
      unresolved: Array.from(problems.values()).sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw, 'fr')),
      unknownUnits: Array.from(unitProblems.values()).sort((a, b) => b.count - a.count || a.raw.localeCompare(b.raw, 'fr')),
    })
  } catch (error) {
    console.error('❌ Audit Cookiwiki:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}
