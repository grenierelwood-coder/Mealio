import { NextResponse } from 'next/server'
import { mealioServerDb } from '../../../lib/supabase-server'

function text(value: unknown): string | null {
  const v = String(value ?? '').trim()
  return v ? v : null
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function loadAll() {
  const [ingredients, synonyms, units, densities] = await Promise.all([
    mealioServerDb
      .from('official_ingredients')
      .select('id,nom,categorie,rayon,default_storage,default_is_fridge')
      .order('nom', { ascending: true }),
    mealioServerDb
      .from('ingredient_synonyms')
      .select('mot_recette,ingredient_id')
      .order('mot_recette', { ascending: true }),
    mealioServerDb
      .from('unit_mappings')
      .select('unite,abreviation,type_unite,equivalence_reference,multiplicateur')
      .order('unite', { ascending: true }),
    mealioServerDb
      .from('ingredient_densities')
      .select('ingredient_id,unite,poids_g_approx')
      .order('unite', { ascending: true }),
  ])

  for (const result of [ingredients, synonyms, units, densities]) {
    if (result.error) throw new Error(result.error.message)
  }

  return {
    ingredients: ingredients.data ?? [],
    synonyms: synonyms.data ?? [],
    units: units.data ?? [],
    densities: densities.data ?? [],
  }
}

export async function GET() {
  try {
    return NextResponse.json(await loadAll())
  } catch (error) {
    console.error('GET /api/admin/ingredients', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const entity = text(body.entity)
    if (!entity) return NextResponse.json({ error: 'Type de donnée manquant.' }, { status: 400 })

    if (entity === 'ingredient') {
      const nom = text(body.nom)
      if (!nom) return NextResponse.json({ error: 'Le nom de l’ingrédient est obligatoire.' }, { status: 400 })
      const { data, error } = await mealioServerDb.from('official_ingredients').insert({
        nom,
        categorie: text(body.categorie),
        rayon: text(body.rayon),
        default_storage: body.default_storage === 'frosti' ? 'frosti' : body.default_storage === 'cellio' ? 'cellio' : null,
        default_is_fridge: Boolean(body.default_is_fridge),
      }).select('id,nom,categorie,rayon,default_storage,default_is_fridge').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ ingredient: data }, { status: 201 })
    }

    if (entity === 'synonym') {
      const mot = text(body.mot_recette)
      const ingredientId = text(body.ingredient_id)
      if (!mot || !ingredientId) return NextResponse.json({ error: 'Synonyme et ingrédient obligatoire.' }, { status: 400 })
      const { data, error } = await mealioServerDb.from('ingredient_synonyms').insert({ mot_recette: mot, ingredient_id: ingredientId }).select('mot_recette,ingredient_id').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ synonym: data }, { status: 201 })
    }

    if (entity === 'unit') {
      const unite = text(body.unite)
      if (!unite) return NextResponse.json({ error: 'Le nom de l’unité est obligatoire.' }, { status: 400 })
      const { data, error } = await mealioServerDb.from('unit_mappings').insert({
        unite,
        abreviation: text(body.abreviation),
        type_unite: text(body.type_unite),
        equivalence_reference: numberOrNull(body.equivalence_reference),
        multiplicateur: numberOrNull(body.multiplicateur),
      }).select('unite,abreviation,type_unite,equivalence_reference,multiplicateur').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ unit: data }, { status: 201 })
    }

    if (entity === 'density') {
      const ingredientId = text(body.ingredient_id)
      const unite = text(body.unite)
      const poids = numberOrNull(body.poids_g_approx)
      if (!ingredientId || !unite || poids === null || poids <= 0) return NextResponse.json({ error: 'Ingrédient, unité et poids positif obligatoires.' }, { status: 400 })
      const { data: existing } = await mealioServerDb.from('ingredient_densities').select('ingredient_id,unite').eq('ingredient_id', ingredientId).eq('unite', unite).maybeSingle()
      const result = existing
        ? await mealioServerDb.from('ingredient_densities').update({ poids_g_approx: poids }).eq('ingredient_id', ingredientId).eq('unite', unite).select('ingredient_id,unite,poids_g_approx').single()
        : await mealioServerDb.from('ingredient_densities').insert({ ingredient_id: ingredientId, unite, poids_g_approx: poids }).select('ingredient_id,unite,poids_g_approx').single()
      if (result.error) throw new Error(result.error.message)
      return NextResponse.json({ density: result.data }, { status: existing ? 200 : 201 })
    }

    return NextResponse.json({ error: 'Type de donnée inconnu.' }, { status: 400 })
  } catch (error) {
    console.error('POST /api/admin/ingredients', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const entity = text(body.entity)

    if (entity === 'ingredient') {
      const id = text(body.id)
      if (!id) return NextResponse.json({ error: 'Identifiant ingrédient manquant.' }, { status: 400 })
      const payload = {
        nom: text(body.nom),
        categorie: text(body.categorie),
        rayon: text(body.rayon),
        default_storage: body.default_storage === 'frosti' || body.default_storage === 'cellio' ? body.default_storage : null,
        default_is_fridge: Boolean(body.default_is_fridge),
      }
      if (!payload.nom) return NextResponse.json({ error: 'Le nom est obligatoire.' }, { status: 400 })
      const { data, error } = await mealioServerDb.from('official_ingredients').update(payload).eq('id', id).select('id,nom,categorie,rayon,default_storage,default_is_fridge').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ ingredient: data })
    }

    if (entity === 'synonym') {
      const original = text(body.original_mot_recette)
      const mot = text(body.mot_recette)
      const ingredientId = text(body.ingredient_id)
      if (!original || !mot || !ingredientId) return NextResponse.json({ error: 'Données du synonyme incomplètes.' }, { status: 400 })
      const { data, error } = await mealioServerDb.from('ingredient_synonyms').update({ mot_recette: mot, ingredient_id: ingredientId }).eq('mot_recette', original).select('mot_recette,ingredient_id').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ synonym: data })
    }

    if (entity === 'unit') {
      const original = text(body.original_unite)
      const unite = text(body.unite)
      if (!original || !unite) return NextResponse.json({ error: 'Unité incomplète.' }, { status: 400 })
      const { data, error } = await mealioServerDb.from('unit_mappings').update({
        unite,
        abreviation: text(body.abreviation),
        type_unite: text(body.type_unite),
        equivalence_reference: numberOrNull(body.equivalence_reference),
        multiplicateur: numberOrNull(body.multiplicateur),
      }).eq('unite', original).select('unite,abreviation,type_unite,equivalence_reference,multiplicateur').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ unit: data })
    }

    if (entity === 'density') {
      const ingredientId = text(body.ingredient_id)
      const originalUnit = text(body.original_unite)
      const unite = text(body.unite)
      const poids = numberOrNull(body.poids_g_approx)
      if (!ingredientId || !originalUnit || !unite || poids === null || poids <= 0) return NextResponse.json({ error: 'Données de densité incomplètes.' }, { status: 400 })
      const { data, error } = await mealioServerDb.from('ingredient_densities').update({ unite, poids_g_approx: poids }).eq('ingredient_id', ingredientId).eq('unite', originalUnit).select('ingredient_id,unite,poids_g_approx').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ density: data })
    }

    return NextResponse.json({ error: 'Type de donnée inconnu.' }, { status: 400 })
  } catch (error) {
    console.error('PATCH /api/admin/ingredients', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json()
    const entity = text(body.entity)
    let result

    if (entity === 'ingredient') {
      const id = text(body.id)
      if (!id) return NextResponse.json({ error: 'Identifiant manquant.' }, { status: 400 })
      result = await mealioServerDb.from('official_ingredients').delete().eq('id', id)
    } else if (entity === 'synonym') {
      const mot = text(body.mot_recette)
      if (!mot) return NextResponse.json({ error: 'Synonyme manquant.' }, { status: 400 })
      result = await mealioServerDb.from('ingredient_synonyms').delete().eq('mot_recette', mot)
    } else if (entity === 'unit') {
      const unite = text(body.unite)
      if (!unite) return NextResponse.json({ error: 'Unité manquante.' }, { status: 400 })
      result = await mealioServerDb.from('unit_mappings').delete().eq('unite', unite)
    } else if (entity === 'density') {
      const ingredientId = text(body.ingredient_id)
      const unite = text(body.unite)
      if (!ingredientId || !unite) return NextResponse.json({ error: 'Densité manquante.' }, { status: 400 })
      result = await mealioServerDb.from('ingredient_densities').delete().eq('ingredient_id', ingredientId).eq('unite', unite)
    } else {
      return NextResponse.json({ error: 'Type de donnée inconnu.' }, { status: 400 })
    }

    if (result.error) throw new Error(result.error.message)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/admin/ingredients', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}
