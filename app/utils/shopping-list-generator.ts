import { mealioServerDb as mealioDb } from '../lib/supabase-server'
import {
  getRecipeDetailsFromCookiwiki,
  RecipeDetails,
} from './cookiwiki-fetcher'
import { getHouseholdStock } from './stock-fetcher'
import {
  loadReferenceData,
  resolveRecipeIngredients,
  aggregateRequirements,
  compareToStock,
  ResolvedIngredient,
} from './matcher'

export interface GenerateShoppingListResult {
  listId: string
  itemCount: number
  wasCreated: boolean
  issueCount: number
  issues: GenerationIssue[]
  message: string
}

export interface GenerationIssue {
  id?: string
  list_id: string
  recipe_id: string | null
  recipe_nom: string | null
  shopping_item_id?: string | null
  produit: string
  unit: string | null
  issue_type: string
  phase: 'generation' | 'storage' | 'finish'
  message: string
  resolution_hint: string
  status: 'open' | 'resolved'
}

type UnitMapping = {
  unite: string
  abreviation?: string | null
  type_unite?: string | null
}

/**
 * Normalise une unité pour permettre de comparer :
 *
 *   "Pièces"       -> "pieces"
 *   "pièce(s)"     -> "pieces"
 *   "c.à.s"        -> "cas"
 *   "C.À.S."       -> "cas"
 *   "mL"           -> "ml"
 *   "Unité "       -> "unite"
 *
 * Cette fonction ne modifie jamais la valeur enregistrée
 * dans la base. Elle sert uniquement à comparer.
 */
