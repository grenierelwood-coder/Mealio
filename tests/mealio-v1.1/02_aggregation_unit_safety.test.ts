import { describe, expect, it } from 'vitest'
import {
  aggregateRequirements,
  convertStockQuantity,
  type ReferenceData,
  type ResolvedIngredient,
} from '../../app/utils/matcher'

const flour = {
  id: 'TEST-FLOUR',
  nom: 'Farine',
  rayon: null,
  default_storage: null,
  categorie: 'Épicerie',
  unite_reference: 'Gramme',
}

const tomato = {
  id: 'TEST-TOMATO',
  nom: 'Tomate',
  rayon: null,
  default_storage: null,
  categorie: 'Fruits & légumes',
  unite_reference: 'Gramme',
}

const refData: ReferenceData = {
  ignoredSet: new Set(),
  synonymMap: new Map(),
  officialList: [flour, tomato],
  officialById: new Map([
    [flour.id, flour],
    [tomato.id, tomato],
  ]),
  officialPrepared: [],
  unitMappings: [
    { unite: 'Gramme', abreviation: 'g', type_unite: 'poids', equivalence_reference: '1 g', multiplicateur: 1 },
    { unite: 'Kilogramme', abreviation: 'kg', type_unite: 'poids', equivalence_reference: '1000 g', multiplicateur: 1000 },
    { unite: 'Milligramme', abreviation: 'mg', type_unite: 'poids', equivalence_reference: '0.001 g', multiplicateur: 0.001 },
    { unite: 'Millilitre', abreviation: 'ml', type_unite: 'volume', equivalence_reference: '1 ml', multiplicateur: 1 },
    { unite: 'Litre', abreviation: 'l', type_unite: 'volume', equivalence_reference: '1000 ml', multiplicateur: 1000 },
    { unite: 'Pièce', abreviation: null, type_unite: 'unité', equivalence_reference: null, multiplicateur: 1 },
    { unite: 'Tranche', abreviation: null, type_unite: 'unité', equivalence_reference: null, multiplicateur: 1 },
  ],
  densities: [],
  aiResolutionMap: new Map(),
  aiCache: new Map(),
}

function item(
  id: string,
  name: string,
  qte: number,
  unite: string,
  recipe: string,
): ResolvedIngredient {
  return {
    ingredient_id: id,
    produit: name,
    qte,
    unite,
    quantity_mode: 'quantity',
    needs_review: false,
    source_recipe_id: recipe,
    source_recipe_nom: recipe,
  }
}

describe('V1.1 — agrégation et sécurité des unités', () => {
  it('additionne deux besoins du même ingrédient dans la même unité', () => {
    const result = aggregateRequirements([
      [item(flour.id, 'Farine', 500, 'Gramme', 'R1')],
      [item(flour.id, 'Farine', 300, 'Gramme', 'R2')],
    ])

    expect(result).toHaveLength(1)
    expect(result[0].qte).toBe(800)
    expect(result[0].unite).toBe('Gramme')
    expect(result[0].contributions).toHaveLength(2)
  })

  it('CRITIQUE : ne doit pas additionner 500 g + 2 pièces', () => {
    const result = aggregateRequirements([
      [item(tomato.id, 'Tomate', 500, 'Gramme', 'R1')],
      [item(tomato.id, 'Tomate', 2, 'Pièce', 'R2')],
    ])

    const bad502 = result.some(
      x => x.ingredient_id === tomato.id && x.qte === 502,
    )

    expect(
      bad502,
      '500 g + 2 pièces ne doit jamais devenir 502',
    ).toBe(false)

    // Deux unités incompatibles doivent au minimum rester séparées,
    // ou être explicitement refusées en amont.
    const units = result
      .filter(x => x.ingredient_id === tomato.id)
      .map(x => x.unite)

    expect(units).toEqual(expect.arrayContaining(['Gramme', 'Pièce']))
  })

  it('convertit kg -> g dans la même famille', () => {
    const result = convertStockQuantity(
      refData,
      flour.id,
      1,
      'Kilogramme',
      'Gramme',
    )

    expect(result).not.toBeNull()
    expect(result?.qty).toBe(1000)
    expect(result?.unit).toBe('g')
  })

  it('convertit mg -> g dans la même famille', () => {
    const result = convertStockQuantity(
      refData,
      flour.id,
      1000,
      'Milligramme',
      'Gramme',
    )

    expect(result).not.toBeNull()
    expect(result?.qty).toBe(1)
    expect(result?.unit).toBe('g')
  })

  it('refuse pièce -> g sans équivalence explicite', () => {
    expect(
      convertStockQuantity(refData, tomato.id, 2, 'Pièce', 'Gramme'),
    ).toBeNull()
  })

  it('refuse g -> ml sans densité explicite', () => {
    expect(
      convertStockQuantity(refData, flour.id, 500, 'Gramme', 'Millilitre'),
    ).toBeNull()
  })

  it('refuse ml -> g sans densité explicite', () => {
    expect(
      convertStockQuantity(refData, flour.id, 500, 'Millilitre', 'Gramme'),
    ).toBeNull()
  })

  it('ne convertit pas pièce -> tranche sans équivalence explicite', () => {
    expect(
      convertStockQuantity(refData, tomato.id, 2, 'Pièce', 'Tranche'),
    ).toBeNull()
  })
})
