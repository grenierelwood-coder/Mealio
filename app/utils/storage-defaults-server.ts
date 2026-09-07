
import {
  frostiServerDb,
  cellioServerDb,
} from '../lib/supabase-server'

export type StorageType =
  | 'frosti'
  | 'cellio'

export interface StorageDefault {
  ingredient_id: string
  user_id: string
  storage: StorageType
  location_id: string
}

/**
 * ================================================================
 * FROSTI
 * ================================================================
 *
 * Recherche l'emplacement physique par défaut d'un ingrédient
 * pour un utilisateur Frosti.
 *
 * IMPORTANT :
 *
 * - userId = UUID LOCAL à Frosti
 * - ingredientId = UUID provenant de Mealio
 * - freezer_id = UUID LOCAL à Frosti
 *
 * Il n'existe volontairement aucune FK vers Mealio,
 * car les bases Supabase sont séparées.
 */
export async function getFrostiStorageDefault(
  userId: string,
  ingredientId: string
): Promise<StorageDefault | null> {

  const {
    data,
    error,
  } = await frostiServerDb
    .from('storage_defaults')
    .select(
      `
        ingredient_id,
        user_id,
        freezer_id
      `
    )
    .eq(
      'user_id',
      userId
    )
    .eq(
      'ingredient_id',
      ingredientId
    )
    .maybeSingle()

  if (error) {
    throw new Error(
      `Erreur lecture emplacement par défaut Frosti : ${error.message}`
    )
  }

  if (!data) {
    return null
  }

  return {
    ingredient_id:
      data.ingredient_id,

    user_id:
      data.user_id,

    storage:
      'frosti',

    location_id:
      data.freezer_id,
  }
}

/**
 * ================================================================
 * CELLIO
 * ================================================================
 *
 * Recherche l'emplacement physique par défaut d'un ingrédient
 * pour un utilisateur Cellio.
 *
 * IMPORTANT :
 *
 * - userId = UUID LOCAL à Cellio
 * - ingredientId = UUID provenant de Mealio
 * - cellar_id = UUID LOCAL à Cellio
 */
export async function getCellioStorageDefault(
  userId: string,
  ingredientId: string
): Promise<StorageDefault | null> {

  const {
    data,
    error,
  } = await cellioServerDb
    .from('storage_defaults')
    .select(
      `
        ingredient_id,
        user_id,
        cellar_id
      `
    )
    .eq(
      'user_id',
      userId
    )
    .eq(
      'ingredient_id',
      ingredientId
    )
    .maybeSingle()

  if (error) {
    throw new Error(
      `Erreur lecture emplacement par défaut Cellio : ${error.message}`
    )
  }

  if (!data) {
    return null
  }

  return {
    ingredient_id:
      data.ingredient_id,

    user_id:
      data.user_id,

    storage:
      'cellio',

    location_id:
      data.cellar_id,
  }
}

/**
 * ================================================================
 * RÉSOLUTION GÉNÉRIQUE
 * ================================================================
 *
 * Permet au reste de Mealio de demander :
 *
 *   "Où ranger cet ingrédient pour cet utilisateur ?"
 *
 * sans connaître les détails internes de Frosti / Cellio.
 */
export async function getStorageDefault(
  storage: StorageType,
  userId: string,
  ingredientId: string
): Promise<StorageDefault | null> {

  if (storage === 'frosti') {
    return getFrostiStorageDefault(
      userId,
      ingredientId
    )
  }

  return getCellioStorageDefault(
    userId,
    ingredientId
  )
}
