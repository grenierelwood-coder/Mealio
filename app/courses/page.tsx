'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type RecipeLink = {
  recipe_id: string
  recipe_nom: string
  qte_contribuee: number | null
}

type ShoppingItem = {
  id: string
  list_id: string
  updated_at: string | null
  produit: string
  ingredient_id: string | null

  // Besoin calculé par Mealio
  qte: number | null

  // Quantité que l'utilisateur souhaite acheter
  qte_achat: number | null

  // Quantité réellement achetée
  qte_achetee: number | null
  stock_stored_quantity: number | null

  unite: string | null
  quantity_mode?: 'quantity' | 'presence'
  rayon: string | null

  is_checked: boolean
  is_manual: boolean

  ai_status:
    | 'green'
    | 'orange'
    | 'red'
    | 'recurrent'
    | null

  recipes: RecipeLink[]
}

type ShoppingList = {
  id: string
  created_at: string
  user_id: string
  name: string
  status: 'en_cours' | 'terminee'
  period_start: string | null
  period_end: string | null
}

type ShoppingIssue = {
  id?: string
  list_id: string
  shopping_item_id?: string | null
  phase: 'generation' | 'storage' | 'finish'
  issue_type: string
  produit: string
  unit?: string | null
  message: string
  resolution_hint: string
  status: string
  created_at?: string
}

type ShoppingResponse = {
  list: ShoppingList | null
  items: ShoppingItem[]
  total: number
  checked: number
  unchecked: number
  issues?: ShoppingIssue[]
  error?: string
}

type MealPlan = {
  id: string
  user_id: string
  recipe_id: string
  scheduled_date: string
  meal_type: 'midi' | 'soir'
  role: string
  servings: number
}

type StatusFilter =
  | 'tous'
  | 'a_acheter'
  | 'urgent'
  | 'recurrent'

type ReplenishmentSuggestion = {
  key: string
  source: 'threshold' | 'recurring'
  rule_id: string
  ingredient_id: string | null
  produit: string
  quantity: number
  unite: string
  reason: string
  mode: 'suggestion' | 'systematic'
  stock_quantity: number | null
  stock_unit: string | null
  min_quantity: number | null
  target_quantity: number | null
  due_date: string | null
}

type FavoriteIngredient = {
  ingredient_id: string
  nom: string
  categorie: string | null
  default_storage: string | null
  purchase_count: number
  last_purchased_at: string | null
  unite: string
}

type GenerationResult = {
  listId?: string
  itemCount?: number
  wasCreated?: boolean
  issueCount?: number
  issues?: ShoppingIssue[]
  message?: string
  error?: string
}

type FinishResult = {
  list?: ShoppingList
  message?: string
  error?: string
}

type StoredResult = {
  shopping_item_id: string
  produit: string
  qte: number
  unite: string
  storage: 'frosti' | 'cellio' | null
  stock_item_id: string
  location_id?: string
  location_name?: string
  rule_label?: string
}

type SkippedResult = {
  shopping_item_id: string
  produit: string
  reason: string
}

type OfficialIngredientOption = {
  id: string
  nom: string
  categorie: string | null
  default_storage: string | null
  default_is_fridge: boolean | null
}

type ContinuationItem = {
  produit: string
  ingredient_id: string | null
  qte: number
  unite: string | null
  quantity_mode?: 'quantity' | 'presence'
  rayon: string | null
  recipes: RecipeLink[]
}


/*
 * --------------------------------------------------------------------------
 * OUTILS DE FORMATAGE
 * --------------------------------------------------------------------------
 */

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0'
  }

  if (Number.isInteger(value)) {
    return String(value)
  }

  return String(
    Number(value.toFixed(2))
  )
}

function formatQuantity(
  qte: number | null,
  unite: string | null,
  quantityMode: 'quantity' | 'presence' = 'quantity'
): string {
  if (quantityMode === 'presence') return 'Présence'

  if (qte === null) {
    return unite ?? ''
  }

  const value = formatNumber(qte)

  return unite
    ? `${value} ${unite}`
    : value
}

function formatPeriod(
  start: string | null,
  end: string | null
): string {
  if (!start || !end) {
    return 'Période non définie'
  }

  const startDate =
    new Date(`${start}T12:00:00`)

  const endDate =
    new Date(`${end}T12:00:00`)

  const formatter =
    new Intl.DateTimeFormat(
      'fr-FR',
      {
        day: 'numeric',
        month: 'short',
      }
    )

  return `${formatter.format(startDate)} → ${formatter.format(endDate)}`
}

function formatDateFrench(
  date: string
): string {
  const value =
    new Date(`${date}T12:00:00`)

  return new Intl.DateTimeFormat(
    'fr-FR',
    {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }
  ).format(value)
}

