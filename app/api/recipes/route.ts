import { NextResponse } from 'next/server'
import { cookiwikiServerDb } from '../../lib/supabase-server'

type CookiwikiIngredient = {
  qty?: number | string | null
  name?: string | null
  unit?: string | null
  [key: string]: unknown
}

type CookiwikiRecipe = {
  id: string
  title: string
  servings: number | null
  image_url: string | null
  description: string | null
  prep_time: number | null
  cook_time: number | null
  difficulty: string | null
  tags: string[] | null
  ingredients: CookiwikiIngredient[] | null
}

export async function GET() {
  try {
    const { data, error } = await cookiwikiServerDb
      .from('recipes')
      .select(
        `
          id,
          title,
          servings,
          image_url,
          description,
          prep_time,
          cook_time,
          difficulty,
          tags,
          ingredients
        `
      )
      .order('title', { ascending: true })

    if (error) {
      console.error(
        '❌ Erreur GET /api/recipes :',
        error
      )

      return NextResponse.json(
        {
          error:
            `Impossible de récupérer les recettes Cookiwiki : ${error.message}`,
        },
        { status: 500 }
      )
    }

    const recipes = ((data ?? []) as CookiwikiRecipe[]).map(
      (recipe: CookiwikiRecipe) => ({
        id: recipe.id,
        nom: recipe.title,
        title: recipe.title,
        servings: Number(recipe.servings ?? 4),
        image_url: recipe.image_url ?? null,
        description: recipe.description ?? null,
        prep_time: Number(recipe.prep_time ?? 0),
        cook_time: Number(recipe.cook_time ?? 0),
        difficulty: recipe.difficulty ?? null,
        tags: recipe.tags ?? [],
        ingredients: recipe.ingredients ?? [],
      })
    )

    return NextResponse.json({
      recipes,
      total: recipes.length,
    })
  } catch (error) {
    console.error(
      '❌ Erreur inattendue GET /api/recipes :',
      error
    )

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Erreur interne.',
      },
      { status: 500 }
    )
  }
}