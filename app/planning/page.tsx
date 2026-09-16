'use client'

import { useEffect, useMemo, useState } from 'react'

type Recipe = {
  id: string
  nom: string
  title?: string
  servings: number
  image_url?: string | null
  description?: string | null
  prep_time?: number
  cook_time?: number
  difficulty?: string | null
  tags?: string[]
  ingredients?: unknown[]
}

type MealType = 'midi' | 'soir'
type MealRole =
  | 'entree'
  | 'plat'
  | 'accompagnement'
  | 'dessert'
  | 'autre'

type MealPlan = {
  id: string
  user_id: string
  recipe_id: string
  scheduled_date: string
  meal_type: MealType
  role: MealRole
  servings: number
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getInitialDate(): string {
  return formatDate(new Date())
}

function addDays(dateString: string, amount: number): string {
  const date = new Date(`${dateString}T12:00:00`)
  date.setDate(date.getDate() + amount)
  return formatDate(date)
}

function formatFrenchDate(dateString: string): string {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString(
    'fr-FR',
    {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }
  )
}

function formatWeekRange(days: string[]): string {
  if (!days.length) return ''

  const start = new Date(`${days[0]}T12:00:00`)
  const end = new Date(
    `${days[days.length - 1]}T12:00:00`
  )

  const startText = start.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  })

  const endText = end.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  })

  return `${startText} → ${endText}`
}

function getDayLabel(dateString: string): string {
  const day = new Date(`${dateString}T12:00:00`).getDay()

  return ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'][day]
}

function getDayNumber(dateString: string): string {
  return new Date(`${dateString}T12:00:00`).toLocaleDateString(
    'fr-FR',
    {
      day: 'numeric',
    }
  )
}

function getRoleLabel(role: MealRole): string {
  switch (role) {
    case 'entree':
      return 'Entrée'
    case 'plat':
      return 'Plat'
    case 'accompagnement':
      return 'Accompagnement'
    case 'dessert':
      return 'Dessert'
    default:
      return 'Autre'
  }
}

function getRecipeType(recipe: Recipe): string {
  const tags = (recipe.tags ?? []).map(tag =>
    tag.toLowerCase().trim()
  )

  if (
    tags.some(tag =>
      ['entrée', 'entree', 'entrées', 'entrees'].includes(tag)
    )
  ) {
    return 'Entrée'
  }

  if (
    tags.some(tag =>
      ['dessert', 'desserts'].includes(tag)
    )
  ) {
    return 'Dessert'
  }

  if (
    tags.some(tag =>
      [
        'accompagnement',
        'accompagnements',
      ].includes(tag)
    )
  ) {
    return 'Accompagnement'
  }

  return 'Plat'
}

function roleToRecipeType(
  role: MealRole
): string | null {
  if (role === 'entree') return 'Entrée'
  if (role === 'dessert') return 'Dessert'
  if (role === 'accompagnement') {
    return 'Accompagnement'
  }
  if (role === 'plat') return 'Plat'

  return null
}