function toIsoDate(
  date: Date
): string {
  const year =
    date.getFullYear()

  const month =
    String(date.getMonth() + 1)
      .padStart(2, '0')

  const day =
    String(date.getDate())
      .padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getActiveStart(date: Date): Date {
  return new Date(date)
}

function getActiveEnd(date: Date): Date {
  const value = new Date(date)
  value.setDate(value.getDate() + 6)
  return value
}


/*
 * --------------------------------------------------------------------------
 * STATUTS
 * --------------------------------------------------------------------------
 */

function getStatusLabel(
  item: ShoppingItem
): string {
  // Le statut d'achat est prioritaire sur l'ancien statut Matcher.
  // Exemple : 3 carottes achetées pour un besoin de 2 = Acheté,
  // même si ai_status vaut encore "orange" (À compléter).
  if (isItemBought(item)) {
    return 'Acheté'
  }

  if (item.is_manual) {
    return 'Manuel'
  }

  if (item.ai_status === 'red') {
    return 'À acheter'
  }

  if (item.ai_status === 'orange') {
    return 'À vérifier'
  }

  if (
    item.ai_status === 'recurrent'
  ) {
    return 'Récurrent'
  }

  if (
    item.ai_status === 'green'
  ) {
    return 'Disponible'
  }

  return 'À acheter'
}

function getStatusClasses(
  item: ShoppingItem
): string {
  if (isItemBought(item)) {
    return 'border-slate-200 bg-slate-50'
  }

  if (
    item.ai_status === 'red'
  ) {
    return 'border-red-200 bg-red-50'
  }

  if (
    item.ai_status === 'orange'
  ) {
    return 'border-orange-200 bg-orange-50'
  }

  if (
    item.ai_status === 'recurrent'
  ) {
    return 'border-purple-200 bg-purple-50'
  }

  if (item.is_manual) {
    return 'border-blue-200 bg-blue-50'
  }

  return 'border-slate-200 bg-white'
}

function getStatusDot(
  item: ShoppingItem
): string {
  if (isItemBought(item)) {
    return 'bg-slate-400'
  }

  if (
    item.ai_status === 'red'
  ) {
    return 'bg-red-500'
  }

  if (
    item.ai_status === 'orange'
  ) {
    return 'bg-orange-500'
  }

  if (
    item.ai_status === 'recurrent'
  ) {
    return 'bg-purple-500'
  }

  if (item.is_manual) {
    return 'bg-blue-500'
  }

  return 'bg-emerald-500'
}

/*
 * --------------------------------------------------------------------------
 * PAS DE QUANTITÉ NÉGATIVE
 * --------------------------------------------------------------------------
 */

function safeQuantity(
  value: number | null
): number {
  if (
    value === null ||
    !Number.isFinite(value)
  ) {
    return 0
  }

  return Math.max(
    0,
    value
  )
}

/*
 * --------------------------------------------------------------------------
 * QUANTITÉS
 *
 * qte         = besoin calculé
 * qte_achat   = quantité souhaitée à acheter
 * qte_achetee = quantité effectivement achetée
 * reste       = besoin non couvert par l'achat
 * --------------------------------------------------------------------------
 */

function getInitialPurchaseQuantity(
  item: ShoppingItem
): number {
  if (
    item.qte_achat !== null &&
    Number.isFinite(item.qte_achat)
  ) {
    return Math.max(
      0,
      item.qte_achat
    )
  }

  return safeQuantity(
    item.qte
  )
}

function getBoughtQuantity(
  item: ShoppingItem
): number {
  return safeQuantity(
    item.qte_achetee
  )
}

/**
 * Un article est considéré comme acheté uniquement lorsque la quantité
 * réellement achetée atteint la quantité attendue.
 *
 * La coche est un état d'interface ; elle ne constitue jamais une quantité
 * achetée à elle seule.
 */
function isItemBought(item: ShoppingItem): boolean {
  const required = safeQuantity(item.qte)
  const bought = getBoughtQuantity(item)

  // La quantité réellement saisie est la seule source de vérité.
  // is_checked reste une information d'interface et ne peut plus faire
  // disparaître un article ou déclencher artificiellement un achat.
  return required > 0 && bought >= required
}

function getItemPurchaseProgress(item: ShoppingItem): string {
  const required = safeQuantity(item.qte)
  const bought = getBoughtQuantity(item)

  if (isItemBought(item)) {
    return 'Acheté'
  }

  if (bought > 0 && required > bought) {
    return `Partiel · ${formatNumber(bought)} / ${formatNumber(required)}`
  }

  return 'À acheter'
}

function getRemainingQuantity(
  item: ShoppingItem
): number {
  const required =
    safeQuantity(item.qte)

  const bought =
    getBoughtQuantity(item)

  return Math.max(
    required - bought,
    0
  )
}

function getEffectiveBoughtQuantity(
  item: ShoppingItem
): number {
  // Source de vérité unique : la quantité réellement achetée.
  // is_checked est uniquement un état d'interface.
  return getBoughtQuantity(item)
}

function getEffectiveRemainingQuantity(
  item: ShoppingItem
): number {
  const required =
    safeQuantity(item.qte)

  const bought =
    getEffectiveBoughtQuantity(item)

  return Math.max(
    required - bought,
    0
  )
}

/*
 * --------------------------------------------------------------------------
 * PAS DE QUANTITÉ
 *
 * kg  -> +1
 * g   -> +100
 * mg  -> +100
 * L   -> +1
 * cL  -> +5
 * mL  -> +100
 * reste -> +1
 * --------------------------------------------------------------------------
 */

function getQuantityStep(
  unite: string | null
): number {
  const normalized =
    (unite ?? '')
      .trim()
      .toLowerCase()

  if (
    normalized === 'kg' ||
    normalized.includes('kilogram')
  ) {
    return 1
  }

  if (
    normalized === 'g' ||
    normalized.includes('gram')
  ) {
    return 100
  }

  if (
    normalized === 'mg' ||
    normalized.includes('milligram')
  ) {
    return 100
  }

  if (
    normalized === 'l' ||
    normalized === 'litre' ||
    normalized === 'litres'
  ) {
    return 1
  }

  if (
    normalized === 'cl' ||
    normalized === 'centilitre' ||
    normalized === 'centilitres'
  ) {
    return 5
  }

  if (
    normalized === 'ml' ||
    normalized === 'millilitre' ||
    normalized === 'millilitres'
  ) {
    return 100
  }

  return 1
}

function getStepDecimals(
  step: number
): number {
  if (
    Number.isInteger(step)
  ) {
    return 0
  }

  const text =
    String(step)

  const decimalPart =
    text.split('.')[1]

  return decimalPart
    ? decimalPart.length
    : 0
}

function adjustQuantity(
  value: number,
  delta: number,
  step: number
): number {
  const next =
    Math.max(
      0,
      value + delta * step
    )

  const decimals =
    getStepDecimals(step)

  return Number(
    next.toFixed(decimals)
  )
}

/*
 * --------------------------------------------------------------------------
 * RECETTES UNIQUES
 *
 * Certaines lignes peuvent contenir deux fois
 * la même recette associée au même article.
 *
 * On déduplique sur recipe_id afin :
 * - d'éviter les clés React dupliquées ;
 * - de ne pas afficher deux fois la même recette ;
 * - de conserver une seule représentation de chaque recette.
 * --------------------------------------------------------------------------
 */

function getUniqueRecipes(
  recipes: RecipeLink[]
): RecipeLink[] {
  return Array.from(
    new Map(
      recipes.map(recipe => [
        recipe.recipe_id,
        recipe,
      ])
    ).values()
  )
}

/*
 * --------------------------------------------------------------------------
 * COMPOSANT
 * --------------------------------------------------------------------------
 */

export default function CoursesPage() {
  const [data, setData] =
    useState<ShoppingResponse | null>(
      null
    )

  const [loading, setLoading] =
    useState(true)

  const [error, setError] =
    useState<string | null>(null)

  const [filter, setFilter] =
    useState<StatusFilter>('tous')

  const [showChecked, setShowChecked] =
    useState(false)

  const [storeMode, setStoreMode] =
    useState(false)

  const [updatingItems, setUpdatingItems] =
    useState<Set<string>>(
      new Set()
    )

  const [generating, setGenerating] =
    useState(false)

  const [generationMessage, setGenerationMessage] =
    useState<string | null>(null)

  const [generationError, setGenerationError] =
    useState<string | null>(null)

  const [planningCount, setPlanningCount] =
    useState(0)

  const [planningStart, setPlanningStart] =
    useState<string | null>(null)

  const [planningEnd, setPlanningEnd] =
    useState<string | null>(null)

  const [futurePlanningCount, setFuturePlanningCount] =
    useState(0)

  const [showAddForm, setShowAddForm] =
    useState(false)

  const [showFavorites, setShowFavorites] =
    useState(false)

  const [favorites, setFavorites] =
    useState<FavoriteIngredient[]>([])

  const [loadingFavorites, setLoadingFavorites] =
    useState(false)

  const [addingFavorite, setAddingFavorite] =
    useState<string | null>(null)

  const [replenishmentSuggestions, setReplenishmentSuggestions] =
    useState<ReplenishmentSuggestion[]>([])

  const [loadingReplenishment, setLoadingReplenishment] =
    useState(false)

  const [addingReplenishment, setAddingReplenishment] =
    useState<string | null>(null)

  const [manualProduct, setManualProduct] =
    useState('')

  const [manualQuantity, setManualQuantity] =
    useState('1')

  const [manualUnit, setManualUnit] =
    useState('pièce(s)')

  const [addingManualProduct, setAddingManualProduct] =
    useState(false)

  const [finishing, setFinishing] =
    useState(false)

  const [completedList, setCompletedList] =
    useState<ShoppingList | null>(null)

  const [completedStored, setCompletedStored] =
    useState<StoredResult[]>([])

  const [completedSkipped, setCompletedSkipped] =
    useState<SkippedResult[]>([])

  const [remainingItems, setRemainingItems] =
    useState<ContinuationItem[]>([])

  const [continuingShopping, setContinuingShopping] =
    useState(false)

  const [ingredientOptions, setIngredientOptions] =
    useState<OfficialIngredientOption[]>([])

  const [resolvingItems, setResolvingItems] =
    useState<Set<string>>(new Set())

  /*
   * --------------------------------------------------------------------------
   * CHARGEMENT LISTE
   * --------------------------------------------------------------------------
   */

  async function loadFavorites() {
    try {
      setLoadingFavorites(true)
      const response = await fetch('/api/replenishment', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error ?? 'Impossible de charger les favoris.')
      }
      setFavorites((result?.favorites ?? []) as FavoriteIngredient[])
    } catch (err) {
      console.error('❌ Erreur chargement favoris :', err)
      setError(err instanceof Error ? err.message : 'Impossible de charger les favoris.')
    } finally {
      setLoadingFavorites(false)
    }
  }

  async function addFavoriteToCourses(favorite: FavoriteIngredient) {
    if (addingFavorite) return
    try {
      setAddingFavorite(favorite.ingredient_id)
      setError(null)
      const response = await fetch('/api/replenishment/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produit: favorite.nom,
          ingredient_id: favorite.ingredient_id,
          quantity: 1,
          unite: favorite.unite || 'Pièce',
          source: 'favorite',
        }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error ?? 'Impossible d’ajouter le favori aux courses.')
      }
      await loadShoppingList(false)
      setGenerationMessage(`${favorite.nom} ajouté aux courses.`)
    } catch (err) {
      console.error('❌ Erreur ajout favori :', err)
      setError(err instanceof Error ? err.message : 'Impossible d’ajouter le favori aux courses.')
    } finally {
      setAddingFavorite(null)
    }
  }

  async function loadReplenishmentCockpit() {
    try {
      setLoadingReplenishment(true)
      const response = await fetch('/api/replenishment/courses', { method: 'POST', cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Impossible de vérifier les réapprovisionnements.')
      setReplenishmentSuggestions((result?.suggestions ?? []) as ReplenishmentSuggestion[])
    } catch (err) {
      console.error('❌ Erreur contrôle réapprovisionnement :', err)
    } finally {
      setLoadingReplenishment(false)
    }
  }

  async function addReplenishmentSuggestion(suggestion: ReplenishmentSuggestion) {
    if (addingReplenishment) return
    try {
      setAddingReplenishment(suggestion.key)
      setError(null)
      const response = await fetch('/api/replenishment/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          produit: suggestion.produit,
          ingredient_id: suggestion.ingredient_id,
          quantity: suggestion.quantity,
          unite: suggestion.unite,
          source: suggestion.source,
          rule_id: suggestion.rule_id,
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Impossible d’ajouter le réapprovisionnement aux courses.')
      setReplenishmentSuggestions(current => current.filter(item => item.key !== suggestion.key))
      await loadShoppingList(false)
      setGenerationMessage(`${suggestion.produit} ajouté aux courses.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’ajouter le réapprovisionnement aux courses.')
    } finally {
      setAddingReplenishment(null)
    }
  }

  async function loadShoppingList(showLoading = true) {
    try {
      if (showLoading) setLoading(true)
      setError(null)

      const response =
        await fetch(
          '/api/shopping-list',
          {
            cache: 'no-store',
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result?.error ??
            'Impossible de charger la liste de courses.'
        )
      }

      setData(result)
    } catch (err) {
      console.error(
        '❌ Erreur chargement courses :',
        err
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de charger la liste de courses.'
      )
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  /*
   * --------------------------------------------------------------------------
   * CHARGEMENT PLANNING
   * --------------------------------------------------------------------------
   */

  async function loadPlanningPeriod() {
    try {
      const response = await fetch('/api/meal-plans', {
        cache: 'no-store',
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          result?.error ??
            'Impossible de charger le planning.'
        )
      }

      const plans = (result?.plans ?? []) as MealPlan[]
      const today = new Date()
      const activeStart = toIsoDate(getActiveStart(today))
      const activeEnd = toIsoDate(getActiveEnd(today))

      const nextStartDate = new Date(`${activeEnd}T12:00:00`)
      nextStartDate.setDate(nextStartDate.getDate() + 1)
      const nextEndDate = new Date(nextStartDate)
      nextEndDate.setDate(nextEndDate.getDate() + 6)
      const nextStart = toIsoDate(nextStartDate)
      const nextEnd = toIsoDate(nextEndDate)

      const activePlans = plans.filter(plan =>
        plan.scheduled_date >= activeStart &&
        plan.scheduled_date <= activeEnd
      )

      const futurePlans = plans.filter(plan =>
        plan.scheduled_date >= nextStart &&
        plan.scheduled_date <= nextEnd
      )

      setPlanningCount(activePlans.length)
      setFuturePlanningCount(futurePlans.length)
      setPlanningStart(activeStart)
      setPlanningEnd(activeEnd)
    } catch (err) {
      console.error(
        '❌ Erreur chargement planning pour courses :',
        err
      )
      setPlanningCount(0)
      setFuturePlanningCount(0)
      setPlanningStart(null)
      setPlanningEnd(null)
    }
  }

  useEffect(() => {
    void (async () => {
      await loadReplenishmentCockpit()
      await loadShoppingList()
      await loadReplenishmentCockpit()
      await loadPlanningPeriod()
    })()
  }, [])

  // Synchronisation légère pour les foyers où plusieurs personnes font
  // les courses simultanément. Une modification locale en vol est prioritaire
  // afin d'éviter qu'un rafraîchissement distant ne l'écrase à l'écran.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (generating || finishing || updatingItems.size > 0) return
      void loadShoppingList(false)
    }, 4000)

    const onFocus = () => {
      if (generating || finishing || updatingItems.size > 0) return
      void loadShoppingList(false)
      void loadReplenishmentCockpit()
    }

    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [generating, finishing, updatingItems])

  /*
   * --------------------------------------------------------------------------
   * PÉRIODE DE GÉNÉRATION
   * --------------------------------------------------------------------------
   */

  const generationPeriod = useMemo(() => {
    const today = new Date()
    return {
      start: toIsoDate(getActiveStart(today)),
      end: toIsoDate(getActiveEnd(today)),
    }
  }, [])


  /*
   * --------------------------------------------------------------------------
   * GÉNÉRATION LISTE
   * --------------------------------------------------------------------------
   */

  async function generateShoppingList() {
    if (generating) {
      return
    }

    let dateStart = generationPeriod.start
    let dateEnd = generationPeriod.end
    let includeFuture = false

    if (futurePlanningCount > 0) {
      const activeEndDate = new Date(`${generationPeriod.end}T12:00:00`)
      const nextEndDate = new Date(activeEndDate)
      nextEndDate.setDate(nextEndDate.getDate() + 7)
      const nextEnd = toIsoDate(nextEndDate)

      includeFuture = window.confirm(
        `Il y a ${futurePlanningCount} repas planifié${futurePlanningCount > 1 ? 's' : ''} dans les 7 jours suivant la période active.\n\nOK = les inclure dans les courses.\nAnnuler = générer uniquement pour les 7 jours actifs.`
      )

      if (includeFuture) {
        dateEnd = nextEnd
      }
    }

    setGenerating(true)
    setGenerationMessage(null)
    setGenerationError(null)
    setError(null)
    setCompletedList(null)
    setCompletedStored([])
    setCompletedSkipped([])
    setRemainingItems([])

    try {
      const response =
        await fetch(
          '/api/shopping-list/generate',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              includeFuture,
              listName: `Courses du ${dateStart} au ${dateEnd}`,
            }),
          }
        )

      const result: GenerationResult =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result.error ??
            'Impossible de générer la liste de courses.'
        )
      }

      setGenerationMessage(
        result.message ??
          'Liste de courses mise à jour.'
      )

      await loadShoppingList()
      await loadReplenishmentCockpit()
      await loadPlanningPeriod()
    } catch (err) {
      console.error(
        '❌ Erreur génération courses :',
        err
      )

      setGenerationError(
        err instanceof Error
          ? err.message
          : 'Impossible de générer la liste de courses.'
      )
    } finally {
      setGenerating(false)
    }
  }

  /*
   * --------------------------------------------------------------------------
   * COCHER / DÉCOCHER
   * --------------------------------------------------------------------------
   */

  async function toggleItem(
    item: ShoppingItem
  ) {
    if (
      updatingItems.has(item.id)
    ) {
      return
    }

    setUpdatingItems(
      current => {
        const next =
          new Set(current)

        next.add(item.id)

        return next
      }
    )

    setError(null)

    try {
      const response =
        await fetch(
          '/api/shopping-list/items',
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              id: item.id,
              expected_updated_at: item.updated_at,
              is_checked:
                !item.is_checked,
            }),
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
        if (response.status === 409) {
          await loadShoppingList(false)
        }
        throw new Error(
          result?.error ??
            'Impossible de mettre à jour l’article.'
        )
      }

      setData(
        current => {
          if (!current) {
            return current
          }

          const nextItems =
            current.items.map(
              currentItem =>
                currentItem.id ===
                item.id
                  ? {
                      ...currentItem,
                      is_checked:
                        !currentItem.is_checked,
                    }
                  : currentItem
            )

          const checked =
            nextItems.filter(
              currentItem => isItemBought(currentItem)
            ).length

          return {
            ...current,
            items: nextItems,
            total:
              nextItems.length,
            checked,
            unchecked:
              nextItems.length -
              checked,
          }
        }
      )
    } catch (err) {
      console.error(
        '❌ Erreur coche article :',
        err
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de mettre à jour l’article.'
      )
    } finally {
      setUpdatingItems(
        current => {
          const next =
            new Set(current)

          next.delete(item.id)

          return next
        }
      )
    }
  }

  /*
   * --------------------------------------------------------------------------
   * MODIFICATION QUANTITÉ D'ACHAT
   *
   * IMPORTANT :
   * on ne modifie jamais qte.
   * qte reste le besoin calculé.
   * --------------------------------------------------------------------------
   */

  async function changePurchaseQuantity(
    item: ShoppingItem,
    delta: number
  ) {
    if (item.quantity_mode === 'presence') return
    if (
      updatingItems.has(item.id)
    ) {
      return
    }

    const current =
      getInitialPurchaseQuantity(item)

    const step =
      getQuantityStep(item.unite)

    const next =
      adjustQuantity(
        current,
        delta,
        step
      )

    await patchItem(
      item,
      {
        qte_achat: next,
      }
    )
  }

  /*
   * --------------------------------------------------------------------------
   * MODIFICATION QUANTITÉ ACHETÉE
   *
   * IMPORTANT :
   * qte_achetee est indépendante de qte_achat.
   *
   * Exemple :
   * besoin 1 kg
   * achat prévu 2 kg
   * acheté réellement 2 kg
   *
   * On peut donc dépasser qte sans bloquer.
   * --------------------------------------------------------------------------
   */

  async function changeBoughtQuantity(
    item: ShoppingItem,
    delta: number
  ) {
    if (item.quantity_mode === 'presence') return
    if (
      updatingItems.has(item.id)
    ) {
      return
    }

    const current =
      getBoughtQuantity(item)

    const step =
      getQuantityStep(item.unite)

    const next =
      adjustQuantity(
        current,
        delta,
        step
      )

    await patchItem(
      item,
      {
        qte_achetee: next,
      }
    )
  }

  /*
   * --------------------------------------------------------------------------
   * PATCH GÉNÉRIQUE
   * --------------------------------------------------------------------------
   */

  async function patchItem(
    item: ShoppingItem,
    patch: {
      is_checked?: boolean
      qte_achat?: number
      qte_achetee?: number
    }
  ) {
    if (
      updatingItems.has(item.id)
    ) {
      return
    }

    setUpdatingItems(
      current => {
        const next =
          new Set(current)

        next.add(item.id)

        return next
      }
    )

    setError(null)

    try {
      const response =
        await fetch(
          '/api/shopping-list/items',
          {
            method: 'PATCH',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              id: item.id,
              expected_updated_at: item.updated_at,
              ...patch,
            }),
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
        if (response.status === 409) {
          await loadShoppingList(false)
        }
        throw new Error(
          result?.error ??
            'Impossible de mettre à jour l’article.'
        )
      }

      const updated =
        result?.item as
          | Partial<ShoppingItem>
          | undefined

      setData(
        current => {
          if (!current) {
            return current
          }

          const nextItems =
            current.items.map(
              currentItem =>
                currentItem.id ===
                item.id
                  ? {
                      ...currentItem,
                      ...patch,
                      ...updated,
                    }
                  : currentItem
            )

          const checked =
            nextItems.filter(
              currentItem => isItemBought(currentItem)
            ).length

          return {
            ...current,
            items: nextItems,
            total:
              nextItems.length,
            checked,
            unchecked:
              nextItems.length -
              checked,
          }
        }
      )
    } catch (err) {
      console.error(
        '❌ Erreur mise à jour article :',
        err
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de mettre à jour l’article.'
      )
    } finally {
      setUpdatingItems(
        current => {
          const next =
            new Set(current)

          next.delete(item.id)

          return next
        }
      )
    }
  }

  /*
   * --------------------------------------------------------------------------
   * SUPPRESSION D'UN ARTICLE
   * --------------------------------------------------------------------------
   */

  async function deleteShoppingItem(item: ShoppingItem) {
    if (updatingItems.has(item.id)) return

    const bought = getBoughtQuantity(item)
    if (bought > 0 || safeQuantity(item.stock_stored_quantity) > 0) {
      setError(`Impossible de supprimer « ${item.produit} » : une quantité a déjà été achetée ou rangée.`)
      return
    }

    const confirmed = window.confirm(`Supprimer « ${item.produit} » de cette liste de courses ?\n\nL'article ne sera pas acheté et sera retiré de la liste actuelle.`)
    if (!confirmed) return

    setUpdatingItems(current => {
      const next = new Set(current)
      next.add(item.id)
      return next
    })
    setError(null)

    try {
      const response = await fetch('/api/shopping-list/items', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id }),
      })
      const result = await response.json()
      if (!response.ok) {
        throw new Error(result?.error ?? 'Impossible de supprimer l’article.')
      }

      setData(current => {
        if (!current) return current
        const nextItems = current.items.filter(currentItem => currentItem.id !== item.id)
        const checked = nextItems.filter(currentItem => isItemBought(currentItem)).length
        return { ...current, items: nextItems, total: nextItems.length, checked, unchecked: nextItems.length - checked }
      })
    } catch (err) {
      console.error('❌ Erreur suppression article :', err)
      setError(err instanceof Error ? err.message : 'Impossible de supprimer l’article.')
    } finally {
      setUpdatingItems(current => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  /*
   * --------------------------------------------------------------------------
   * AJOUT MANUEL
   * --------------------------------------------------------------------------
   */

  async function addManualProduct() {
    const produit =
      manualProduct.trim()

    if (!produit) {
      setError(
        'Indique un produit à ajouter.'
      )
      return
    }

    let qte = 1

    if (
      manualQuantity.trim()
    ) {
      qte =
        Number(
          manualQuantity
        )

      if (
        !Number.isFinite(qte) ||
        qte <= 0
      ) {
        setError(
          'La quantité doit être supérieure à 0.'
        )
        return
      }
    }

    const unite =
      manualUnit.trim() ||
      'pièce(s)'

    try {
      setAddingManualProduct(true)
      setError(null)
      setGenerationMessage(null)

      const response =
        await fetch(
          '/api/shopping-list/items',
          {
            method: 'POST',
            headers: {
              'Content-Type':
                'application/json',
            },
            body: JSON.stringify({
              produit,
              qte,
              unite,
            }),
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
        throw new Error(
          result?.error ??
            'Impossible d’ajouter le produit.'
        )
      }

      await loadShoppingList()

      setManualProduct('')
      setManualQuantity('1')
      setManualUnit('pièce(s)')
      setShowAddForm(false)

      setGenerationMessage(
        `${produit} ajouté à la liste.`
      )
    } catch (err) {
      console.error(
        '❌ Erreur ajout manuel :',
        err
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Impossible d’ajouter le produit.'
      )
    } finally {
      setAddingManualProduct(false)
    }
  }

  /*
   * --------------------------------------------------------------------------
   * TERMINER LES COURSES
   * --------------------------------------------------------------------------
   */

  /*
   * --------------------------------------------------------------------------
   * TERMINER LES COURSES
   *
   * 1. Vérifie les articles non cochés.
   * 2. Transfère les quantités réellement achetées vers Frosti / Cellio.
   * 3. Si le transfert réussit, clôture la liste.
   * --------------------------------------------------------------------------
   */

  async function loadIngredientOptions() {
    try {
      const response = await fetch('/api/ingredients', { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Impossible de charger les ingrédients officiels.')
      setIngredientOptions(result.ingredients ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible de charger les ingrédients officiels.')
    }
  }

  async function resolveSkippedItem(shoppingItemId: string, ingredientId: string) {
    if (!ingredientId) return
    setResolvingItems(previous => new Set(previous).add(shoppingItemId))
    setError(null)
    try {
      const response = await fetch('/api/shopping-list/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ shoppingItemId, ingredientId }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result?.error ?? 'Impossible d’associer l’ingrédient.')

      setCompletedSkipped(previous => previous.filter(item => item.shopping_item_id !== shoppingItemId))
      setData(previous => previous ? { ...previous, items: previous.items.map(item => item.id === shoppingItemId ? { ...item, ingredient_id: ingredientId } : item) } : previous)
      setGenerationMessage('Article associé. Relance la finalisation pour le ranger dans le stock.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’associer l’ingrédient.')
    } finally {
      setResolvingItems(previous => { const next = new Set(previous); next.delete(shoppingItemId); return next })
    }
  }

  async function finishShoppingList() {
    if (finishing || !data?.list) return

    setFinishing(true)
    setError(null)
    setGenerationMessage(null)
    setGenerationError(null)

    try {
      setGenerationMessage('Vérification des achats et rangement du stock…')

      const storeResponse = await fetch('/api/shopping-list/store', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
      })

      const storeResult = await storeResponse.json() as {
        message?: string
        error?: string
        stored?: StoredResult[]
        skipped?: SkippedResult[]
      }

      if (!storeResponse.ok) {
        throw new Error(storeResult?.error ?? 'Impossible de traiter les achats.')
      }

      const storedResults = storeResult.stored ?? []
      const skippedResults = storeResult.skipped ?? []
      setCompletedStored(storedResults)
      setCompletedSkipped(skippedResults)

      // On recharge depuis le serveur : aucune décision de fin ne doit être
      // prise à partir d'un état React potentiellement périmé.
      const freshResponse = await fetch('/api/shopping-list', { cache: 'no-store' })
      const freshData = await freshResponse.json() as ShoppingResponse
      if (!freshResponse.ok) throw new Error(freshData?.error ?? 'Impossible de relire la liste après rangement.')
      setData(freshData)

      const finishResponse = await fetch('/api/shopping-list/finish', {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowIncomplete: false }),
      })

      const finishResult = await finishResponse.json() as FinishResult & {
        code?: string
        missingCount?: number
        items?: Array<{ id: string; produit: string; ingredient_id?: string | null; unite?: string | null; remaining?: number; achete?: number; range?: number }>
      }

      if (!finishResponse.ok && (finishResult.code === 'INCOMPLETE_PURCHASE' || finishResult.code === 'STOCK_TRANSFER_MISSING')) {
        const missing = finishResult.items ?? []
        const isStorageProblem = finishResult.code === 'STOCK_TRANSFER_MISSING'
        const detail = missing.map(item => {
          const suffix = item.remaining != null
            ? ` — reste ${formatNumber(Number(item.remaining))}`
            : item.range != null
              ? ` — rangé ${formatNumber(Number(item.range))} / acheté ${formatNumber(Number(item.achete ?? 0))}`
              : ''
          return `• ${item.produit}${suffix}`
        }).join('\n')
        const confirmed = window.confirm(
          (isStorageProblem
            ? `Certains achats n'ont pas pu être rangés automatiquement.\n\n${detail || `${finishResult.missingCount ?? 0} article(s)`}`
            : `Certains besoins ne sont pas entièrement achetés.\n\n${detail || `${finishResult.missingCount ?? 0} article(s)`}`) +
          `\n\nOK = terminer quand même et conserver ces éléments dans l'historique / les problèmes à corriger.\nAnnuler = continuer les achats.`
        )
        if (!confirmed) {
          setGenerationMessage('Courses non clôturées : tu peux continuer les achats.')
          return
        }

        const forcedResponse = await fetch('/api/shopping-list/finish', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowIncomplete: true }),
        })
        const forcedResult = await forcedResponse.json() as FinishResult & { code?: string }
        if (!forcedResponse.ok) throw new Error(forcedResult.error ?? 'Impossible de terminer les courses.')

        setCompletedList({ ...data.list, status: 'terminee' })
        setRemainingItems(missing.map(item => ({
          produit: item.produit,
          ingredient_id: item.ingredient_id ?? null,
          qte: Number(item.remaining ?? 0),
          unite: item.unite ?? null,
          rayon: null,
          recipes: [],
        })))
        setData({ list: null, items: [], total: 0, checked: 0, unchecked: 0, issues: [] })
        setGenerationMessage(forcedResult.message ?? 'Courses terminées. Les achats incomplets pourront être poursuivis.')
        return
      }

      if (!finishResponse.ok) {
        throw new Error(finishResult.error ?? 'Impossible de terminer les courses.')
      }

      setCompletedList({ ...data.list, status: 'terminee' })
      setRemainingItems([])
      setData({ list: null, items: [], total: 0, checked: 0, unchecked: 0, issues: [] })
      setGenerationMessage(
        `${storedResults.length} article(s) rangé(s). ${finishResult.message ?? 'Courses terminées avec succès.'}`
      )
    } catch (err) {
      console.error('❌ Erreur fin des courses :', err)
      setError(err instanceof Error ? err.message : 'Impossible de terminer les courses.')
    } finally {
      setFinishing(false)
    }
  }

  /*
   * --------------------------------------------------------------------------
   * CONTINUER LES ACHATS
   * --------------------------------------------------------------------------
   */

  async function continueShopping() {
    if (
      continuingShopping ||
      !completedList ||
      remainingItems.length === 0
    ) {
      return
    }

    setContinuingShopping(true)
    setError(null)
    setGenerationMessage(null)

    try {
      const response =
        await fetch(
          '/api/shopping-list/continue',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              listId: completedList.id,
            }),
          }
        )

      const result = await response.json()

      if (!response.ok) {
        throw new Error(
          result?.error ??
            'Impossible de créer la nouvelle liste de courses.'
        )
      }

      setCompletedList(null)
      setCompletedStored([])
      setCompletedSkipped([])
      setRemainingItems([])
      setGenerationMessage(
        result?.message ??
          'Les articles restants ont été remis dans une nouvelle liste de courses.'
      )

      await loadShoppingList()
    } catch (err) {
      console.error(
        '❌ Erreur poursuite des courses :',
        err
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de continuer les achats.'
      )
    } finally {
      setContinuingShopping(false)
    }
  }

  /*
   * --------------------------------------------------------------------------
   * FILTRES
   * --------------------------------------------------------------------------
   */

  const visibleItems =
    useMemo(() => {
      if (!data) {
        return []
      }

      return data.items.filter(item => {
        const bought = isItemBought(item)

        // En mode magasin, un article acheté reste volontairement visible :
        // on doit pouvoir continuer à augmenter la quantité (sur-achat).
        if (!storeMode && !showChecked && bought) {
          return false
        }

        if (filter === 'a_acheter') {
          return !bought && item.ai_status !== 'recurrent'
        }

        if (filter === 'urgent') {
          return !bought && item.ai_status === 'red'
        }

        if (filter === 'recurrent') {
          return !bought && item.ai_status === 'recurrent'
        }

        return true
      })
    }, [data, filter, showChecked, storeMode])

  /*
   * --------------------------------------------------------------------------
   * GROUPEMENT PAR RAYON
   * --------------------------------------------------------------------------
   */

  const groupedItems =
    useMemo(() => {
      const groups =
        new Map<
          string,
          ShoppingItem[]
        >()

      for (
        const item of visibleItems
      ) {
        const rayon =
          item.rayon?.trim() ||
          'Courses'

        const current =
          groups.get(rayon) ??
          []

        current.push(item)

        groups.set(
          rayon,
          current
        )
      }

      const rayonOrder = [
        'Fruits & légumes',
        'Boucherie',
        'Charcuterie',
        'Poissonnerie',
        'Crèmerie',
        'Boulangerie',
        'Épicerie',
        'Boissons',
        'Surgelés',
      ]
      const rank = (value: string) => {
        const index = rayonOrder.findIndex(item => item.localeCompare(value, 'fr', { sensitivity: 'base' }) === 0)
        return index >= 0 ? index : 999
      }
      return Array.from(groups.entries()).sort(([a], [b]) => {
        const ra = rank(a)
        const rb = rank(b)
        if (ra !== rb) return ra - rb
        if (ra === 999 && a === 'Courses') return 1
        if (rb === 999 && b === 'Courses') return -1
        return a.localeCompare(b, 'fr')
      })
    }, [
      visibleItems,
    ])

  /*
   * --------------------------------------------------------------------------
   * PROGRESSION
   * --------------------------------------------------------------------------
   */

  const total =
    data?.total ?? 0

  const checked =
    data?.items.filter(item => isItemBought(item)).length ?? 0

  const unchecked =
    Math.max(total - checked, 0)

  const progress =
    total > 0
      ? Math.round(
          (checked / total) *
            100
        )
      : 0

  /*
   * --------------------------------------------------------------------------
   * RENDER
   * --------------------------------------------------------------------------
   */

  return (
    <main className="min-h-screen bg-stone-50 text-slate-900">
      {/* =====================================================================
          NAVIGATION
          ===================================================================== */}


      <div className="mx-auto w-full max-w-3xl px-3 pb-28 pt-5 sm:px-5 sm:pt-7 lg:max-w-5xl">
        {/* ===================================================================
            TITRE
            =================================================================== */}

        <header className="mb-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
                Mealio
              </div>

              <h1 className="mt-1 text-3xl font-black tracking-tight">
                🛒 Mes courses
              </h1>

              <p className="mt-1 text-sm text-slate-500">
                Les ingrédients nécessaires
                pour les repas planifiés,
                après comparaison avec ton stock.
              </p>
            </div>

            <Link
              href="/planning"
              className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm transition hover:border-emerald-200 hover:text-emerald-700"
            >
              Planning
            </Link>
          </div>
        </header>

        {/* ===================================================================
            ERREUR
            =================================================================== */}

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="font-bold">
              Erreur
            </div>

            <div className="mt-1">
              {error}
            </div>
          </div>
        )}

        {/* ===================================================================
            MESSAGE
            =================================================================== */}

        {generationMessage && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
            ✓ {generationMessage}
          </div>
        )}

        {data?.issues && data.issues.length > 0 && (
          <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm sm:p-5">
            <div className="font-black text-amber-950">⚠️ Points à vérifier — sans bloquer les courses</div>
            <p className="mt-1 text-sm text-amber-900">Mealio a généré la liste. Certains articles ont toutefois une correspondance ou une conversion qui mérite une vérification.</p>
            <div className="mt-3 space-y-3">
              {data.issues.map(issue => (
                <div key={issue.id ?? `${issue.issue_type}-${issue.produit}-${issue.message}`} className="rounded-xl border border-amber-200 bg-white p-3">
                  <div className="font-bold text-slate-900">{issue.produit}{issue.unit ? ` · unité : ${issue.unit}` : ''}</div>
                  <div className="mt-1 text-xs text-amber-900">{issue.message}</div>
                  <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">💡 {issue.resolution_hint}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ===================================================================
            LISTE TERMINÉE
            =================================================================== */}

        {!loading &&
          completedList && (
            <section className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-2xl">✓</div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-black text-emerald-900">Courses terminées</h2>
                  <p className="mt-1 text-sm text-emerald-800/80">Les produits achetés ont été rangés dans ton stock.</p>
                  <p className="mt-2 text-xs font-semibold text-emerald-800">{formatPeriod(completedList.period_start, completedList.period_end)}</p>
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl bg-white/80 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Rangés dans le stock</div><div className="mt-1 text-lg font-black text-emerald-700">{completedStored.length}</div></div>
                <div className="rounded-xl bg-white/80 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Restes à acheter</div><div className="mt-1 text-lg font-black text-orange-600">{remainingItems.length}</div></div>
                <div className="rounded-xl bg-white/80 p-3"><div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Non rangés</div><div className="mt-1 text-lg font-black text-red-600">{completedSkipped.length}</div></div>
              </div>

              {completedStored.length > 0 && (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-white/80 p-4">
                  <div className="font-black text-emerald-900">📦 Emplacements utilisés</div>
                  <div className="mt-2 space-y-2 text-sm text-emerald-900">
                    {completedStored.map(item => (
                      <div key={item.shopping_item_id} className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2">
                        <div className="font-bold">{item.produit}</div>
                        <div className="text-xs text-emerald-800">
                          {item.storage === 'frosti' ? '❄️ Frosti' : '🍷 Cellio'} → {item.location_name ?? 'emplacement déterminé'}
                          {item.rule_label ? ` · ${item.rule_label}` : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {remainingItems.length > 0 && (
                <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
                  <div className="font-black text-orange-900">🛍️ Il reste des produits à acheter</div>
                  <div className="mt-2 space-y-1">
                    {remainingItems.map((item, index) => (
                      <div key={`${item.produit}-${item.ingredient_id ?? 'manual'}-${index}`} className="flex items-center justify-between gap-3 text-sm text-orange-900">
                        <span className="font-semibold">{item.produit}</span>
                        <span className="shrink-0 font-black">{formatQuantity(item.qte, item.unite, item.quantity_mode)}</span>
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => void continueShopping()} disabled={continuingShopping} className="mt-4 w-full rounded-xl bg-orange-500 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50">{continuingShopping ? 'Création de la nouvelle liste…' : '🛒 Continuer les achats'}</button>
                </div>
              )}

              {completedSkipped.length > 0 && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
                  <div className="font-black text-red-900">Articles non rangés automatiquement</div>
                  <div className="mt-2 space-y-1 text-xs text-red-800">
                    {completedSkipped.map(item => (
                      <div key={item.shopping_item_id}>• {item.produit} — {item.reason}</div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

        {/* ===================================================================
            ARTICLES NON RANGÉS — RÉSOLUTION AVANT CLÔTURE
            =================================================================== */}

        {!completedList && completedSkipped.length > 0 && (
          <section className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm sm:p-5">
            <div className="font-black text-red-900">⚠️ Articles à résoudre avant de terminer</div>
            <p className="mt-1 text-sm text-red-800">
              Les articles déjà rangés ne seront pas ajoutés une seconde fois. Associe chaque article restant à un ingrédient officiel, puis clique à nouveau sur « Terminer mes courses ».
            </p>
            <div className="mt-4 space-y-3">
              {completedSkipped.map(item => (
                <div key={item.shopping_item_id} className="rounded-xl border border-red-200 bg-white p-3">
                  <div className="font-bold text-slate-900">{item.produit}</div>
                  <div className="mt-1 text-xs text-red-700">{item.reason}</div>
                  <select
                    className="mt-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    defaultValue=""
                    disabled={resolvingItems.has(item.shopping_item_id)}
                    onChange={event => void resolveSkippedItem(item.shopping_item_id, event.target.value)}
                  >
                    <option value="">Choisir l’ingrédient officiel…</option>
                    {ingredientOptions.map(ingredient => (
                      <option key={ingredient.id} value={ingredient.id}>
                        {ingredient.nom}{ingredient.categorie ? ` — ${ingredient.categorie}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ===================================================================
            RÉAPPROVISIONNEMENT
            =================================================================== */}

        {!completedList && (loadingReplenishment || replenishmentSuggestions.length > 0) && (
          <section className="mb-5 rounded-2xl border border-purple-200 bg-purple-50 p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-2xl shadow-sm">🔔</div>
              <div className="min-w-0 flex-1">
                <div className="font-black text-purple-950">Réapprovisionnement détecté</div>
                <p className="mt-1 text-xs leading-5 text-purple-900/80">Mealio surveille automatiquement les règles du foyer. Les propositions restent à ta décision.</p>
              </div>
            </div>

            {loadingReplenishment ? (
              <div className="mt-3 rounded-xl bg-white p-3 text-sm text-slate-500">Vérification des seuils et récurrents…</div>
            ) : (
              <div className="mt-3 space-y-2">
                {replenishmentSuggestions.map(suggestion => (
                  <div key={suggestion.key} className="flex flex-col gap-3 rounded-xl bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-black">{suggestion.produit} · {formatQuantity(suggestion.quantity, suggestion.unite)}</div>
                      <div className="mt-1 text-xs text-slate-600">{suggestion.source === 'threshold' ? '⚖️ Seuil' : '🔁 Récurrent'} · {suggestion.reason}</div>
                    </div>
                    <button type="button" onClick={() => void addReplenishmentSuggestion(suggestion)} disabled={addingReplenishment !== null} className="shrink-0 rounded-xl bg-purple-700 px-4 py-2.5 text-sm font-black text-white hover:bg-purple-800 disabled:opacity-50">
                      {addingReplenishment === suggestion.key ? '…' : 'Ajouter aux courses'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ===================================================================
            GÉNÉRATION
            =================================================================== */}

        {!completedList && (
          <section className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm sm:p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-2xl shadow-sm">
                🛒
              </div>

              <div className="min-w-0 flex-1">
                <div className="font-black text-emerald-900">
                  Générer les courses du planning
                </div>

                <p className="mt-1 text-xs leading-5 text-emerald-800/80">
                  Mealio analyse les recettes
                  planifiées, ajuste les quantités
                  selon les portions et retire ce
                  qui est déjà disponible en stock.
                </p>

                <div className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-xs font-semibold text-emerald-800">
                  {planningCount > 0
                    ? `${planningCount} repas planifié${
                        planningCount > 1 ? 's' : ''
                      } · période active · ${formatPeriod(
                        generationPeriod.start,
                        generationPeriod.end
                      )}`
                    : `Période active · ${formatPeriod(
                        generationPeriod.start,
                        generationPeriod.end
                      )}`}
                  {futurePlanningCount > 0 && (
                    <div className="mt-1 text-[11px] font-medium text-emerald-700">
                      + {futurePlanningCount} repas dans les 7 jours suivants : Mealio te demandera si tu veux les inclure.
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={
                    generateShoppingList
                  }
                  disabled={generating}
                  className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generating
                    ? 'Génération en cours…'
                    : data?.list
                      ? '↻ Mettre à jour mes courses'
                      : 'Générer mes courses'}
                </button>
              </div>
            </div>

            {generationError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                {generationError}
              </div>
            )}
          </section>
        )}

        {/* ===================================================================
            FAVORIS
            =================================================================== */}

        {!completedList && (
          <section className="mb-5 rounded-2xl border border-amber-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() => {
                const next = !showFavorites
                setShowFavorites(next)
                if (next && favorites.length === 0) void loadFavorites()
              }}
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
            >
              <div>
                <div className="font-black">⭐ Mes favoris</div>
                <div className="mt-0.5 text-xs text-slate-500">Ajouter rapidement aux courses les produits que le foyer achète le plus souvent.</div>
              </div>
              <span className="text-xl text-slate-400">{showFavorites ? '−' : '+'}</span>
            </button>

            {showFavorites && (
              <div className="border-t border-amber-100 bg-amber-50/40 p-4">
                {loadingFavorites ? (
                  <div className="py-4 text-center text-sm text-slate-500">Chargement des favoris…</div>
                ) : favorites.length === 0 ? (
                  <div className="rounded-xl bg-white p-4 text-sm text-slate-500">Aucun favori disponible pour le moment.</div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {favorites.map(favorite => (
                      <div key={favorite.ingredient_id} className="flex items-center justify-between gap-3 rounded-xl bg-white p-3 shadow-sm">
                        <div className="min-w-0">
                          <div className="truncate font-bold">{favorite.nom}</div>
                          <div className="text-xs text-slate-500">{favorite.purchase_count} achat{favorite.purchase_count > 1 ? 's' : ''} · +1 {favorite.unite}</div>
                        </div>
                        <button
                          type="button"
                          disabled={addingFavorite !== null}
                          onClick={() => void addFavoriteToCourses(favorite)}
                          className="shrink-0 rounded-lg bg-amber-500 px-3 py-2 text-sm font-black text-white hover:bg-amber-600 disabled:opacity-50"
                        >
                          {addingFavorite === favorite.ingredient_id ? '…' : '+1'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {/* ===================================================================
            AJOUT MANUEL
            =================================================================== */}

        {!completedList && (
          <section className="mb-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
            <button
              type="button"
              onClick={() =>
                setShowAddForm(
                  current => !current
                )
              }
              className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left"
            >
              <div>
                <div className="font-black">
                  ＋ Ajouter un produit
                </div>

                <div className="mt-0.5 text-xs text-slate-500">
                  Ajouter quelque chose qui ne vient pas du planning.
                </div>
              </div>

              <span className="text-xl text-slate-400">
                {showAddForm
                  ? '−'
                  : '+'}
              </span>
            </button>

            {showAddForm && (
              <div className="border-t border-slate-100 p-4">
                <div className="grid gap-3 sm:grid-cols-[1fr_100px_130px_auto]">
                  <input
                    value={
                      manualProduct
                    }
                    onChange={event =>
                      setManualProduct(
                        event.target.value
                      )
                    }
                    placeholder="Produit"
                    className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-emerald-500"
                  />

                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={
                      manualQuantity
                    }
                    onChange={event =>
                      setManualQuantity(
                        event.target.value
                      )
                    }
                    className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-emerald-500"
                  />

                  <input
                    value={
                      manualUnit
                    }
                    onChange={event =>
                      setManualUnit(
                        event.target.value
                      )
                    }
                    placeholder="Unité"
                    className="rounded-xl border border-slate-200 px-3 py-3 text-sm outline-none focus:border-emerald-500"
                  />

                  <button
                    type="button"
                    onClick={
                      addManualProduct
                    }
                    disabled={
                      addingManualProduct
                    }
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50"
                  >
                    {addingManualProduct
                      ? 'Ajout…'
                      : 'Ajouter'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ===================================================================
            CHARGEMENT
            =================================================================== */}

        {loading ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <div className="text-sm font-semibold text-slate-500">
              Chargement de tes courses…
            </div>
          </section>
        ) : (
          <>
            {/* ===============================================================
                AUCUNE LISTE
                =============================================================== */}

            {!data?.list ? (
              <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
                <div className="text-5xl">
                  🛒
                </div>

                <h2 className="mt-3 text-lg font-black">
                  Aucune liste de courses active
                </h2>

                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                  Génère tes courses à partir
                  du planning ou ajoute
                  directement un produit.
                </p>
              </section>
            ) : (
              <>
                {/* ===========================================================
                    INFOS LISTE
                    =========================================================== */}

                <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wider text-slate-400">
                        Liste active
                      </div>

                      <div className="mt-1 font-black">
                        {data.list.name}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        {formatPeriod(
                          data.list.period_start,
                          data.list.period_end
                        )}
                      </div>
                    </div>

                    <div className="rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-black text-emerald-700">
                      {unchecked > 0
                        ? `${unchecked} à acheter`
                        : 'Tout est acheté'}
                    </div>
                  </div>
                </section>

                {/* ===========================================================
                    PROGRESSION
                    =========================================================== */}

                <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-wider text-slate-400">
                        Progression
                      </div>

                      <div className="mt-1 text-lg font-black">
                        {checked} / {total} acheté(s)
                      </div>
                    </div>

                    <div className="text-2xl font-black text-emerald-600">
                      {progress}%
                    </div>
                  </div>

                  <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{
                        width: `${progress}%`,
                      }}
                    />
                  </div>
                </section>

                {/* ===========================================================
                    MODE / FILTRES
                    =========================================================== */}

                <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setStoreMode(false)
                      }
                      className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                        !storeMode
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      Vue normale
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setStoreMode(true)
                      }
                      className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                        storeMode
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      🛒 Mode magasin
                    </button>

                    <div className="hidden h-8 w-px bg-slate-200 sm:block" />

                    {(
                      [
                        ['tous', 'Tous'],
                        ['a_acheter', 'À acheter'],
                        ['urgent', 'Urgent'],
                        ['recurrent', 'Récurrents'],
                      ] as [
                        StatusFilter,
                        string
                      ][]
                    ).map(
                      ([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            setFilter(
                              value
                            )
                          }
                          className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                            filter ===
                            value
                              ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                              : 'bg-slate-50 text-slate-500'
                          }`}
                        >
                          {label}
                        </button>
                      )
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setShowChecked(
                          current =>
                            !current
                        )
                      }
                      className={`rounded-xl px-3 py-2 text-xs font-black transition ${
                        showChecked
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {showChecked
                        ? 'Masquer achetés'
                        : 'Afficher achetés'}
                    </button>
                  </div>
                </section>

                {/* ===========================================================
                    MODE MAGASIN : RÉSUMÉ
                    =========================================================== */}

                {storeMode && (
                  <section className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="text-2xl">
                        🛒
                      </div>

                      <div>
                        <div className="font-black text-emerald-900">
                          Mode magasin
                        </div>

                        <p className="mt-1 text-xs leading-5 text-emerald-800/80">
                          La quantité requise reste
                          visible. Ajuste la quantité
                          que tu souhaites acheter,
                          puis indique ce que tu as
                          réellement acheté.
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {/* ===========================================================
                    ARTICLES
                    =========================================================== */}

                {groupedItems.length ===
                0 ? (
                  <section className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                    <div className="text-4xl">
                      {unchecked ===
                      0
                        ? '🎉'
                        : '🔎'}
                    </div>

                    <h2 className="mt-3 font-black">
                      {unchecked ===
                      0
                        ? 'Tout est acheté !'
                        : 'Aucun article dans ce filtre'}
                    </h2>

                    {unchecked ===
                      0 && (
                      <p className="mt-1 text-sm text-slate-500">
                        Ta liste est à jour.
                      </p>
                    )}
                  </section>
                ) : (
                  <div className="space-y-5">
                    {groupedItems.map(
                      ([
                        rayon,
                        items,
                      ]) => (
                        <section
                          key={
                            rayon
                          }
                        >
                          <div className="mb-2 flex items-center justify-between px-1">
                            <h2 className="text-sm font-black uppercase tracking-wide text-slate-500">
                              {rayon}
                            </h2>

                            <span className="text-xs font-bold text-slate-400">
                              {items.length}
                            </span>
                          </div>

                          <div className="space-y-2">
                            {items.map(
                              item => {
                                const updating =
                                  updatingItems.has(
                                    item.id
                                  )

                                const purchaseQuantity =
                                  getInitialPurchaseQuantity(
                                    item
                                  )

                                const boughtQuantity =
                                  getBoughtQuantity(
                                    item
                                  )

                                const remainingQuantity =
                                  getRemainingQuantity(
                                    item
                                  )

                                const step =
                                  getQuantityStep(
                                    item.unite
                                  )

                                /*
                                 * ------------------------------------------------
                                 * MODE MAGASIN
                                 * ------------------------------------------------
                                 */

                                if (
                                  storeMode
                                ) {
                                  return (
                                    <article
                                      key={
                                        item.id
                                      }
                                      className={`rounded-2xl border p-4 shadow-sm transition ${getStatusClasses(
                                        item
                                      )}`}
                                    >
                                      <div className="flex items-start gap-3">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            void toggleItem(
                                              item
                                            )
                                          }
                                          disabled={
                                            updating
                                          }
                                          aria-label={
                                            item.is_checked
                                              ? `Décocher ${item.produit}`
                                              : `Cocher ${item.produit}`
                                          }
                                          className={`mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 font-black transition ${
                                            item.is_checked
                                              ? 'border-emerald-500 bg-emerald-500 text-white'
                                              : 'border-slate-300 bg-white'
                                          }`}
                                        >
                                          {item.is_checked
                                            ? '✓'
                                            : ''}
                                        </button>

                                        <div className="min-w-0 flex-1">
                                          <div className="flex items-start justify-between gap-3">
                                            <div>
                                              <div
                                                className={`font-black ${
                                                  isItemBought(item)
                                                    ? 'text-slate-400 line-through'
                                                    : 'text-slate-900'
                                                }`}
                                              >
                                                {
                                                  item.produit
                                                }
                                              </div>

                                              <div className={`mt-1 text-xs font-black ${
                                                isItemBought(item)
                                                  ? 'text-emerald-700'
                                                  : getBoughtQuantity(item) > 0
                                                    ? 'text-orange-600'
                                                    : 'text-slate-400'
                                              }`}>
                                                {getItemPurchaseProgress(item)}
                                              </div>

                                              <div className="mt-1 flex flex-wrap items-center gap-2">
                                                <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-500">
                                                  <span
                                                    className={`h-2 w-2 rounded-full ${getStatusDot(
                                                      item
                                                    )}`}
                                                  />

                                                  {getStatusLabel(
                                                    item
                                                  )}
                                                </span>

                                                {item.is_manual && (
                                                  <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-black text-blue-700">
                                                    Manuel
                                                  </span>
                                                )}
                                              </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                              {updating && (
                                                <span className="text-xs font-bold text-slate-400">…</span>
                                              )}
                                              <button
                                                type="button"
                                                onClick={() => void deleteShoppingItem(item)}
                                                disabled={updating || getBoughtQuantity(item) > 0}
                                                className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-black text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                                                title="Supprimer de cette liste"
                                              >
                                                🗑
                                              </button>
                                            </div>
                                          </div>

                                          <div className="mt-4 grid gap-2 sm:grid-cols-3">
                                            <div className="rounded-xl bg-white/70 p-3">
                                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                                Besoin
                                              </div>

                                              <div className="mt-1 font-black">
                                                {formatQuantity(
                                                  item.qte,
                                                  item.unite,
                                                  item.quantity_mode
                                                )}
                                              </div>
                                            </div>

                                            <div className="rounded-xl bg-white/70 p-3">
                                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                                À acheter
                                              </div>

                                              {item.quantity_mode === 'presence' ? (
                                                <div className="mt-2 rounded-xl bg-amber-50 px-3 py-3 text-center text-sm font-black text-amber-900">Présence uniquement</div>
                                              ) : (
                                              <div className="mt-2 flex items-center gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void changePurchaseQuantity(
                                                      item,
                                                      -1
                                                    )
                                                  }
                                                  disabled={
                                                    updating ||
                                                    purchaseQuantity <=
                                                      0
                                                  }
                                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-black shadow-sm disabled:opacity-40"
                                                >
                                                  −
                                                </button>

                                                <div className="min-w-0 flex-1 text-center font-black">
                                                  {formatQuantity(
                                                    purchaseQuantity,
                                                    item.unite,
                                                    item.quantity_mode
                                                  )}
                                                </div>

                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void changePurchaseQuantity(
                                                      item,
                                                      1
                                                    )
                                                  }
                                                  disabled={
                                                    updating
                                                  }
                                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-black shadow-sm disabled:opacity-40"
                                                >
                                                  +
                                                </button>
                                              </div>

                                              )}

                                              {item.quantity_mode !== 'presence' && (
                                                <div className="mt-1 text-center text-[10px] text-slate-400">
                                                  Pas :{' '}
                                                  {formatNumber(
                                                    step
                                                  )}
                                                </div>
                                              )}
                                            </div>

                                            <div className="rounded-xl bg-white/70 p-3">
                                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                                Acheté
                                              </div>

                                              {item.quantity_mode === 'presence' ? (
                                                <div className="mt-2 rounded-xl bg-amber-50 px-3 py-3 text-center text-sm font-black text-amber-900">{getBoughtQuantity(item) > 0 ? 'Présent / acheté' : 'À acheter'}</div>
                                              ) : (
                                              <div className="mt-2 flex items-center gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void changeBoughtQuantity(
                                                      item,
                                                      -1
                                                    )
                                                  }
                                                  disabled={
                                                    updating ||
                                                    boughtQuantity <=
                                                      0
                                                  }
                                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-black shadow-sm disabled:opacity-40"
                                                >
                                                  −
                                                </button>

                                                <div className="min-w-0 flex-1 text-center font-black">
                                                  {formatQuantity(
                                                    boughtQuantity,
                                                    item.unite,
                                                    item.quantity_mode
                                                  )}
                                                </div>

                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void changeBoughtQuantity(
                                                      item,
                                                      1
                                                    )
                                                  }
                                                  disabled={
                                                    updating
                                                  }
                                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-lg font-black shadow-sm disabled:opacity-40"
                                                >
                                                  +
                                                </button>
                                              </div>

                                              )}

                                              {item.quantity_mode !== 'presence' && (
                                                <div className="mt-1 text-center text-[10px] font-bold text-slate-400">
                                                  Reste :{' '}
                                                  {formatQuantity(
                                                    remainingQuantity,
                                                    item.unite,
                                                    item.quantity_mode
                                                  )}
                                                </div>
                                              )}
                                            </div>
                                          </div>

                                          {item.recipes.length >
                                            0 && (
                                            <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
                                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                                Pour
                                              </div>

                                              <div className="mt-1 space-y-0.5">
                                                {getUniqueRecipes(
                                                  item.recipes
                                                ).map(
                                                  recipe => (
                                                    <div
                                                      key={`${item.id}-${recipe.recipe_id}`}
                                                      className="text-xs font-semibold text-slate-600"
                                                    >
                                                      •{' '}
                                                      {
                                                        recipe.recipe_nom
                                                      }
                                                    </div>
                                                  )
                                                )}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </article>
                                  )
                                }

                                /*
                                 * ------------------------------------------------
                                 * VUE NORMALE
                                 * ------------------------------------------------
                                 */

                                return (
                                  <article
                                    key={
                                      item.id
                                    }
                                    className={`rounded-2xl border p-4 shadow-sm transition ${getStatusClasses(
                                      item
                                    )}`}
                                  >
                                    <div className="flex items-start gap-3">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void toggleItem(
                                            item
                                          )
                                        }
                                        disabled={
                                          updating
                                        }
                                        aria-label={
                                          item.is_checked
                                            ? `Décocher ${item.produit}`
                                            : `Cocher ${item.produit}`
                                        }
                                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 transition ${
                                          item.is_checked
                                            ? 'border-emerald-500 bg-emerald-500 text-white'
                                            : 'border-slate-300 bg-white'
                                        }`}
                                      >
                                        {item.is_checked
                                          ? '✓'
                                          : ''}
                                      </button>

                                      <div className="min-w-0 flex-1">
                                        <div
                                          className={`font-black ${
                                            isItemBought(item)
                                              ? 'text-slate-400 line-through'
                                              : 'text-slate-900'
                                          }`}
                                        >
                                          {item.produit}
                                        </div>

                                        <div className={`mt-1 text-xs font-black ${
                                          isItemBought(item)
                                            ? 'text-emerald-700'
                                            : getBoughtQuantity(item) > 0
                                              ? 'text-orange-600'
                                              : 'text-slate-400'
                                        }`}>
                                          {getItemPurchaseProgress(item)}
                                        </div>

                                        <div className="mt-2 flex flex-wrap items-center gap-2">
                                          <span className={`inline-flex items-center gap-1 text-xs font-bold ${isItemBought(item) ? 'text-slate-400' : 'text-slate-600'}`}>
                                            <span className={`h-2 w-2 rounded-full ${getStatusDot(item)}`} />
                                            Besoin {formatQuantity(item.qte, item.unite, item.quantity_mode)}
                                          </span>
                                          <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-500">{getStatusLabel(item)}</span>
                                        </div>
                                        {item.quantity_mode === 'presence' ? (
                                          <div className="mt-3 flex items-center justify-between rounded-xl bg-amber-50 px-3 py-2">
                                            <span className="text-[10px] font-black uppercase tracking-wide text-amber-700">Besoin</span>
                                            <span className="text-sm font-black text-amber-900">Présence uniquement</span>
                                          </div>
                                        ) : (
                                          <div className="mt-3 flex items-center justify-between rounded-xl bg-white/70 px-3 py-2">
                                            <span className="text-[10px] font-black uppercase tracking-wide text-slate-400">À acheter</span>
                                            <div className="flex items-center gap-2">
                                              <button type="button" onClick={() => void changePurchaseQuantity(item, -1)} disabled={updating || purchaseQuantity <= 0} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg font-black disabled:opacity-40">−</button>
                                              <span className="min-w-[90px] text-center text-sm font-black">{formatQuantity(purchaseQuantity, item.unite)}</span>
                                              <button type="button" onClick={() => void changePurchaseQuantity(item, 1)} disabled={updating} className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg font-black disabled:opacity-40">+</button>
                                            </div>
                                          </div>
                                        )}

                                        {data?.issues?.filter(issue => issue.shopping_item_id === item.id).map(issue => (
                                          <div key={issue.id ?? `${issue.issue_type}-${item.id}`} className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                                            <div className="text-xs font-black text-amber-950">⚠️ Pourquoi ?</div>
                                            <div className="mt-1 text-xs leading-5 text-amber-900">{issue.message}</div>
                                            <div className="mt-2 text-[11px] font-semibold leading-5 text-amber-800">💡 {issue.resolution_hint}</div>
                                          </div>
                                        ))}

                                        <div className="mt-2 flex justify-end">
                                          <button
                                            type="button"
                                            onClick={() => void deleteShoppingItem(item)}
                                            disabled={updating || getBoughtQuantity(item) > 0}
                                            className="rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-black text-red-600 disabled:cursor-not-allowed disabled:opacity-30"
                                            title="Supprimer de cette liste"
                                          >
                                            🗑 Supprimer
                                          </button>
                                        </div>

                                        {item.recipes.length >
                                          0 && (
                                          <div className="mt-3 rounded-xl bg-white/60 px-3 py-2">
                                            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                              Pour
                                            </div>

                                            <div className="mt-1 space-y-0.5">
                                              {getUniqueRecipes(
                                                item.recipes
                                              ).map(
                                                recipe => (
                                                  <div
                                                    key={`${item.id}-${recipe.recipe_id}`}
                                                    className="text-xs font-semibold text-slate-600"
                                                  >
                                                    •{' '}
                                                    {
                                                      recipe.recipe_nom
                                                    }
                                                  </div>
                                                )
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {updating && (
                                        <div className="shrink-0 text-xs font-bold text-slate-400">
                                          …
                                        </div>
                                      )}
                                    </div>
                                  </article>
                                )
                              }
                            )}
                          </div>
                        </section>
                      )
                    )}
                  </div>
                )}

                {/* ===========================================================
                    TERMINER LES COURSES
                    =========================================================== */}

                <section className="mt-6 rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-black">
                        🏁 Fin des courses
                      </div>

                      <p className="mt-1 text-xs text-slate-500">
                        Une fois terminé, cette liste
                        ne sera plus considérée comme
                        la liste active.
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={
                        finishShoppingList
                      }
                      disabled={
                        finishing ||
                        !data.list
                      }
                      className="w-full rounded-xl bg-emerald-600 px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                    >
                      {finishing
                        ? 'Finalisation…'
                        : '✓ Terminer mes courses'}
                    </button>
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>

    </main>
  )
}