function normalizeUnit(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Convertit une unité produite par le Matcher / Cookiwiki
 * vers la valeur EXACTE attendue par :
 *
 *   shopping_items.unite
 *        -> unit_mappings.unite
 *
 * IMPORTANT :
 * - aucune conversion de quantité n'est faite ici ;
 * - cette fonction ne fait qu'une correspondance d'unité ;
 * - les conversions quantitatives restent de la responsabilité
 *   du Matcher.
 *
 * Exemple :
 *
 *   "g"       -> "Gramme"
 *   "kg"      -> "Kilogramme"
 *   "ml"      -> "Millilitre"
 *   "pièces"  -> "Pièce"
 *   "tranches"-> "Tranche"
 *   "morceaux"-> "Morceau"
 */
function getDatabaseUnit(
  unit: string,
  unitMappings: UnitMapping[]
): string {
  const wanted = String(unit ?? '').trim()

  if (!wanted) {
    throw new Error(
      'Unité vide : impossible de créer un article de courses.'
    )
  }

  const wantedKey = normalizeUnit(wanted)

  /*
   * Variantes rencontrées dans Cookiwiki.
   *
   * On ne met ici que des équivalences linguistiques.
   * La quantité n'est jamais modifiée.
   */
  const aliases: Record<string, string> = {
    // ---------------------------------------------------------
    // UNITÉS GÉNÉRIQUES
    // ---------------------------------------------------------

    piece: 'Pièce',
    pieces: 'Pièce',

    unite: 'Pièce',
    unites: 'Pièce',

    // ---------------------------------------------------------
    // GOUSSE
    // ---------------------------------------------------------

    gousse: 'Gousse',
    gousses: 'Gousse',

    // ---------------------------------------------------------
    // BRIN
    // ---------------------------------------------------------

    brin: 'Brin',
    brins: 'Brin',

    /*
     * Cookiwiki utilise parfois "branche" pour les herbes.
     * On conserve ici le comportement actuel du moteur :
     * branche(s) -> Brin.
     */
    branche: 'Brin',
    branches: 'Brin',

    // ---------------------------------------------------------
    // FEUILLE
    // ---------------------------------------------------------

    feuille: 'Feuille',
    feuilles: 'Feuille',

    // ---------------------------------------------------------
    // TRANCHE
    // ---------------------------------------------------------

    tranche: 'Tranche',
    tranches: 'Tranche',

    // ---------------------------------------------------------
    // PAVÉ
    // ---------------------------------------------------------

    pave: 'Pavé',
    paves: 'Pavé',

    // ---------------------------------------------------------
    // FILET
    // ---------------------------------------------------------

    filet: 'Filet',
    filets: 'Filet',

    // ---------------------------------------------------------
    // BOTTE
    // ---------------------------------------------------------

    botte: 'Botte',
    bottes: 'Botte',

    // ---------------------------------------------------------
    // SACHET
    // ---------------------------------------------------------

    sachet: 'Sachet',
    sachets: 'Sachet',

    // ---------------------------------------------------------
    // POT
    // ---------------------------------------------------------

    pot: 'Pot',
    pots: 'Pot',

    // ---------------------------------------------------------
    // BOÎTE
    // ---------------------------------------------------------

    boite: 'Boîte',
    boites: 'Boîte',

    // ---------------------------------------------------------
    // BRIQUE
    // ---------------------------------------------------------

    brique: 'Brique',
    briques: 'Brique',

    // ---------------------------------------------------------
    // BARQUETTE
    // ---------------------------------------------------------

    barquette: 'Barquette',
    barquettes: 'Barquette',

    // ---------------------------------------------------------
    // CUBE
    // ---------------------------------------------------------

    cube: 'Cube',
    cubes: 'Cube',

    // ---------------------------------------------------------
    // ROULEAU
    // ---------------------------------------------------------

    rouleau: 'Rouleau',
    rouleaux: 'Rouleau',

    // ---------------------------------------------------------
    // MORCEAU
    // ---------------------------------------------------------

    morceau: 'Morceau',
    morceaux: 'Morceau',

    // ---------------------------------------------------------
    // ZESTE
    // ---------------------------------------------------------

    zeste: 'Zeste',
    zestes: 'Zeste',

    // ---------------------------------------------------------
    // NOIX
    // ---------------------------------------------------------

    noix: 'Noix (de beurre)',

    // ---------------------------------------------------------
    // POINTE
    // ---------------------------------------------------------

    pointedecouteau: 'Pointe (de couteau)',

    // ---------------------------------------------------------
    // PINCÉE
    // ---------------------------------------------------------

    pincee: 'Pincée',
    pincees: 'Pincée',

    // ---------------------------------------------------------
    // MILLIGRAMME
    // ---------------------------------------------------------

    mg: 'Milligramme',
    milligramme: 'Milligramme',
    milligrammes: 'Milligramme',

    // ---------------------------------------------------------
    // GRAMME
    // ---------------------------------------------------------

    g: 'Gramme',
    gramme: 'Gramme',
    grammes: 'Gramme',

    // ---------------------------------------------------------
    // KILOGRAMME
    // ---------------------------------------------------------

    kg: 'Kilogramme',
    kilogramme: 'Kilogramme',
    kilogrammes: 'Kilogramme',

    // ---------------------------------------------------------
    // MILLILITRE
    // ---------------------------------------------------------

    ml: 'Millilitre',
    millilitre: 'Millilitre',
    millilitres: 'Millilitre',

    // ---------------------------------------------------------
    // CENTILITRE
    // ---------------------------------------------------------

    cl: 'Centilitre',
    centilitre: 'Centilitre',
    centilitres: 'Centilitre',

    // ---------------------------------------------------------
    // DÉCILITRE
    // ---------------------------------------------------------

    dl: 'Décilitre',
    decilitre: 'Décilitre',
    decilitres: 'Décilitre',

    // ---------------------------------------------------------
    // LITRE
    // ---------------------------------------------------------

    l: 'Litre',
    litre: 'Litre',
    litres: 'Litre',

    // ---------------------------------------------------------
    // CUILLÈRE À CAFÉ
    // ---------------------------------------------------------

    cac: 'Cuillère à café',
    cc: 'Cuillère à café',

    // ---------------------------------------------------------
    // CUILLÈRE À SOUPE
    // ---------------------------------------------------------

    cas: 'Cuillère à soupe',
    cs: 'Cuillère à soupe',

    // ---------------------------------------------------------
    // CUILLÈRE À DESSERT
    // ---------------------------------------------------------

    'cudessert': 'Cuillère à dessert',

    // ---------------------------------------------------------
    // VERRE
    // ---------------------------------------------------------

    verre: 'Verre (à moutarde/eau)',

    // ---------------------------------------------------------
    // TASSE
    // ---------------------------------------------------------

    tasse: 'Tasse',

    // ---------------------------------------------------------
    // BOL
    // ---------------------------------------------------------

    bol: 'Bol',

    // ---------------------------------------------------------
    // MUG
    // ---------------------------------------------------------

    mug: 'Mug',

    // ---------------------------------------------------------
    // RAMEQUIN
    // ---------------------------------------------------------

    ramequin: 'Ramequin',

    // ---------------------------------------------------------
    // PAQUET
    // ---------------------------------------------------------

    paquet: 'Paquet',
    paquets: 'Paquet',

    // ---------------------------------------------------------
    // BOUTEILLE
    // ---------------------------------------------------------

    bouteille: 'Bouteille',
    bouteilles: 'Bouteille',
  }

  /*
   * 1. Recherche d'un alias connu.
   *
   * Exemple :
   *   pieces -> Pièce
   *   morceaux -> Morceau
   *   rouleaux -> Rouleau
   */
  const canonicalWanted = aliases[wantedKey] ?? wanted

  const canonicalKey = normalizeUnit(canonicalWanted)

  /*
   * 2. Recherche sur le nom canonique.
   */
  let mapping = unitMappings.find(
    candidate =>
      normalizeUnit(candidate.unite) === canonicalKey
  )

  /*
   * 3. Recherche sur l'abréviation.
   *
   * Exemple :
   *   wanted = "g"
   *   abreviation = "g"
   *
   *   wanted = "ml"
   *   abreviation = "mL"
   */
  if (!mapping) {
    mapping = unitMappings.find(candidate => {
      const abbreviationKey = normalizeUnit(
        candidate.abreviation ?? ''
      )

      return (
        abbreviationKey !== '' &&
        abbreviationKey === wantedKey
      )
    })
  }

  /*
   * 4. Dernier recours :
   *    recherche directe sur l'unité fournie.
   */
  if (!mapping) {
    mapping = unitMappings.find(
      candidate =>
        normalizeUnit(candidate.unite) === wantedKey
    )
  }

  /*
   * 5. Aucun mapping.
   */
  if (!mapping?.unite) {
    throw new Error(
      `Unité "${wanted}" absente de unit_mappings : cet article ne peut pas être créé tant que l’unité n’est pas référencée.`
    )
  }

  return mapping.unite
}

async function logGenerationIssue(issue: Omit<GenerationIssue, 'status'>): Promise<GenerationIssue> {
  const row = {
    list_id: issue.list_id,
    recipe_id: issue.recipe_id,
    recipe_nom: issue.recipe_nom,
    shopping_item_id: issue.shopping_item_id ?? null,
    produit: issue.produit,
    unit: issue.unit,
    issue_type: issue.issue_type,
    phase: issue.phase,
    message: issue.message,
    resolution_hint: issue.resolution_hint,
    status: 'open',
  }

  const { data, error } = await mealioDb
    .from('shopping_issues')
    .insert(row)
    .select('id,list_id,shopping_item_id,recipe_id,recipe_nom,produit,unit,issue_type,message,resolution_hint,status')
    .single()

  if (error || !data) {
    console.error('⚠️ Impossible d’enregistrer le problème de génération :', error?.message)
    return { ...row, status: 'open' }
  }

  return data as GenerationIssue
}

async function closePreviousGenerationIssues(listId: string): Promise<void> {
  const { error } = await mealioDb
    .from('shopping_issues')
    .update({ status: 'resolved', resolved_at: new Date().toISOString() })
    .eq('list_id', listId)
    .eq('phase', 'generation')
    .eq('status', 'open')

  if (error) {
    console.warn('⚠️ Impossible de clôturer les anciens avertissements de génération :', error.message)
  }
}

async function findOrCreateWeeklyList(
  username: string,
  dateStart: string,
  dateEnd: string,
  listName: string
): Promise<{ id: string; wasCreated: boolean }> {
  /*
   * RÈGLE MÉTIER : un foyer ne possède qu'une seule liste active.
   *
   * On réutilise d'abord une liste active correspondant à la période.
   * S'il existe déjà une autre liste active, on la réutilise également et
   * met à jour sa période. La migration Phase 15 nettoie les anciennes
   * doublons et pose ensuite un index unique qui empêche leur réapparition.
   */
  const { data: activeLists, error: activeError } = await mealioDb
    .from('shopping_lists')
    .select('id,created_at,period_start,period_end,name')
    .eq('user_id', username)
    .eq('status', 'en_cours')
    .order('created_at', { ascending: false })
    .limit(20)

  if (activeError) {
    throw new Error(`Erreur recherche shopping_lists : ${activeError.message}`)
  }

  const exact = (activeLists ?? []).find(
    list => list.period_start === dateStart && list.period_end === dateEnd
  )

  if (exact) {
    return { id: exact.id, wasCreated: false }
  }

  const latest = activeLists?.[0]

  if (latest) {
    const { data: updated, error: updateError } = await mealioDb
      .from('shopping_lists')
      .update({
        name: listName,
        period_start: dateStart,
        period_end: dateEnd,
      })
      .eq('id', latest.id)
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .select('id')
      .single()

    if (updateError || !updated) {
      throw new Error(
        `Erreur mise à jour de la liste active : ${updateError?.message ?? 'liste introuvable.'}`
      )
    }

    return { id: updated.id, wasCreated: false }
  }

  const { data: created, error: createError } = await mealioDb
    .from('shopping_lists')
    .insert({
      user_id: username,
      name: listName,
      status: 'en_cours',
      period_start: dateStart,
      period_end: dateEnd,
    })
    .select('id')
    .single()

  if (createError || !created) {
    if (createError?.code === '23505') {
      const { data: concurrentList, error: concurrentError } = await mealioDb
        .from('shopping_lists')
        .select('id')
        .eq('user_id', username)
        .eq('status', 'en_cours')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (concurrentError || !concurrentList) {
        throw new Error(
          `Collision création shopping_lists, récupération impossible : ${concurrentError?.message ?? 'liste introuvable.'}`
        )
      }

      return { id: concurrentList.id, wasCreated: false }
    }

    throw new Error(
      `Erreur création shopping_lists : ${createError?.message ?? 'Liste non créée.'}`
    )
  }

  return { id: created.id, wasCreated: true }
}

export async function generateShoppingListForPeriod(
  userId: string,
  username: string,
  dateStart: string,
  dateEnd: string,
  listName: string
): Promise<GenerateShoppingListResult> {
  /*
   * userId est conservé dans la signature pour ne pas casser
   * les appels existants.
   *
   * Pour les tables Mealio, l'identifiant réellement utilisé
   * est username.
   */

  const mealioUserId = username.trim()

  if (!mealioUserId) {
    throw new Error(
      'Username Mealio introuvable.'
    )
  }

  /*
   * -----------------------------------------------------------
   * 1. RÉCUPÉRATION DES REPAS PLANIFIÉS
   * -----------------------------------------------------------
   *
   * IMPORTANT :
   * meal_plans.user_id contient "KH", pas l'UUID Frosti.
   */

  const {
    data: mealPlans,
    error: mpError,
  } = await mealioDb
    .from('meal_plans')
    .select('*')
    .eq('user_id', mealioUserId)
    .gte('scheduled_date', dateStart)
    .lte('scheduled_date', dateEnd)
    .order('scheduled_date', {
      ascending: true,
    })

  if (mpError) {
    throw new Error(
      `Erreur lecture meal_plans : ${mpError.message}`
    )
  }

  /*
   * -----------------------------------------------------------
   * 2. CRÉATION OU RÉCUPÉRATION DE LA LISTE
   * -----------------------------------------------------------
   */

  const {
    id: listId,
    wasCreated,
  } = await findOrCreateWeeklyList(
    mealioUserId,
    dateStart,
    dateEnd,
    listName
  )

  await closePreviousGenerationIssues(listId)
  const generationIssues: GenerationIssue[] = []

  /*
   * -----------------------------------------------------------
   * 3. AUCUN REPAS PLANIFIÉ
   * -----------------------------------------------------------
   */

  if (!mealPlans || mealPlans.length === 0) {
    return {
      listId,
      itemCount: 0,
      wasCreated,
      issueCount: generationIssues.length,
      issues: generationIssues,
      message:
        'Aucune recette planifiée sur cette période — liste inchangée.',
    }
  }

  /*
   * -----------------------------------------------------------
   * 4. CACHE RECETTES COOKIWIKI
   * -----------------------------------------------------------
   *
   * Une même recette peut être planifiée plusieurs fois.
   * On ne la recharge donc qu'une seule fois.
   */

  const recipeCache =
    new Map<string, RecipeDetails>()

  async function getCachedRecipe(
    recipeId: string
  ): Promise<RecipeDetails> {
    if (!recipeCache.has(recipeId)) {
      const recipe =
        await getRecipeDetailsFromCookiwiki(
          recipeId
        )

      recipeCache.set(
        recipeId,
        recipe
      )
    }

    return recipeCache.get(recipeId)!
  }

  /*
   * -----------------------------------------------------------
   * 5. CHARGEMENT DES DONNÉES DE RÉFÉRENCE
   * -----------------------------------------------------------
   */

  const refData =
    await loadReferenceData()

  /*
   * -----------------------------------------------------------
   * 6. RÉSOLUTION DES INGRÉDIENTS
   * -----------------------------------------------------------
   */

  const resolvedLists:
    ResolvedIngredient[][] = []

  for (const plan of mealPlans) {
    try {
      const recipe = await getCachedRecipe(plan.recipe_id)

      const baseServings = recipe.baseServings || 4
      const requestedServings = plan.servings || baseServings
      const servingsRatio = requestedServings / baseServings

      const resolved = await resolveRecipeIngredients(
        recipe.ingredients,
        refData,
        plan.recipe_id,
        recipe.nom,
        servingsRatio
      )

      resolvedLists.push(resolved)
    } catch (error) {
      const issue = await logGenerationIssue({
        list_id: listId,
        recipe_id: plan.recipe_id,
        recipe_nom: null,
        produit: 'Recette',
        unit: null,
        issue_type: 'RECIPE_PROCESSING_ERROR',
        phase: 'generation',
        message: error instanceof Error ? error.message : 'Erreur inconnue lors de l’analyse de la recette.',
        resolution_hint: 'Vérifier uniquement la recette ou la donnée de référence indiquée, puis relancer la génération. Les autres recettes et articles valides sont conservés.',
      })
      generationIssues.push(issue)
      console.error(`⚠️ Recette ${plan.recipe_id} ignorée :`, error)
    }
  }

  /*
   * -----------------------------------------------------------
   * 7. AGRÉGATION DES BESOINS
   * -----------------------------------------------------------
   */

  const aggregated =
    aggregateRequirements(
      resolvedLists
    )

  /*
   * -----------------------------------------------------------
   * 8. LECTURE DU STOCK DU FOYER
   * -----------------------------------------------------------
   *
   * username est volontairement utilisé.
   * stock-fetcher retrouve Frosti + Cellio à partir
   * du username du foyer.
   */

  const householdStock =
    await getHouseholdStock(
      username
    )

  /*
   * -----------------------------------------------------------
   * 9. COMPARAISON BESOINS / STOCK
   * -----------------------------------------------------------
   */

  const compared =
    await compareToStock(
      aggregated,
      householdStock.items,
      refData
    )

  /*
   * -----------------------------------------------------------
   * 10. NORMALISATION DES UNITÉS
   * -----------------------------------------------------------
   *
   * On effectue cette opération AVANT de supprimer les
   * anciens articles.
   *
   * Ainsi, une unité inconnue provoque une erreur sans
   * vider la liste existante.
   */

  const comparedForInsert: Array<any> = []

  for (const item of compared.filter(item => item.ai_status !== 'green')) {
    try {
      const unite_db = getDatabaseUnit(item.unite, refData.unitMappings as UnitMapping[])
      comparedForInsert.push({ ...item, unite_db })
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unité \"${item.unite}\" inconnue.`
      const issue = await logGenerationIssue({
        list_id: listId,
        recipe_id: item.contributions?.[0]?.recipe_id ?? null,
        recipe_nom: item.contributions?.[0]?.recipe_nom ?? null,
        produit: item.produit,
        unit: item.unite,
        issue_type: 'UNIT_MAPPING_MISSING',
        phase: 'generation',
        message,
        resolution_hint: `Dans Supabase Mealio → table unit_mappings, créer l’unité canonique \"${item.unite}\". Pour une unité de comptage comme Bouteille, utiliser généralement type_unite = \"unité\" et multiplicateur = 1, puis relancer la génération. Vérifier les colonnes de ta table avant insertion.`,
      })
      generationIssues.push(issue)
      console.warn(`⚠️ Article ignoré mais génération poursuivie : ${item.produit} — ${message}`)
    }
  }

  /*
   * -----------------------------------------------------------
   * 11. RÉCONCILIATION DES ARTICLES EXISTANTS
   * -----------------------------------------------------------
   *
   * Une génération ne doit jamais créer une deuxième ligne pour le même
   * ingrédient. Les anciennes versions conservaient les lignes cochées puis
   * inséraient une nouvelle ligne, ce qui a produit les doublons observés
   * (deux Carottes, deux Cocos, deux Oignons, etc.).
   *
   * On réutilise donc une ligne existante avant d'en créer une nouvelle.
   * La quantité réellement achetée n'est jamais remise à zéro.
   */

  const { data: existingItems, error: existingItemsError } = await mealioDb
    .from('shopping_items')
    .select('id,produit,ingredient_id,qte,qte_achat,qte_achetee,stock_stored_quantity,unite,is_checked,is_manual,ai_status,updated_at')
    .eq('list_id', listId)

  if (existingItemsError) {
    throw new Error(`Erreur lecture des articles existants : ${existingItemsError.message}`)
  }

  const normalizeProduct = (value: string | null | undefined): string =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')

  const itemKey = (item: { ingredient_id?: string | null; produit?: string | null; unite?: string | null }) => {
    const ingredientKey = item.ingredient_id?.trim()
    const productKey = ingredientKey || normalizeProduct(item.produit)
    return `${productKey}::${normalizeUnit(item.unite)}`
  }

  const existing = (existingItems ?? []) as Array<{
    id: string
    produit: string
    ingredient_id: string | null
    qte: number | null
    qte_achat: number | null
    qte_achetee: number | null
    stock_stored_quantity: number | null
    unite: string | null
    is_checked: boolean | null
    is_manual: boolean | null
    ai_status: string | null
  }>

  const byKey = new Map<string, typeof existing[number][]>()
  for (const row of existing) {
    const key = itemKey(row)
    const bucket = byKey.get(key) ?? []
    bucket.push(row)
    byKey.set(key, bucket)
  }

  const usedExistingIds = new Set<string>()
  let itemCount = 0

  for (const item of comparedForInsert) {
    try {
    const key = itemKey({
      ingredient_id: item.ingredient_id,
      produit: item.produit,
      unite: item.unite_db,
    })

    const candidates = byKey.get(key) ?? []
    const candidate = candidates.find(row => !usedExistingIds.has(row.id))

    let shoppingItemId: string

    if (candidate) {
      shoppingItemId = candidate.id
      usedExistingIds.add(candidate.id)

      if (!candidate.is_manual) {
        const { error: updateError } = await mealioDb
          .from('shopping_items')
          .update({
            produit: item.produit,
            ingredient_id: item.ingredient_id,
            qte: item.qte_a_acheter,
            qte_achat: Math.max(Number(candidate.qte_achat ?? 0), item.qte_a_acheter),
            ai_status: item.ai_status,
            is_checked: candidate.is_checked ?? false,
          })
          .eq('id', candidate.id)

        if (updateError) {
          throw new Error(`Impossible de mettre à jour "${item.produit}" : ${updateError.message}`)
        }
      } else if (!candidate.ingredient_id && item.ingredient_id) {
        // Un article manuel déjà présent peut être relié à l'ingrédient
        // officiel trouvé par le moteur sans perdre son statut manuel.
        const { error: manualLinkError } = await mealioDb
          .from('shopping_items')
          .update({ ingredient_id: item.ingredient_id })
          .eq('id', candidate.id)

        if (manualLinkError) {
          throw new Error(`Impossible d'associer l'article manuel "${item.produit}" : ${manualLinkError.message}`)
        }
      }
    } else {
      const { data: shoppingItem, error: itemError } = await mealioDb
        .from('shopping_items')
        .insert({
          list_id: listId,
          produit: item.produit,
          ingredient_id: item.ingredient_id,
          qte: item.qte_a_acheter,
          qte_achat: item.qte_a_acheter,
          qte_achetee: 0,
          stock_stored_quantity: 0,
          unite: item.unite_db,
          ai_status: item.ai_status,
          is_checked: false,
          is_manual: false,
        })
        .select('id')
        .single()

      if (itemError || !shoppingItem) {
        throw new Error(
          `Impossible d'ajouter "${item.produit}" à la liste de courses : ${itemError?.message ?? 'article non créé.'}`
        )
      }

      shoppingItemId = shoppingItem.id
      usedExistingIds.add(shoppingItemId)
    }

    /*
     * Restitution utilisateur : si le Matcher a trouvé du stock mais qu'une
     * ou plusieurs lignes ne peuvent pas être converties dans l'unité du
     * besoin, on conserve une explication directement rattachée à l'article.
     *
     * On ne signale ce point que lorsqu'il peut réellement modifier la
     * quantité à acheter. Un stock non convertible mais déjà suffisant ne
     * doit pas polluer la liste de courses.
     */
    const unconvertibleStock = (item.stock_details ?? []).filter(
      detail => detail.qte_convertie === null
    )

    // Une impossibilité de conversion possède déjà un message dédié plus
    // précis ci-dessous. On n'enregistre donc pas le message générique
    // stock_match_review dans ce cas, afin d'éviter deux alertes identiques.
    if (item.stock_match_review && unconvertibleStock.length === 0) {
      const issue = await logGenerationIssue({
        list_id: listId,
        recipe_id: item.contributions?.[0]?.recipe_id ?? null,
        recipe_nom: item.contributions?.[0]?.recipe_nom ?? null,
        shopping_item_id: shoppingItemId,
        produit: item.produit,
        unit: item.unite,
        issue_type: 'STOCK_MATCH_REVIEW',
        phase: 'generation',
        message: item.stock_match_review,
        resolution_hint: 'Si cette correspondance est correcte, aucune action n’est nécessaire. Sinon, corriger le rapprochement dans le Matcher afin que Mealio l’apprenne pour les prochaines courses.',
      })
      generationIssues.push(issue)
    }

    if (
      item.qte_a_acheter > 0 &&
      unconvertibleStock.length > 0
    ) {
      const details = unconvertibleStock
        .slice(0, 3)
        .map(detail => `${detail.produit} · ${detail.qte_stock} ${detail.unite_stock}`)
        .join(', ')

      const extraCount = Math.max(0, unconvertibleStock.length - 3)
      const detailText = extraCount > 0
        ? `${details} et ${extraCount} autre(s)`
        : details

      const issue = await logGenerationIssue({
        list_id: listId,
        recipe_id: item.contributions?.[0]?.recipe_id ?? null,
        recipe_nom: item.contributions?.[0]?.recipe_nom ?? null,
        shopping_item_id: shoppingItemId,
        produit: item.produit,
        unit: item.unite,
        issue_type: 'STOCK_CONVERSION_MISSING',
        phase: 'generation',
        message: `Mealio a trouvé du stock (${detailText}), mais ne peut pas convertir cette quantité en ${item.unite}. Seule la partie convertible est prise en compte dans le calcul des courses.`,
        resolution_hint: `Vérifier l'équivalence de cette unité pour "${item.produit}" dans les données de référence Mealio. Tant qu'elle n'est pas connue, la quantité non convertible n'est pas déduite des courses.`,
      })
      generationIssues.push(issue)
    }

    // Les associations automatiques de recettes sont recalculées pour cette
    // ligne afin d'éviter qu'une régénération laisse des liens obsolètes.
    if (!candidate?.is_manual) {
      const { error: deleteLinksError } = await mealioDb
        .from('shopping_item_recipes')
        .delete()
        .eq('shopping_item_id', shoppingItemId)

      if (deleteLinksError) {
        throw new Error(`Impossible de réinitialiser les recettes de "${item.produit}" : ${deleteLinksError.message}`)
      }
    }

    const recipeRows = item.contributions.map(contribution => ({
      shopping_item_id: shoppingItemId,
      recipe_id: contribution.recipe_id,
      recipe_nom: contribution.recipe_nom,
      qte_contribuee: contribution.qte_contribuee,
    }))

    if (recipeRows.length > 0) {
      const { error: linkError } = await mealioDb
        .from('shopping_item_recipes')
        .insert(recipeRows)

      if (linkError) {
        throw new Error(`Impossible d'enregistrer les recettes de "${item.produit}" : ${linkError.message}`)
      }
    }

      itemCount++
    } catch (error) {
      const issue = await logGenerationIssue({
        list_id: listId,
        recipe_id: item.contributions?.[0]?.recipe_id ?? null,
        recipe_nom: item.contributions?.[0]?.recipe_nom ?? null,
        produit: item.produit,
        unit: item.unite,
        issue_type: 'GENERATION_ITEM_ERROR',
        phase: 'generation',
        message: error instanceof Error ? error.message : 'Erreur inconnue lors de la création de l’article.',
        resolution_hint: 'Corriger le problème indiqué puis relancer la génération. Les autres articles ont été conservés.',
      })
      generationIssues.push(issue)
      console.error(`⚠️ Article ignoré mais génération poursuivie : ${item.produit}`, error)
    }
  }

  // Les anciens articles automatiques qui ne font plus partie du besoin et
  // qui n'ont encore rien été acheté/rangé peuvent être supprimés.
  const obsoleteIds = generationIssues.length === 0
    ? existing
    .filter(row => !usedExistingIds.has(row.id))
    .filter(row => !row.is_manual)
    .filter(row => Number(row.qte_achetee ?? 0) <= 0)
    .filter(row => Number(row.stock_stored_quantity ?? 0) <= 0)
    .map(row => row.id)
    : []

  if (obsoleteIds.length > 0) {
    const { error: deleteError } = await mealioDb
      .from('shopping_items')
      .delete()
      .in('id', obsoleteIds)

    if (deleteError) {
      throw new Error(`Erreur suppression des anciens articles : ${deleteError.message}`)
    }
  }

  /*
   * -----------------------------------------------------------
   * 14. RÉSULTAT
   * -----------------------------------------------------------
   */

  return {
    listId,
    itemCount,
    wasCreated,
    issueCount: generationIssues.length,
    issues: generationIssues,
    message: `${wasCreated ? `Nouvelle liste créée avec ${itemCount} article(s) à acheter.` : `Liste mise à jour : ${itemCount} article(s) à acheter.`}${generationIssues.length > 0 ? ` ${generationIssues.length} problème(s) non bloquant(s) ont été enregistré(s) et sont affichés dans Courses.` : ''}`,
  }
}