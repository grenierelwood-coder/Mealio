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
  produit: string
  ingredient_id: string | null

  // Besoin calculé par Mealio
  qte: number | null

  // Quantité que l'utilisateur souhaite acheter
  qte_achat: number | null

  // Quantité réellement achetée
  qte_achetee: number | null

  unite: string | null
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

type ShoppingResponse = {
  list: ShoppingList | null
  items: ShoppingItem[]
  total: number
  checked: number
  unchecked: number
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

type GenerationResult = {
  listId?: string
  itemCount?: number
  wasCreated?: boolean
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
  unite: string | null
): string {
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
    return 'À compléter'
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
 * Un article est considéré comme acheté si :
 * - il est explicitement coché ; ou
 * - la quantité réellement achetée atteint la quantité attendue.
 *
 * La coche reste donc un raccourci pratique, mais elle n'est plus la seule
 * façon de terminer un article.
 */
function isItemBought(item: ShoppingItem): boolean {
  if (item.is_checked) {
    return true
  }

  const required = Math.max(
    0,
    safeQuantity(item.qte_achat) || safeQuantity(item.qte)
  )

  const bought = getBoughtQuantity(item)

  return required > 0 && bought >= required
}

function getItemPurchaseProgress(item: ShoppingItem): string {
  const required = Math.max(
    0,
    safeQuantity(item.qte_achat) || safeQuantity(item.qte)
  )
  const bought = getBoughtQuantity(item)

  if (isItemBought(item)) {
    return 'Acheté'
  }

  if (bought > 0 && required > bought) {
    return `Partiel · ${formatQuantity(bought)} / ${formatQuantity(required)}`
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
  const explicitBought =
    getBoughtQuantity(item)

  if (explicitBought > 0) {
    return explicitBought
  }

  if (item.is_checked) {
    return getInitialPurchaseQuantity(item)
  }

  return 0
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

  async function loadShoppingList() {
    try {
      setLoading(true)
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
      setLoading(false)
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
    void loadShoppingList()
    void loadPlanningPeriod()
  }, [])

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
              is_checked:
                !item.is_checked,
            }),
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
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
              ...patch,
            }),
          }
        )

      const result =
        await response.json()

      if (!response.ok) {
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
    if (finishing) {
      return
    }

    if (!data?.list) {
      setError(
        'Aucune liste de courses active.'
      )
      return
    }

    const listBeforeFinish = data.list
    const remainingBeforeFinish =
      data.items
        .map(item => ({
          item,
          remaining: getEffectiveRemainingQuantity(item),
        }))
        .filter(({ remaining }) => remaining > 0)
        .map(({ item, remaining }) => ({
          produit: item.produit,
          ingredient_id: item.ingredient_id,
          qte: remaining,
          unite: item.unite,
          rayon: item.rayon,
          recipes: getUniqueRecipes(item.recipes),
        }))

    const incompleteCount = remainingBeforeFinish.length

    if (incompleteCount > 0) {
      const confirmed =
        window.confirm(
          `Il reste ${incompleteCount} article${incompleteCount > 1 ? 's' : ''} dont la quantité attendue n'est pas entièrement achetée.\n\nVeux-tu quand même terminer les courses ?`
        )

      if (!confirmed) {
        return
      }
    }

    setFinishing(true)
    setError(null)
    setGenerationMessage(null)
    setGenerationError(null)

    try {
      // Si l'utilisateur a planifié un repas après la dernière génération et
      // que la liste active est encore vide, on la synchronise automatiquement
      // avant de tenter le rangement.
      if (data.total === 0) {
        setGenerationMessage('Synchronisation avec le planning…')
        const syncResponse = await fetch('/api/shopping-list/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({ includeFuture: false }),
        })
        const syncResult = await syncResponse.json()
        if (!syncResponse.ok) {
          throw new Error(syncResult?.error ?? 'Impossible de synchroniser le planning.')
        }
        await loadShoppingList()
        await loadPlanningPeriod()
      }

      setGenerationMessage(
        'Rangement des produits achetés…'
      )

      const storeResponse =
        await fetch(
          '/api/shopping-list/store',
          {
            method: 'POST',
            cache: 'no-store',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        )

      const storeResult = await storeResponse.json() as {
        message?: string
        error?: string
        stored?: StoredResult[]
        skipped?: SkippedResult[]
      }

      if (!storeResponse.ok) {
        throw new Error(
          storeResult?.error ??
            'Impossible de ranger les produits achetés dans le stock.'
        )
      }

      const storedResults = storeResult.stored ?? []
      const skippedResults = storeResult.skipped ?? []

      setCompletedStored(storedResults)
      setCompletedSkipped(skippedResults)
      setRemainingItems(remainingBeforeFinish)

      // Un article totalement acheté ET correctement rangé ne doit plus
      // apparaître dans la liste active, même si un autre article bloque
      // encore la clôture (ex. article inconnu à résoudre).
      if (storedResults.length > 0) {
        const storedIds = new Set(
          storedResults.map(result => result.shopping_item_id)
        )

        setData(previous => {
          if (!previous) return previous

          const remainingItems = previous.items.filter(item => {
            if (!storedIds.has(item.id)) return true

            // Un achat partiel reste visible : il faut seulement retirer les
            // articles dont la quantité achetée couvre réellement le besoin.
            return !isItemBought(item)
          })

          const checkedCount = remainingItems.filter(item => isItemBought(item)).length

          return {
            ...previous,
            items: remainingItems,
            total: remainingItems.length,
            checked: checkedCount,
            unchecked: remainingItems.length - checkedCount,
          }
        })
      }

      if (skippedResults.length > 0) {
        await loadIngredientOptions()
        setGenerationMessage(
          `${storedResults.length} article(s) rangé(s). ${skippedResults.length} article(s) nécessitent une résolution avant de clôturer les courses.`
        )
        // La liste reste active pour les articles non résolus ou incomplets,
        // mais les articles déjà totalement achetés et rangés ont disparu de
        // l'affichage.
        return
      }

      setGenerationMessage(
        'Produits rangés. Finalisation de la liste…'
      )

      const finishResponse =
        await fetch(
          '/api/shopping-list/finish',
          {
            method: 'POST',
            cache: 'no-store',
          }
        )

      const finishResult: FinishResult =
        await finishResponse.json()

      if (!finishResponse.ok) {
        throw new Error(
          finishResult.error ??
            'Les produits ont été rangés, mais impossible de clôturer la liste.'
        )
      }

      setCompletedList({
        ...listBeforeFinish,
        status: 'terminee',
      })

      setData({
        list: null,
        items: [],
        total: 0,
        checked: 0,
        unchecked: 0,
      })

      const storedCount = (storeResult.stored ?? []).length
      const skippedCount = (storeResult.skipped ?? []).length
      const remainingCount = remainingBeforeFinish.length

      if (remainingCount > 0) {
        setGenerationMessage(
          `${storedCount} article${storedCount > 1 ? 's' : ''} rangé${storedCount > 1 ? 's' : ''}. ${remainingCount} article${remainingCount > 1 ? 's restent' : ' reste'} à acheter.`
        )
      } else if (skippedCount > 0) {
        setGenerationMessage(
          `${storedCount} article${storedCount > 1 ? 's' : ''} rangé${storedCount > 1 ? 's' : ''}. ${skippedCount} article${skippedCount > 1 ? 's' : ''} n'ont pas pu être rangé${skippedCount > 1 ? 's' : ''} automatiquement.`
        )
      } else {
        setGenerationMessage(
          finishResult.message ??
            'Courses terminées et produits rangés dans le stock.'
        )
      }
    } catch (err) {
      console.error(
        '❌ Erreur fin des courses :',
        err
      )

      setError(
        err instanceof Error
          ? err.message
          : 'Impossible de terminer les courses.'
      )
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

      return data.items.filter(
        item => {
          if (
            !showChecked &&
            item.is_checked
          ) {
            return false
          }

          if (
            filter === 'a_acheter'
          ) {
            return (
              !item.is_checked &&
              item.ai_status !==
                'recurrent'
            )
          }

          if (
            filter === 'urgent'
          ) {
            return (
              !item.is_checked &&
              item.ai_status ===
                'red'
            )
          }

          if (
            filter === 'recurrent'
          ) {
            return (
              !item.is_checked &&
              item.ai_status ===
                'recurrent'
            )
          }

          return true
        }
      )
    }, [
      data,
      filter,
      showChecked,
    ])

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

      return Array.from(
        groups.entries()
      ).sort(
        ([a], [b]) =>
          a.localeCompare(
            b,
            'fr'
          )
      )
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
                        <span className="shrink-0 font-black">{formatQuantity(item.qte, item.unite)}</span>
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

                                            {updating && (
                                              <span className="text-xs font-bold text-slate-400">
                                                …
                                              </span>
                                            )}
                                          </div>

                                          <div className="mt-4 grid gap-2 sm:grid-cols-3">
                                            <div className="rounded-xl bg-white/70 p-3">
                                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                                Besoin
                                              </div>

                                              <div className="mt-1 font-black">
                                                {formatQuantity(
                                                  item.qte,
                                                  item.unite
                                                )}
                                              </div>
                                            </div>

                                            <div className="rounded-xl bg-white/70 p-3">
                                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                                À acheter
                                              </div>

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
                                                    item.unite
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

                                              <div className="mt-1 text-center text-[10px] text-slate-400">
                                                Pas :{' '}
                                                {formatNumber(
                                                  step
                                                )}
                                              </div>
                                            </div>

                                            <div className="rounded-xl bg-white/70 p-3">
                                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
                                                Acheté
                                              </div>

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
                                                    item.unite
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

                                              <div className="mt-1 text-center text-[10px] font-bold text-slate-400">
                                                Reste :{' '}
                                                {formatQuantity(
                                                  remainingQuantity,
                                                  item.unite
                                                )}
                                              </div>
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
                                            item.is_checked
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

                                        <div className="mt-1 flex flex-wrap items-center gap-2">
                                          <span
                                            className={`inline-flex items-center gap-1 text-xs font-bold ${
                                              isItemBought(item)
                                                ? 'text-slate-400'
                                                : 'text-slate-600'
                                            }`}
                                          >
                                            <span
                                              className={`h-2 w-2 rounded-full ${getStatusDot(
                                                item
                                              )}`}
                                            />

                                            {formatQuantity(
                                              item.qte,
                                              item.unite
                                            )}
                                          </span>

                                          <span className="rounded-full bg-white/70 px-2 py-1 text-[10px] font-bold text-slate-500">
                                            {getStatusLabel(
                                              item
                                            )}
                                          </span>
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