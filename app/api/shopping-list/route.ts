import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { mealioServerDb } from '../../lib/supabase-server'

type ShoppingItemRow = {
  id: string
  list_id: string
  produit: string
  ingredient_id: string | null
  qte: number | null
  qte_achat: number | null
  qte_achetee: number | null
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
  const cookieStore = await cookies()

  return (
    cookieStore
      .get('congelo_username')
      ?.value
      ?.trim() || null
  )
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
      })
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
          produit,
          ingredient_id,
          qte,
          qte_achat,
          qte_achetee,
          unite,
          is_checked,
          is_manual,
          ai_status,
          official_ingredients (
            rayon
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

    const itemsRows =
      (rawItems ??
        []) as ShoppingItemRow[]

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

const rayon =
  item.official_ingredients?.[0]?.rayon?.trim() ||
  null

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
      items.filter(
        item =>
          item.is_checked
      ).length

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