function MealSlot({
  title,
  icon,
  plans,
  getRecipeName,
  onAdd,
  onDelete,
  onChangeServings,
  disabled,
}: {
  title: string
  icon: string
  plans: MealPlan[]
  getRecipeName: (recipeId: string) => string
  onAdd: () => void
  onDelete: (id: string) => void
  onChangeServings: (
    plan: MealPlan,
    delta: number
  ) => void
  disabled?: boolean
}) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{icon}</span>

          <span className="font-black text-slate-900">
            {title}
          </span>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="min-h-11 rounded-2xl bg-emerald-600 px-4 text-sm font-black text-white shadow-sm active:scale-[0.98] disabled:opacity-50"
        >
          + Ajouter
        </button>
      </div>

      {plans.length === 0 ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="min-h-24 w-full px-5 py-5 text-left active:bg-emerald-50 disabled:opacity-50"
        >
          <div className="text-sm font-bold text-slate-500">
            Aucun repas prévu
          </div>

          <div className="mt-1 text-sm font-semibold text-emerald-600">
            Appuyer ici pour ajouter
          </div>
        </button>
      ) : (
        <div className="space-y-2 p-3">
          {plans.map(plan => (
            <div
              key={plan.id}
              className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4"
            >
              <div className="font-black text-slate-900">
                {getRecipeName(plan.recipe_id)}
              </div>

              <div className="mt-3 flex items-center justify-between gap-3">
                <div className="flex items-center rounded-xl bg-white shadow-sm">
                  <button
                    type="button"
                    aria-label="Réduire le nombre de portions"
                    onClick={() =>
                      onChangeServings(plan, -1)
                    }
                    disabled={
                      disabled || plan.servings <= 1
                    }
                    className="flex h-11 w-11 items-center justify-center rounded-l-xl text-2xl font-black text-slate-700 active:bg-slate-100 disabled:opacity-30"
                  >
                    −
                  </button>

                  <div className="flex h-11 min-w-12 items-center justify-center border-x border-slate-100 px-2 text-lg font-black text-slate-900">
                    {plan.servings}
                  </div>

                  <button
                    type="button"
                    aria-label="Augmenter le nombre de portions"
                    onClick={() =>
                      onChangeServings(plan, 1)
                    }
                    disabled={disabled}
                    className="flex h-11 w-11 items-center justify-center rounded-r-xl text-2xl font-black text-slate-700 active:bg-slate-100 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>

                <div className="text-right text-xs font-semibold text-slate-500">
                  <div>
                    {plan.servings > 1
                      ? 'portions'
                      : 'portion'}
                  </div>

                  <div>
                    {getRoleLabel(plan.role)}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  onDelete(plan.id)
                }
                disabled={disabled}
                className="mt-3 min-h-10 w-full rounded-xl bg-white text-sm font-black text-red-600 shadow-sm active:bg-red-50 disabled:opacity-40"
              >
                Supprimer
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default function PlanningPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [plans, setPlans] = useState<MealPlan[]>([])

  const [loadingRecipes, setLoadingRecipes] =
    useState(true)

  const [loadingPlans, setLoadingPlans] =
    useState(true)

  const [saving, setSaving] = useState(false)

  const [error, setError] =
    useState<string | null>(null)

  const [message, setMessage] =
    useState<string | null>(null)

  const [weekStartDate, setWeekStartDate] =
    useState(getInitialDate())

  const [selectedDay, setSelectedDay] =
    useState(getInitialDate())

  /*
   * Écran actuellement affiché sur smartphone.
   *
   * planning = calendrier + repas
   * recipes  = choix d'une recette
   */
  const [screen, setScreen] = useState<
    'planning' | 'recipes'
  >('planning')

  const [addTarget, setAddTarget] = useState<{
    date: string
    mealType: MealType
  } | null>(null)

  const [editingPlan, setEditingPlan] =
    useState<MealPlan | null>(null)

  const [selectedRecipeId, setSelectedRecipeId] =
    useState<string | null>(null)

  const [search, setSearch] = useState('')

  const [difficultyFilter, setDifficultyFilter] =
    useState('Toutes')

  /*
   * Plat reste le choix implicite.
   */
  const [role, setRole] =
    useState<MealRole>('plat')

  const [servings, setServings] = useState(4)

  const days = useMemo(
    () =>
      Array.from(
        { length: 7 },
        (_, index) =>
          addDays(
            weekStartDate,
            index
          )
      ),
    [weekStartDate]
  )

  const selectedRecipe = useMemo(
    () =>
      recipes.find(
        recipe =>
          recipe.id ===
          selectedRecipeId
      ) ?? null,
    [recipes, selectedRecipeId]
  )

  const filteredRecipes = useMemo(() => {
    const q = search.trim().toLowerCase()
    const wantedType =
      roleToRecipeType(role)

    return recipes.filter(recipe => {
      const text = `
        ${recipe.nom}
        ${recipe.description ?? ''}
        ${(recipe.tags ?? []).join(' ')}
      `.toLowerCase()

      return (
        (!q || text.includes(q)) &&
        (!wantedType ||
          getRecipeType(recipe) ===
            wantedType) &&
        (
          difficultyFilter ===
            'Toutes' ||
          recipe.difficulty ===
            difficultyFilter
        )
      )
    })
  }, [
    recipes,
    search,
    difficultyFilter,
    role,
  ])

  async function loadRecipes() {
    try {
      setLoadingRecipes(true)

      const response = await fetch(
        '/api/recipes',
        {
          cache: 'no-store',
        }
      )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ??
            'Impossible de charger les recettes.'
        )
      }

      setRecipes(
        data.recipes ?? []
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger les recettes.'
      )
    } finally {
      setLoadingRecipes(false)
    }
  }

  async function loadPlans() {
    try {
      setLoadingPlans(true)

      const response = await fetch(
        '/api/meal-plans',
        {
          cache: 'no-store',
        }
      )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ??
            'Impossible de charger le planning.'
        )
      }

      setPlans(
        data.plans ?? []
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger le planning.'
      )
    } finally {
      setLoadingPlans(false)
    }
  }

  useEffect(() => {
    void loadRecipes()
    void loadPlans()
  }, [])

  function getRecipeName(
    recipeId: string
  ): string {
    return (
      recipes.find(
        recipe =>
          recipe.id === recipeId
      )?.nom ??
      'Recette inconnue'
    )
  }

  /*
   * Ouvre directement l'écran de sélection
   * pour le créneau qui vient d'être touché.
   *
   * Aucun scroll.
   * Aucun deuxième choix de créneau.
   */
  function openAdd(
    date: string,
    mealType: MealType
  ) {
    setAddTarget({
      date,
      mealType,
    })

    setEditingPlan(null)
    setSelectedRecipeId(null)

    setSearch('')
    setDifficultyFilter('Toutes')
    setRole('plat')
    setServings(4)

    setError(null)
    setMessage(null)

    setScreen('recipes')
  }

  function openEdit(
    plan: MealPlan
  ) {
    setEditingPlan(plan)

    setAddTarget({
      date: plan.scheduled_date,
      mealType: plan.meal_type,
    })

    setSelectedRecipeId(
      plan.recipe_id
    )

    setRole(plan.role)
    setServings(plan.servings)

    setSearch('')
    setDifficultyFilter('Toutes')

    setError(null)
    setMessage(null)

    setScreen('recipes')
  }

  /*
   * Retour vers le planning.
   *
   * Le jour du repas reste sélectionné.
   */
  function closeRecipeScreen() {
    if (saving) return

    if (addTarget) {
      setSelectedDay(
        addTarget.date
      )
    }

    setScreen('planning')

    setAddTarget(null)
    setEditingPlan(null)
    setSelectedRecipeId(null)

    setSearch('')
  }

  function selectRecipe(
    recipe: Recipe
  ) {
    setSelectedRecipeId(
      recipe.id
    )

    setServings(
      Number(
        recipe.servings ?? 4
      )
    )

    setMessage(null)
    setError(null)
  }

  async function saveMealPlan() {
    if (
      !addTarget ||
      !selectedRecipe
    ) {
      setError(
        'Choisis d’abord une recette.'
      )
      return
    }

    try {
      setSaving(true)
      setError(null)
      setMessage(null)

      const isEdit =
        Boolean(editingPlan)

      const response = await fetch(
        '/api/meal-plans',
        {
          method: isEdit
            ? 'PATCH'
            : 'POST',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            ...(isEdit
              ? {
                  id:
                    editingPlan!.id,
                }
              : {}),
            recipe_id:
              selectedRecipe.id,
            scheduled_date:
              addTarget.date,
            meal_type:
              addTarget.mealType,
            role,
            servings,
          }),
        }
      )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ??
            'Impossible d’enregistrer le repas.'
        )
      }

      /*
       * Recharge les données pendant que
       * l'utilisateur revient au planning.
       */
      await loadPlans()

      setSelectedDay(
        addTarget.date
      )

      setMessage(
        isEdit
          ? 'Repas modifié.'
          : 'Repas ajouté au planning.'
      )

      setAddTarget(null)
      setEditingPlan(null)
      setSelectedRecipeId(null)
      setSearch('')

      setScreen('planning')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’enregistrer le repas.'
      )
    } finally {
      setSaving(false)
    }
  }

  async function changeServings(
    plan: MealPlan,
    delta: number
  ) {
    const nextServings =
      Math.max(
        1,
        plan.servings + delta
      )

    if (
      nextServings ===
      plan.servings
    ) {
      return
    }

    try {
      setSaving(true)
      setError(null)
      setMessage(null)

      const response = await fetch(
        '/api/meal-plans',
        {
          method: 'PATCH',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            id: plan.id,
            servings:
              nextServings,
          }),
        }
      )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ??
            'Impossible de modifier le nombre de portions.'
        )
      }

      setPlans(current =>
        current.map(item =>
          item.id === plan.id
            ? {
                ...item,
                servings:
                  nextServings,
              }
            : item
        )
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de modifier le nombre de portions.'
      )
    } finally {
      setSaving(false)
    }
  }

  async function deleteMealPlan(
    planId: string
  ) {
    try {
      setSaving(true)
      setError(null)
      setMessage(null)

      const response = await fetch(
        '/api/meal-plans',
        {
          method: 'DELETE',
          headers: {
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            id: planId,
          }),
        }
      )

      const data =
        await response.json()

      if (!response.ok) {
        throw new Error(
          data?.error ??
            'Impossible de supprimer le repas.'
        )
      }

      setPlans(current =>
        current.filter(
          plan =>
            plan.id !== planId
        )
      )

      setMessage(
        'Repas supprimé du planning.'
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de supprimer le repas.'
      )
    } finally {
      setSaving(false)
    }
  }

  function plansForSlot(
    date: string,
    mealType: MealType
  ) {
    return plans.filter(
      plan =>
        plan.scheduled_date ===
          date &&
        plan.meal_type ===
          mealType
    )
  }

  function changeWeek(
    amount: number
  ) {
    const next = addDays(
      weekStartDate,
      amount
    )

    setWeekStartDate(next)
    setSelectedDay(next)
  }

  function goToday() {
    const today =
      getInitialDate()

    setWeekStartDate(today)
    setSelectedDay(today)
  }

  const selectedDayPlans =
    plans.filter(
      plan =>
        plan.scheduled_date ===
        selectedDay
    )

  const plannedDays =
    days.filter(day =>
      plans.some(
        plan =>
          plan.scheduled_date ===
          day
      )
    ).length

  const totalMealsThisWeek =
    days.reduce(
      (total, day) =>
        total +
        plans.filter(
          plan =>
            plan.scheduled_date ===
            day
        ).length,
      0
    )

  const weekCompleteness =
    Math.round(
      (plannedDays / 7) * 100
    )

  /*
   * ----------------------------------------------------
   * ÉCRAN RECETTES
   * ----------------------------------------------------
   *
   * Sur smartphone, cet écran remplace le planning.
   * Il est donc impossible de devoir descendre
   * depuis le calendrier pour chercher les recettes.
   */
  if (screen === 'recipes' && addTarget) {
    return (
      <main className="min-h-screen bg-stone-50">
        <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-3 py-3 sm:px-4">
          <header className="sticky top-0 z-30 bg-stone-50 pb-3 pt-1">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={
                  closeRecipeScreen
                }
                disabled={saving}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-2xl font-black text-slate-600 shadow-sm ring-1 ring-slate-200 active:bg-slate-100 disabled:opacity-40"
                aria-label="Retour au planning"
              >
                ←
              </button>

              <div className="min-w-0 flex-1 text-center">
                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600">
                  {editingPlan
                    ? 'Modifier le repas'
                    : 'Choisir une recette'}
                </div>

                <div className="truncate text-sm font-black text-slate-900">
                  {formatFrenchDate(
                    addTarget.date
                  )}
                </div>

                <div className="text-xs font-bold text-slate-500">
                  {addTarget.mealType ===
                  'midi'
                    ? '☀️ Midi'
                    : '🌙 Soir'}
                </div>
              </div>

              <div className="h-12 w-12 shrink-0" />
            </div>
          </header>

          {error && (
            <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              ⚠️ {error}
            </div>
          )}

          <section className="mb-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">
              Type de repas
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {([
                [
                  'plat',
                  '🍽️',
                  'Plat',
                ],
                [
                  'entree',
                  '🥗',
                  'Entrée',
                ],
                [
                  'accompagnement',
                  '🥔',
                  'Accomp.',
                ],
                [
                  'dessert',
                  '🍰',
                  'Dessert',
                ],
              ] as [
                MealRole,
                string,
                string
              ][]).map(
                ([
                  value,
                  icon,
                  label,
                ]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setRole(value)
                      setSelectedRecipeId(
                        null
                      )
                    }}
                    className={`min-h-14 rounded-2xl px-1 text-xs font-black transition-all ${
                      role === value
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-600 active:bg-slate-200'
                    }`}
                  >
                    <div className="text-lg">
                      {icon}
                    </div>

                    <div>
                      {label}
                    </div>
                  </button>
                )
              )}
            </div>
          </section>

          <section className="mb-3 rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <input
                  type="search"
                  value={search}
                  onChange={event =>
                    setSearch(
                      event.target.value
                    )
                  }
                  placeholder="Rechercher une recette…"
                  autoFocus
                  className="min-h-13 w-full rounded-2xl border border-slate-200 bg-stone-50 px-4 text-base font-semibold outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                />
              </div>
            </div>

            <select
              value={
                difficultyFilter
              }
              onChange={event =>
                setDifficultyFilter(
                  event.target.value
                )
              }
              className="mt-2 min-h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-600"
            >
              <option value="Toutes">
                Toutes les difficultés
              </option>

              <option value="Facile">
                Facile
              </option>

              <option value="Moyen">
                Moyen
              </option>

              <option value="Difficile">
                Difficile
              </option>
            </select>

            <div className="mt-2 text-xs font-bold text-slate-400">
              {loadingRecipes
                ? 'Chargement…'
                : `${filteredRecipes.length} recette${
                    filteredRecipes.length >
                    1
                      ? 's'
                      : ''
                  }`}
            </div>
          </section>

          <section className="min-h-0 flex-1 pb-44 sm:pb-40">
            {loadingRecipes ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-12 text-center text-sm font-semibold text-slate-400 shadow-sm">
                Chargement des recettes…
              </div>
            ) : filteredRecipes.length ===
              0 ? (
              <div className="rounded-3xl border border-slate-200 bg-white px-4 py-12 text-center text-sm font-semibold text-slate-400 shadow-sm">
                Aucune recette ne
                correspond.
                <br />
                Essaie une autre
                recherche.
              </div>
            ) : (
              <div className="space-y-2">
                {filteredRecipes
                  .map(recipe => {
                    const selected =
                      recipe.id ===
                      selectedRecipeId

                    return (
                      <button
                        key={recipe.id}
                        type="button"
                        onClick={() =>
                          selectRecipe(
                            recipe
                          )
                        }
                        className={`w-full rounded-2xl border p-3 text-left transition-all active:scale-[0.99] ${
                          selected
                            ? 'border-emerald-400 bg-emerald-50 shadow-sm ring-2 ring-emerald-100'
                            : 'border-slate-200 bg-white shadow-sm'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {recipe.image_url ? (
                            <img
                              src={
                                recipe.image_url
                              }
                              alt=""
                              className="h-16 w-16 shrink-0 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-2xl">
                              🍽️
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="font-black text-slate-900">
                              {recipe.nom}
                            </div>

                            <div className="mt-1 text-xs font-semibold text-slate-400">
                              {getRecipeType(
                                recipe
                              )}
                              {recipe.difficulty
                                ? ` · ${recipe.difficulty}`
                                : ''}
                              {` · ${recipe.servings} portions`}
                            </div>
                          </div>

                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                              selected
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 text-transparent'
                            }`}
                          >
                            ✓
                          </div>
                        </div>
                      </button>
                    )
                  })}
              </div>
            )}
          </section>

          /*
           * Action principale fixe :
           * elle reste toujours visible sans scroll.
           */
          <div className="fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-[120] border-t border-slate-200 bg-white/95 px-3 pb-2 pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur sm:bottom-4 sm:left-1/2 sm:right-auto sm:w-[min(42rem,calc(100vw-2rem))] sm:-translate-x-1/2 sm:rounded-3xl sm:border sm:px-3 sm:pt-3">
            <div className="mx-auto max-w-2xl">
              {selectedRecipe && (
                <div className="mb-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                        Recette sélectionnée
                      </div>

                      <div className="truncate text-sm font-black text-slate-900">
                        {selectedRecipe.nom}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center rounded-xl bg-white shadow-sm">
                      <button
                        type="button"
                        onClick={() =>
                          setServings(
                            value =>
                              Math.max(
                                1,
                                value - 1
                              )
                          )
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-l-xl text-xl font-black text-slate-700 active:bg-slate-100"
                      >
                        −
                      </button>

                      <div className="flex h-10 min-w-10 items-center justify-center border-x border-slate-100 text-sm font-black">
                        {servings}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setServings(
                            value =>
                              value + 1
                          )
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-r-xl text-xl font-black text-slate-700 active:bg-slate-100"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() =>
                  void saveMealPlan()
                }
                disabled={
                  !selectedRecipe ||
                  saving
                }
                className="min-h-14 w-full rounded-2xl bg-emerald-600 px-4 text-base font-black text-white shadow-lg disabled:bg-slate-300 disabled:shadow-none"
              >
                {saving
                  ? 'Enregistrement…'
                  : editingPlan
                    ? 'Enregistrer les modifications'
                    : selectedRecipe
                      ? '✓ Ajouter au planning'
                      : 'Choisir une recette'}
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  /*
   * ----------------------------------------------------
   * ÉCRAN PLANNING
   * ----------------------------------------------------
   */
  return (
    <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-black tracking-tight text-slate-900">
            Mon planning
          </div>

          <div className="text-xs font-semibold text-slate-500">
            Choisis un jour et un repas
          </div>
        </div>

        <button
          type="button"
          onClick={goToday}
          className="min-h-11 rounded-2xl bg-white px-4 text-sm font-black text-emerald-700 shadow-sm ring-1 ring-slate-200 active:bg-emerald-50"
        >
          Aujourd’hui
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          ⚠️ {error}
        </div>
      )}

      {message && (
        <div className="mb-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          ✅ {message}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4">
        <div className="flex items-center justify-between gap-2 px-1 pb-3">
          <button
            type="button"
            onClick={() =>
              changeWeek(-7)
            }
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-3xl font-black text-slate-600 shadow-sm active:scale-95 active:bg-slate-50"
            aria-label="Semaine précédente"
          >
            ‹
          </button>

          <div className="min-w-0 text-center">
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">
              Semaine
            </div>

            <div className="text-sm font-black text-slate-800">
              {formatWeekRange(days)}
            </div>
          </div>

          <button
            type="button"
            onClick={() =>
              changeWeek(7)
            }
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-3xl font-black text-slate-600 shadow-sm active:scale-95 active:bg-slate-50"
            aria-label="Semaine suivante"
          >
            ›
          </button>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-slate-50 px-3 py-2.5 text-center">
            <div className="text-lg font-black text-slate-900">
              {totalMealsThisWeek}
            </div>

            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
              repas
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 px-3 py-2.5 text-center">
            <div className="text-lg font-black text-slate-900">
              {plannedDays}/7
            </div>

            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
              jours
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 px-3 py-2.5 text-center">
            <div className="text-lg font-black text-emerald-600">
              {weekCompleteness}%
            </div>

            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
              complète
            </div>
          </div>
        </div>

        <div className="mb-3 overflow-hidden rounded-2xl bg-slate-100">
          <div
            className="h-1.5 rounded-full bg-emerald-500 transition-all"
            style={{
              width: `${weekCompleteness}%`,
            }}
          />
        </div>

        <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {days.map(day => {
            const active =
              day === selectedDay

            const count =
              plans.filter(
                plan =>
                  plan.scheduled_date ===
                  day
              ).length

            return (
              <button
                key={day}
                type="button"
                onClick={() =>
                  setSelectedDay(day)
                }
                className={`min-w-[55px] flex-1 rounded-2xl border px-2 py-2.5 text-center transition-all active:scale-[0.97] ${
                  active
                    ? 'border-emerald-600 bg-emerald-600 text-white shadow-md ring-2 ring-emerald-200'
                    : count
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : 'border-orange-200 bg-orange-50 text-orange-800'
                }`}
              >
                <div className="text-[10px] font-black uppercase">
                  {getDayLabel(day)}
                </div>

                <div className="text-lg font-black">
                  {getDayNumber(day)}
                </div>

                <div
                  className={`mx-auto mt-1.5 h-1.5 w-7 rounded-full ${
                    active
                      ? 'bg-white'
                      : count
                        ? 'bg-emerald-500'
                        : 'bg-orange-400'
                  }`}
                />
              </button>
            )
          })}
        </div>

        <div className="mt-4 rounded-3xl bg-stone-50 p-3 sm:p-4">
          <div className="mb-4 flex items-end justify-between gap-3 px-1">
            <div>
              <div className="text-[10px] font-black uppercase tracking-wider text-emerald-600">
                Planning
              </div>

              <h2 className="mt-1 text-xl font-black capitalize">
                {formatFrenchDate(
                  selectedDay
                )}
              </h2>
            </div>

            <div className="rounded-xl bg-white px-3 py-2 text-xs font-black text-slate-500 shadow-sm">
              {selectedDayPlans.length}{' '}
              repas
            </div>
          </div>

          {loadingPlans ? (
            <div className="rounded-2xl bg-white px-4 py-10 text-center text-sm text-slate-400">
              Chargement du planning…
            </div>
          ) : (
            <div className="space-y-3">
              <MealSlot
                title="Midi"
                icon="☀️"
                plans={plansForSlot(
                  selectedDay,
                  'midi'
                )}
                getRecipeName={
                  getRecipeName
                }
                onAdd={() =>
                  openAdd(
                    selectedDay,
                    'midi'
                  )
                }
                onDelete={
                  deleteMealPlan
                }
                onChangeServings={
                  changeServings
                }
                disabled={saving}
              />

              <MealSlot
                title="Soir"
                icon="🌙"
                plans={plansForSlot(
                  selectedDay,
                  'soir'
                )}
                getRecipeName={
                  getRecipeName
                }
                onAdd={() =>
                  openAdd(
                    selectedDay,
                    'soir'
                  )
                }
                onDelete={
                  deleteMealPlan
                }
                onChangeServings={
                  changeServings
                }
                disabled={saving}
              />
            </div>
          )}
        </div>
      </section>

      <section className="mt-4 hidden rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:block">
        <div className="mb-3 text-sm font-black text-slate-800">
          Vue semaine
        </div>

        <div className="grid grid-cols-7 gap-2">
          {days.map(day => {
            const dayPlans =
              plans.filter(
                plan =>
                  plan.scheduled_date ===
                  day
              )

            return (
              <button
                key={day}
                type="button"
                onClick={() =>
                  setSelectedDay(day)
                }
                className={`rounded-2xl border p-3 text-left ${
                  day === selectedDay
                    ? 'border-emerald-300 bg-emerald-50'
                    : dayPlans.length
                      ? 'border-emerald-200 bg-emerald-50/40'
                      : 'border-orange-200 bg-orange-50/40'
                }`}
              >
                <div className="text-[10px] font-black uppercase text-emerald-600">
                  {getDayLabel(day)}
                </div>

                <div className="mt-1 text-sm font-black">
                  {getDayNumber(day)}
                </div>

                <div className="mt-3 space-y-2 text-[11px]">
                  <div>
                    <div className="font-bold text-slate-400">
                      Midi
                    </div>

                    <div className="truncate font-semibold">
                      {plansForSlot(
                        day,
                        'midi'
                      )[0]
                        ? getRecipeName(
                            plansForSlot(
                              day,
                              'midi'
                            )[0]
                              .recipe_id
                          )
                        : '—'}
                    </div>
                  </div>

                  <div>
                    <div className="font-bold text-slate-400">
                      Soir
                    </div>

                    <div className="truncate font-semibold">
                      {plansForSlot(
                        day,
                        'soir'
                      )[0]
                        ? getRecipeName(
                            plansForSlot(
                              day,
                              'soir'
                            )[0]
                              .recipe_id
                          )
                        : '—'}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </main>
  )
}