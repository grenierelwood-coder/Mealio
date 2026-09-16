import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import { mealioServerDb } from '../../lib/supabase-server'
import { getQuantityMode } from '../../utils/quantity-policy'

type ShoppingItemRow = {
  id: string
  list_id: string
  updated_at: string | null
  produit: string
  ingredient_id: string | null
  qte: number | null
  qte_achat: number | null
  qte_achetee: number | null
  stock_stored_quantity: number | null
  unite: string | null
  is_checked: boolean
  is_manual: boolean
  ai_status:
    | 'green'
    | 'orange'
    | 'red'
    | 'recurrent'
    | null

official_ingredients:
  | {
      rayon: string | null
      categorie: string | null
      nom: string | null
    }[]
  | null
}

type RecipeLinkRow = {
  shopping_item_id: string
  recipe_id: string
  recipe_nom: string
  qte_contribuee: number | null
}

async function getUsername(): Promise<string | null> {
  const session = await getAuthSession()
  return session?.username?.trim() || null
}

export async function GET() {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      {
        error: 'Non authentifié.',
      },
      {
        status: 401,
      }
    )
  }

  try {
    /*
     * ----------------------------------------------------------------------
     * 1. RÉCUPÉRATION DE LA LISTE ACTIVE
     * ----------------------------------------------------------------------
     */

    const {
      data: list,
      error: listError,
    } = await mealioServerDb
      .from('shopping_lists')
      .select(
        `
          id,
          created_at,
          user_id,
          name,
          status,
          period_start,
          period_end
        `
      )
      .eq('user_id', username)
      .eq('status', 'en_cours')
      .order('created_at', {
        ascending: false,
      })
      .limit(1)
      .maybeSingle()

    if (listError) {
      console.error(
        '❌ Erreur récupération shopping_lists :',
        listError
      )

      return NextResponse.json(
        {
          error:
            `Impossible de récupérer la liste de courses : ${listError.message}`,
        },
        {
          status: 500,
        }
      )
    }

    /*
     * Aucune liste active.
     */

    if (!list) {
      return NextResponse.json({
        list: null,
        items: [],
        total: 0,
        checked: 0,
        unchecked: 0,
        issues: [],
      })
    }

    const { data: issueRows, error: issuesError } = await mealioServerDb
      .from('shopping_issues')
      .select('id,list_id,shopping_item_id,phase,issue_type,produit,unit,message,resolution_hint,status,created_at,resolved_at')
      .eq('list_id', list.id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })

    if (issuesError) {
      console.warn('⚠️ Impossible de charger les avertissements Courses :', issuesError.message)
    }

    /*
     * ----------------------------------------------------------------------
     * 2. ARTICLES DE LA LISTE
     *
     * On récupère également official_ingredients.rayon.
     *
     * C'est ici que le mode magasin pourra ensuite regrouper :
     *
     * Fruits & légumes
     * Crèmerie
     * Épicerie
     * etc.
     * ----------------------------------------------------------------------
     */

    const {
      data: rawItems,
      error: itemsError,
    } = await mealioServerDb
      .from('shopping_items')
      .select(
        `
          id,
          list_id,
          updated_at,
          produit,
          ingredient_id,
          qte,
          qte_achat,
          qte_achetee,
          stock_stored_quantity,
          unite,
          is_checked,
          is_manual,
          ai_status,
          official_ingredients (
            rayon,
            categorie,
            nom
          )
        `
      )
      .eq('list_id', list.id)
      .order('is_checked', {
        ascending: true,
      })
      .order('produit', {
        ascending: true,
      })

    if (itemsError) {
      console.error(
        '❌ Erreur récupération shopping_items :',
        itemsError
      )

      return NextResponse.json(
        {
          error:
            `Impossible de récupérer les articles : ${itemsError.message}`,
        },
        {
          status: 500,
        }
      )
    }

    let itemsRows =
      (rawItems ??
        []) as ShoppingItemRow[]

    /*
     * ----------------------------------------------------------------------
     * 2 bis. ARTICLES DÉJÀ ACHETÉS ET RANGÉS
     *
     * Un article sort de la liste active uniquement lorsque la quantité
     * réellement achetée est entièrement couverte par la quantité réellement
     * rangée dans Frosti/Cellio.
     *
     * is_checked n'est volontairement plus utilisé pour décider de la sortie
     * de liste : il reste un état d'interface / compatibilité historique.
     * ----------------------------------------------------------------------
     */

    if (itemsRows.length > 0) {
      const isCompleted = (item: ShoppingItemRow): boolean => {
        const required = Math.max(0, Number(item.qte ?? 0))
        const bought = Math.max(0, Number(item.qte_achetee ?? 0))
        const stored = Math.max(0, Number(item.stock_stored_quantity ?? 0))

        return required > 0 && bought >= required && stored >= bought
      }

      itemsRows = itemsRows.filter(item => !isCompleted(item))
    }

    /*
     * ----------------------------------------------------------------------
     * 3. RECETTES ASSOCIÉES
     * ----------------------------------------------------------------------
     */

    const itemIds =
      itemsRows.map(
        item => item.id
      )

    let recipeLinks: RecipeLinkRow[] =
      []

    if (itemIds.length > 0) {
      const {
        data: recipesData,
        error: recipesError,
      } = await mealioServerDb
        .from('shopping_item_recipes')
        .select(
          `
            shopping_item_id,
            recipe_id,
            recipe_nom,
            qte_contribuee
          `
        )
        .in(
          'shopping_item_id',
          itemIds
        )
        .order('recipe_nom', {
          ascending: true,
        })

      if (recipesError) {
        console.error(
          '❌ Erreur récupération shopping_item_recipes :',
          recipesError
        )

        return NextResponse.json(
          {
            error:
              `Impossible de récupérer les recettes associées : ${recipesError.message}`,
          },
          {
            status: 500,
          }
        )
      }

      recipeLinks =
        (recipesData ??
          []) as RecipeLinkRow[]
    }

    /*
     * ----------------------------------------------------------------------
     * 4. INDEX DES RECETTES
     *
     * On évite de faire une requête SQL par article.
     * ----------------------------------------------------------------------
     */

    const recipesByItem =
      new Map<
        string,
        RecipeLinkRow[]
      >()

    for (const link of recipeLinks) {
      const current =
        recipesByItem.get(
          link.shopping_item_id
        ) ?? []

      current.push(link)

      recipesByItem.set(
        link.shopping_item_id,
        current
      )
    }

    /*
     * ----------------------------------------------------------------------
     * 5. NORMALISATION POUR LE FRONT
     * ----------------------------------------------------------------------
     */

    const items = itemsRows.map(
      item => {
        /*
         * Supabase peut retourner l'objet relationnel directement.
         * On garde une sécurité supplémentaire au cas où il serait null.
         */

const relation = item.official_ingredients
        const official = Array.isArray(relation) ? relation[0] : relation
        const rayon = official?.rayon?.trim() || null
        const quantity_mode = getQuantityMode({
          nom: official?.nom ?? item.produit,
          categorie: official?.categorie ?? null,
        })

        const recipes =
          (
            recipesByItem.get(
              item.id
            ) ?? []
          ).map(
            recipe => ({
              recipe_id:
                recipe.recipe_id,
              recipe_nom:
                recipe.recipe_nom,
              qte_contribuee:
                recipe.qte_contribuee,
            })
          )

        return {
          id: item.id,
          list_id:
            item.list_id,
          produit:
            item.produit,
          ingredient_id:
            item.ingredient_id,

          /*
           * Besoin calculé.
           */
          qte:
            item.qte === null ||
            item.qte === undefined
              ? null
              : Number(item.qte),

          /*
           * Quantité choisie par l'utilisateur
           * pour l'achat.
           */
          qte_achat:
            item.qte_achat ===
              null ||
            item.qte_achat ===
              undefined
              ? item.qte === null ||
                item.qte ===
                  undefined
                ? 0
                : Number(item.qte)
              : Number(
                  item.qte_achat
                ),

          /*
           * Quantité réellement achetée.
           */
          stock_stored_quantity:
            item.stock_stored_quantity ===
              null ||
            item.stock_stored_quantity ===
              undefined
              ? 0
              : Number(
                  item.stock_stored_quantity
                ),

          qte_achetee:
            item.qte_achetee ===
              null ||
            item.qte_achetee ===
              undefined
              ? 0
              : Number(
                  item.qte_achetee
                ),

          unite:
            item.unite,

          quantity_mode,

          /*
           * Rayon de l'ingrédient officiel.
           */
          rayon,

          is_checked:
            Boolean(
              item.is_checked
            ),

          is_manual:
            Boolean(
              item.is_manual
            ),

          ai_status:
            item.ai_status,

          recipes,
        }
      }
    )

    /*
     * ----------------------------------------------------------------------
     * 6. COMPTEURS
     * ----------------------------------------------------------------------
     */

    const total =
      items.length

    const checked =
      items.filter(item => {
        const required = Math.max(0, Number(item.qte ?? 0))
        const bought = Math.max(0, Number(item.qte_achetee ?? 0))
        return required > 0 && bought >= required
      }).length

    const unchecked =
      total - checked

    /*
     * ----------------------------------------------------------------------
     * 7. RÉPONSE
     * ----------------------------------------------------------------------
     */

    return NextResponse.json({
      list,
      items,
      total,
      checked,
      unchecked,
      issues: issueRows ?? [],
    })
  } catch (error) {
    console.error(
      '❌ Erreur inattendue GET /api/shopping-list :',
      error
    )

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Erreur interne.',
      },
      {
        status: 500,
      }
    )
  }
}