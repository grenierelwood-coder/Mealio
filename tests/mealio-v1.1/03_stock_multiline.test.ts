import { describe, expect, it } from 'vitest'
import {
  compareToStock,
  type AggregatedRequirement,
  type ReferenceData,
  type StockItem,
} from '../../app/utils/matcher'

const flour = {
  id: 'TEST-FLOUR',
  nom: 'Farine',
  rayon: null,
  default_storage: null,
  categorie: 'Épicerie',
  unite_reference: 'Gramme',
}

const refData: ReferenceData = {
  ignoredSet: new Set(),
  synonymMap: new Map(),
  officialList: [flour],
  officialById: new Map([[flour.id, flour]]),
  officialPrepared: [],
  unitMappings: [
    { unite: 'Gramme', abreviation: 'g', type_unite: 'poids', equivalence_reference: '1 g', multiplicateur: 1 },
    { unite: 'Kilogramme', abreviation: 'kg', type_unite: 'poids', equivalence_reference: '1000 g', multiplicateur: 1000 },
    { unite: 'Millilitre', abreviation: 'ml', type_unite: 'volume', equivalence_reference: '1 ml', multiplicateur: 1 },
  ],
  densities: [],
  aiResolutionMap: new Map(),
  aiCache: new Map(),
}

const need: AggregatedRequirement = {
  produit: 'Farine',
  ingredient_id: flour.id,
  qte: 1000,
  unite: 'Gramme',
  quantity_mode: 'quantity',
  needs_review: false,
  contributions: [
    { recipe_id: 'R1', recipe_nom: 'Test', qte_contribuee: 1000 },
  ],
}

function stock(
  id: string,
  qte: number,
  unite: string,
  source: string,
): StockItem {
  return {
    id,
    produit: 'Farine',
    qte,
    unite,
    source,
    ingredient_id: flour.id,
  }
}

async function compare(stocks: StockItem[]) {
  return compareToStock(
    [need],
    stocks,
    refData,
    undefined,
    {
      stopWords: new Set(),
      memory: new Map(),
      exclusions: new Set(),
      persistMemory: false,
    },
  )
}

describe('V1.1 — stock multi-lignes', () => {
  it('additionne toutes les lignes compatibles', async () => {
    const result = await compare([
      stock('F1', 500, 'Gramme', 'frosti'),
      stock('F2', 300, 'Gramme', 'frosti'),
      stock('C1', 200, 'Gramme', 'cellio'),
    ])

    expect(result[0].qte_stock).toBe(1000)
    expect(result[0].qte_a_acheter).toBe(0)
    expect(result[0].stock_details).toHaveLength(3)
  })

  it('convertit chaque ligne avant addition', async () => {
    const result = await compare([
      stock('F1', 0.5, 'Kilogramme', 'frosti'),
      stock('C1', 300, 'Gramme', 'cellio'),
    ])

    expect(result[0].qte_stock).toBe(800)
    expect(result[0].qte_a_acheter).toBe(200)
  })

  it('ne déduit pas une ligne incompatible et la signale', async () => {
    const result = await compare([
      stock('F1', 500, 'Gramme', 'frosti'),
      stock('C1', 2, 'Millilitre', 'cellio'),
    ])

    expect(result[0].qte_stock).toBe(500)
    expect(result[0].qte_a_acheter).toBe(500)
    expect(
      result[0].stock_details?.some(d => d.qte_convertie === null),
    ).toBe(true)
  })

  it('conserve les deux sources dans le détail', async () => {
    const result = await compare([
      stock('F1', 500, 'Gramme', 'frosti'),
      stock('C1', 200, 'Gramme', 'cellio'),
    ])

    const sources = result[0].stock_details?.map(d => d.unite_stock)
    expect(sources).toHaveLength(2)
  })
})
