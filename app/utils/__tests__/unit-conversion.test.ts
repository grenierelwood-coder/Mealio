import { describe, expect, it } from 'vitest'
import {
  canonicalUnit,
  convertStockQuantity,
  normalizeUnitKey,
  type UnitReferenceData,
} from '../unit-conversion'

const refData: UnitReferenceData = {
  unitMappings: [
    { unite: 'Pièce', abreviation: null, type_unite: 'unité', equivalence_reference: null, multiplicateur: 1 },
    { unite: 'Unité', abreviation: null, type_unite: 'unité', equivalence_reference: null, multiplicateur: 1 },
    { unite: 'Tranche', abreviation: null, type_unite: 'unité', equivalence_reference: null, multiplicateur: 1 },
    { unite: 'Gousse', abreviation: null, type_unite: 'unité', equivalence_reference: null, multiplicateur: 1 },
    { unite: 'g', abreviation: null, type_unite: 'poids', equivalence_reference: '1 g', multiplicateur: 1 },
    { unite: 'kg', abreviation: null, type_unite: 'poids', equivalence_reference: '1000 g', multiplicateur: 1000 },
    { unite: 'ml', abreviation: null, type_unite: 'volume', equivalence_reference: '1 ml', multiplicateur: 1 },
  ],
  densities: [
    { ingredient_id: 'tomate', unite: 'pièce', poids_g_approx: 100 },
    { ingredient_id: 'ail', unite: 'gousse', poids_g_approx: 5 },
    { ingredient_id: 'farine', unite: 'ml', poids_g_approx: 0.55 },
  ],
}

describe('unit conversion', () => {
  it('ne confond jamais unité et pièce', () => {
    expect(normalizeUnitKey('unité')).toBe('unite')
    expect(normalizeUnitKey('pièce')).toBe('piece')
    expect(canonicalUnit(refData, 'unité')?.unit).toBe('unite')
    expect(canonicalUnit(refData, 'pièce')?.unit).toBe('piece')
  })

  it('convertit kg en g', () => {
    expect(convertStockQuantity(refData, 'farine', 1, 'kg', 'g')).toMatchObject({
      ok: true,
      qty: 1000,
      unit: 'g',
    })
  })

  it('ne convertit pas tranche en gousse sans pont explicite', () => {
    expect(convertStockQuantity(refData, 'ail', 2, 'tranche', 'gousse')).toEqual({
      ok: false,
      reason: 'incompatible_families',
    })
  })

  it('convertit une pièce en poids si le référentiel le permet', () => {
    expect(convertStockQuantity(refData, 'tomate', 2, 'pièce', 'g')).toMatchObject({
      ok: true,
      qty: 200,
      unit: 'g',
    })
  })

  it('signale l’absence de pont pour une unité discrète', () => {
    expect(convertStockQuantity(refData, 'farine', 2, 'tranche', 'g')).toEqual({
      ok: false,
      reason: 'no_bridge_data',
    })
  })

  it('convertit volume vers poids avec une densité', () => {
    expect(convertStockQuantity(refData, 'farine', 100, 'ml', 'g')).toMatchObject({
      ok: true,
      qty: 55,
      unit: 'g',
    })
  })
})
