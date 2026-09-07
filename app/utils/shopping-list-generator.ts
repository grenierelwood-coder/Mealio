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
  message: string
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
      `Unité "${wanted}" absente de unit_mappings : impossible de créer l'article de courses.`
    )
  }

  return mapping.unite
}

async function findOrCreateWeeklyList(
  username: string,
  dateStart: string,
  dateEnd: string,
  listName: string
): Promise<{ id: string; wasCreated: boolean }> {
  /*
   * Les tables Mealio utilisent le username comme identifiant
   * de foyer :
   *
   *   meal_plans.user_id = "KH"
   *   shopping_lists.user_id = "KH"
   *
   * Le congelo_user_id est un UUID propre à Frosti et ne doit
   * pas être utilisé pour les tables Mealio.
   */

  const { data: existing, error: existingError } =
    await mealioDb
      .from('shopping_lists')
      .select('id')
      .eq('user_id', username)
      .eq('period_start', dateStart)
      .eq('period_end', dateEnd)
      .eq('status', 'en_cours')
      .maybeSingle()

  if (existingError) {
    throw new Error(
      `Erreur recherche shopping_lists : ${existingError.message}`
    )
  }

  if (existing) {
    return {
      id: existing.id,
      wasCreated: false,
    }
  }

  const { data: created, error: createError } =
    await mealioDb
      .from('shopping_lists')
      .insert({
        user_id: username,
        name: listName,
        status: 'en_cours',
        period_start: dateStart,
        period_end: dateEnd,
      })
      .select()
      .single()

  if (createError || !created) {
    throw new Error(
      `Erreur création shopping_lists : ${
        createError?.message ?? 'Liste non créée.'
      }`
    )
  }

  return {
    id: created.id,
    wasCreated: true,
  }
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
    const recipe =
      await getCachedRecipe(
        plan.recipe_id
      )

    const baseServings =
      recipe.baseServings || 4

    const requestedServings =
      plan.servings || baseServings

    const servingsRatio =
      requestedServings /
      baseServings

    const resolved =
      await resolveRecipeIngredients(
        recipe.ingredients,
        refData,
        plan.recipe_id,
        recipe.nom,
        servingsRatio
      )

    resolvedLists.push(
      resolved
    )
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

  const comparedForInsert = compared
    .filter(
      item => item.ai_status !== 'green'
    )
    .map(item => ({
      ...item,
      unite_db: getDatabaseUnit(
        item.unite,
        refData.unitMappings as UnitMapping[]
      ),
    }))

  /*
   * -----------------------------------------------------------
   * 11. SUPPRESSION DES ANCIENS ARTICLES AUTOMATIQUES
   * -----------------------------------------------------------
   *
   * On conserve :
   *   - les articles manuels
   *   - les articles déjà cochés
   *
   * On supprime uniquement les articles automatiques
   * encore non cochés.
   */

  const {
    data: staleItems,
    error: staleError,
  } = await mealioDb
    .from('shopping_items')
    .select('id')
    .eq('list_id', listId)
    .eq('is_manual', false)
    .eq('is_checked', false)

  if (staleError) {
    throw new Error(
      `Erreur lecture des anciens articles : ${staleError.message}`
    )
  }

  if (
    staleItems &&
    staleItems.length > 0
  ) {
    const staleIds =
      staleItems.map(
        item => item.id
      )

    const {
      error: deleteError,
    } = await mealioDb
      .from('shopping_items')
      .delete()
      .in(
        'id',
        staleIds
      )

    if (deleteError) {
      throw new Error(
        `Erreur suppression des anciens articles : ${deleteError.message}`
      )
    }
  }

  /*
   * -----------------------------------------------------------
   * 12. CRÉATION DES NOUVEAUX ARTICLES
   * -----------------------------------------------------------
   *
   * Les ingrédients suffisamment présents en stock
   * (green) ont déjà été exclus.
   *
   * Une erreur d'insertion provoque volontairement une
   * exception afin que l'API retourne HTTP 500.
   *
   * On ne veut surtout pas afficher "liste générée"
   * alors qu'un ou plusieurs articles n'ont pas été créés.
   */

  let itemCount = 0

  for (const item of comparedForInsert) {
    const {
      data: shoppingItem,
      error: itemError,
    } = await mealioDb
      .from('shopping_items')
.insert({
  list_id: listId,
  produit: item.produit,
  ingredient_id:
    item.ingredient_id,
  qte: item.qte_a_acheter,
  qte_achat: item.qte_a_acheter,
  qte_achetee: 0,
  unite: item.unite_db,
  ai_status: item.ai_status,
  is_checked: false,
  is_manual: false,
})
      .select()
      .single()

    if (
      itemError ||
      !shoppingItem
    ) {
      console.error(
        `❌ Erreur insertion shopping_items pour "${item.produit}" :`,
        itemError
      )

      throw new Error(
        `Impossible d'ajouter "${item.produit}" à la liste de courses : ${
          itemError?.message ??
          'article non créé.'
        }`
      )
    }

    itemCount++

    /*
     * ---------------------------------------------------------
     * 13. ASSOCIATION AUX RECETTES
     * ---------------------------------------------------------
     */

    const recipeRows =
      item.contributions.map(
        contribution => ({
          shopping_item_id:
            shoppingItem.id,
          recipe_id:
            contribution.recipe_id,
          recipe_nom:
            contribution.recipe_nom,
          qte_contribuee:
            contribution.qte_contribuee,
        })
      )

    if (
      recipeRows.length > 0
    ) {
      const {
        error: linkError,
      } = await mealioDb
        .from(
          'shopping_item_recipes'
        )
        .insert(
          recipeRows
        )

      if (linkError) {
        console.error(
          `❌ Erreur insertion shopping_item_recipes pour "${item.produit}" :`,
          linkError
        )

        throw new Error(
          `Article "${item.produit}" créé, mais impossible d'enregistrer son association avec les recettes : ${linkError.message}`
        )
      }
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
    message: wasCreated
      ? `Nouvelle liste créée avec ${itemCount} article(s) à acheter.`
      : `Liste mise à jour : ${itemCount} article(s) à acheter (articles cochés/manuels préservés).`,
  }
}