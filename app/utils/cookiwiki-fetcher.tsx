import { cookiwikiServerDb } from '../lib/supabase-server'

export interface RawRecipeIngredient {
  name: string
  qty: number
  unit: string
  inferredFromInstructions?: boolean
}

export interface RecipeDetails {
  id: string
  nom: string
  baseServings: number
  ingredients: RawRecipeIngredient[]
}

function parseIngredients(raw: unknown): RawRecipeIngredient[] {
  const arr = Array.isArray(raw) ? raw : []

  return arr
    .map((ing: any) => ({
      name: ing?.name || ing?.nom || ing?.ingredient || '',
      qty: Number(
        ing?.qty ??
          ing?.quantite ??
          ing?.quantity ??
          ing?.amount ??
          0,
      ) || 0,
      unit: ing?.unit || ing?.unite || 'pièce',
    }))
    .filter((ing) => ing.name.trim().length > 0)
}

/**
 * Certaines recettes historiques de Cookiwiki ont un tableau `ingredients`
 * vide, alors que les ingrédients figurent encore sous forme de puces dans
 * les instructions. On les récupère afin de ne pas générer une liste vide.
 *
 * Les quantités n'étant pas présentes dans ce cas, 1 Pièce est utilisé comme
 * quantité technique et l'article est considéré comme à revoir.
 */
function parseIngredientsFromInstructions(
  instructions: unknown,
): RawRecipeIngredient[] {
  const text = String(instructions ?? '')
  if (!text.trim()) return []

  const marker = /pour\s+r[ée]aliser\s+cette\s+recette[\s\S]{0,120}?(?:tu\s+auras\s+besoin\s+de|vous\s+aurez\s+besoin\s+de)\s*:/i
  const match = text.match(marker)
  if (!match || match.index == null) return []

  const lines = text.slice(match.index + match[0].length).split(/\r?\n/)
  const ingredients: RawRecipeIngredient[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^(?:code promo|totoninja|cuisson\b|bon app[ée]tit\b)/i.test(line)) {
      break
    }

    if (!/^[•●▪◦*-]/.test(line)) continue

    let name = line.replace(/^[•●▪◦*-]+\s*/, '').trim()
    name = name.replace(/\s+\d{1,3}\s*$/, '').trim()

    // Corrections ciblées de quelques artefacts OCR connus de Cookiwiki.
    // On reste volontairement conservateur : on ne réécrit pas arbitrairement
    // les noms d'ingrédients avant passage dans le Matcher.
    name = name.replace(/\bbacon\s+ge\s*$/i, 'Bacon').trim()

    if (!name) continue

    ingredients.push({
      name,
      qty: 1,
      unit: 'pièce',
      inferredFromInstructions: true,
    })
  }

  return ingredients
}

export async function getRecipeIngredientsFromCookiwiki(
  recipeId: string,
): Promise<RawRecipeIngredient[]> {
  const details = await getRecipeDetailsFromCookiwiki(recipeId)
  return details.ingredients
}

export async function getRecipeDetailsFromCookiwiki(
  recipeId: string,
): Promise<RecipeDetails> {
  const normalizedRecipeId = String(recipeId ?? '').trim()

  if (!normalizedRecipeId) {
    throw new Error('Identifiant de recette Cookiwiki manquant.')
  }

  console.log(
    `\n🔍 Interrogation de Cookiwiki (table 'recipes') pour l'ID : ${normalizedRecipeId}...`,
  )

  const { data, error } = await cookiwikiServerDb
    .from('recipes')
    .select('id, title, servings, ingredients, instructions')
    .eq('id', normalizedRecipeId)
    .maybeSingle()

  if (error) {
    console.error('❌ Erreur Cookiwiki :', error.message)
    throw new Error(`Impossible de récupérer la recette Cookiwiki : ${error.message}`)
  }

  if (!data) {
    throw new Error(`Recette introuvable dans Cookiwiki (id : ${normalizedRecipeId}).`)
  }

  let ingredients = parseIngredients(data.ingredients)

  if (ingredients.length === 0) {
    const inferred = parseIngredientsFromInstructions(data.instructions)

    if (inferred.length > 0) {
      ingredients = inferred
      console.warn(
        `⚠️ Cookiwiki : recette "${data.title ?? 'sans nom'}" sans ingrédients structurés. ${inferred.length} ingrédient(s) récupéré(s) depuis les instructions ; quantités à préciser.`,
      )
    }
  }

  const baseServings = Number(data.servings) || 4

  const recipe: RecipeDetails = {
    id: String(data.id),
    nom: data.title || 'Recette sans nom',
    baseServings,
    ingredients,
  }

  console.log(
    `✅ Recette Cookiwiki récupérée : "${recipe.nom}" — ${ingredients.length} ingrédient(s) — ${baseServings} portion(s) de base.`,
  )

  return recipe
}
