export type PlanningRecipe = {
  nom?: string | null
  title?: string | null
  ingredients?: unknown[] | null
  tags?: string[] | null
  difficulty?: string | null
}

export function normalizeRecipeSearch(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function ingredientLabels(lines: unknown[], depth = 0): string[] {
  if (depth > 6) return []
  return lines.flatMap(line => {
    if (typeof line === 'string') return [normalizeRecipeSearch(line)]
    if (!line || typeof line !== 'object') return []
    const item = line as { name?: unknown; components?: unknown; alternatives?: unknown }
    return [
      ...(typeof item.name === 'string' ? [normalizeRecipeSearch(item.name)] : []),
      ...(Array.isArray(item.components) ? ingredientLabels(item.components, depth + 1) : []),
      ...(Array.isArray(item.alternatives) ? ingredientLabels(item.alternatives, depth + 1) : []),
    ]
  })
}

/** Same text rules as Cookiwiki: all terms in title/ingredients, ingredient exclusions. */
export function matchesPlanningRecipe(recipe: PlanningRecipe, search: string): boolean {
  const terms = normalizeRecipeSearch(search).split(/[\s,]+/).filter(Boolean)
  const includes = terms.filter(term => !term.startsWith('-'))
  const excludes = terms.filter(term => term.startsWith('-') && term.length > 1).map(term => term.slice(1))
  const ingredients = ingredientLabels(Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
  if (excludes.some(term => ingredients.some(label => label.includes(term)))) return false
  const haystack = [normalizeRecipeSearch(recipe.title || recipe.nom || ''), ...ingredients]
  return includes.every(term => haystack.some(label => label.includes(term)))
}

export function matchesPlanningRole(recipe: PlanningRecipe, role: string): boolean {
  if (role === 'autre') return true
  const aliases: Record<string, string[]> = {
    entree: ['entree', 'entrees'], dessert: ['dessert', 'desserts'],
    accompagnement: ['accompagnement', 'accompagnements'], plat: ['plat', 'plats'],
  }
  const tags = (recipe.tags || []).map(tag => normalizeRecipeSearch(tag).trim())
  const classified = Object.keys(aliases).filter(type => aliases[type].some(tag => tags.includes(tag)))
  return classified.length ? classified.includes(role) : role === 'plat'
}

export function filterPlanningRecipes<T extends PlanningRecipe>(recipes: T[], search: string, difficulty: string, role: string, limitToRole = false): T[] {
  return recipes.filter(recipe => matchesPlanningRecipe(recipe, search)
    && (difficulty === 'Toutes' || recipe.difficulty === difficulty)
    && (!limitToRole || matchesPlanningRole(recipe, role)))
}
