import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import {
  getMealPlans,
  createMealPlan,
  updateMealPlan,
  deleteMealPlan,
} from '../../utils/meal-planner-server'

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
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  try {
    const plans = await getMealPlans(username)

    return NextResponse.json({
      username,
      plans,
      total: plans.length,
    })
  } catch (error) {
    console.error(
      '❌ Erreur GET /api/meal-plans :',
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

export async function POST(request: Request) {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()

    const plan = await createMealPlan(
      username,
      {
        recipe_id: body.recipe_id,
        scheduled_date: body.scheduled_date,
        meal_type: body.meal_type,
        role: body.role,
        servings: body.servings,
      }
    )

    return NextResponse.json(
      { plan },
      { status: 201 }
    )
  } catch (error) {
    console.error(
      '❌ Erreur POST /api/meal-plans :',
      error
    )

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Erreur interne.',
      },
      { status: 400 }
    )
  }
}

export async function PATCH(request: Request) {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json(
        {
          error:
            'Identifiant du repas planifié obligatoire.',
        },
        { status: 400 }
      )
    }

    const plan = await updateMealPlan(
      username,
      body.id,
      {
        recipe_id: body.recipe_id,
        scheduled_date: body.scheduled_date,
        meal_type: body.meal_type,
        role: body.role,
        servings: body.servings,
      }
    )

    return NextResponse.json({ plan })
  } catch (error) {
    console.error(
      '❌ Erreur PATCH /api/meal-plans :',
      error
    )

    const message =
      error instanceof Error
        ? error.message
        : 'Erreur interne.'

    const status =
      message.includes('introuvable')
        ? 404
        : 400

    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}

export async function DELETE(request: Request) {
  const username = await getUsername()

  if (!username) {
    return NextResponse.json(
      { error: 'Non authentifié.' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()

    if (!body.id) {
      return NextResponse.json(
        {
          error:
            'Identifiant du repas planifié obligatoire.',
        },
        { status: 400 }
      )
    }

    await deleteMealPlan(
      username,
      body.id
    )

    return NextResponse.json({
      success: true,
    })
  } catch (error) {
    console.error(
      '❌ Erreur DELETE /api/meal-plans :',
      error
    )

    const message =
      error instanceof Error
        ? error.message
        : 'Erreur interne.'

    const status =
      message.includes('introuvable')
        ? 404
        : 400

    return NextResponse.json(
      { error: message },
      { status }
    )
  }
}