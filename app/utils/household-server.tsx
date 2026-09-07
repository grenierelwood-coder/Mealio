
import {
  frostiServerDb,
  cellioServerDb,
} from '../lib/supabase-server'

/**
 * Représentation minimale commune des utilisateurs
 * Frosti / Cellio.
 */
export interface HouseholdUser {
  id: string
  username: string
}

/**
 * Références du foyer dans les deux bases.
 *
 * IMPORTANT :
 * Frosti et Cellio ont chacun leur propre app_users.
 * On ne réutilise donc jamais l'UUID d'une base dans l'autre.
 */
export interface HouseholdContext {
  username: string
  frostiUserId: string | null
  cellioUserId: string | null
}

/**
 * Ligne d'un stock.
 *
 * On conserve volontairement les champs communs utilisés
 * par Mealio et le Matcher.
 */
export interface HouseholdStockItem {
  id: string
  produit: string
  qte: number
  unite: string
  categorie: string
  source: 'frosti' | 'cellio'
  date_entree?: string | null
  date_peremption?: string | null
  notes?: string | null
  congelo_id?: string | null
  cellar_id?: string | null
}

/**
 * Résout un username dans Frosti ET Cellio.
 *
 * Les deux bases possèdent leur propre table app_users.
 */
export async function resolveHousehold(
  username: string
): Promise<HouseholdContext> {
  const normalizedUsername = username.trim()

  if (!normalizedUsername) {
    throw new Error('Nom utilisateur absent.')
  }

  const [frostiResult, cellioResult] = await Promise.all([
    frostiServerDb
      .from('app_users')
      .select('id, username')
      .eq('username', normalizedUsername)
      .maybeSingle(),

    cellioServerDb
      .from('app_users')
      .select('id, username')
      .eq('username', normalizedUsername)
      .maybeSingle(),
  ])

  if (frostiResult.error) {
    throw new Error(
      `Erreur résolution utilisateur Frosti : ${frostiResult.error.message}`
    )
  }

  if (cellioResult.error) {
    throw new Error(
      `Erreur résolution utilisateur Cellio : ${cellioResult.error.message}`
    )
  }

  return {
    username: normalizedUsername,
    frostiUserId: frostiResult.data?.id ?? null,
    cellioUserId: cellioResult.data?.id ?? null,
  }
}

/**
 * Vérifie qu'un foyer existe au moins dans l'une des deux bases.
 */
export async function requireHousehold(
  username: string
): Promise<HouseholdContext> {
  const household = await resolveHousehold(username)

  if (!household.frostiUserId && !household.cellioUserId) {
    throw new Error(
      `Utilisateur "${household.username}" introuvable dans Frosti et Cellio.`
    )
  }

  return household
}

/**
 * Récupère le stock Frosti du foyer.
 */
export async function getFrostiStock(
  userId: string
): Promise<HouseholdStockItem[]> {
  const { data, error } = await frostiServerDb
    .from('items')
    .select(
      `
        id,
        produit,
        qte,
        unite,
        categorie,
        date_entree,
        date_peremption,
        notes,
        congelo_id
      `
    )
    .eq('user_id', userId)
    .order('produit', { ascending: true })

  if (error) {
    throw new Error(
      `Erreur lecture stock Frosti : ${error.message}`
    )
  }

  return (data ?? []).map((item: any) => ({
    id: item.id,
    produit: item.produit,
    qte: Number(item.qte ?? 0),
    unite: item.unite ?? '',
    categorie: item.categorie ?? '',
    source: 'frosti',
    date_entree: item.date_entree ?? null,
    date_peremption: item.date_peremption ?? null,
    notes: item.notes ?? null,
    congelo_id: item.congelo_id ?? null,
  }))
}

/**
 * Récupère le stock Cellio du foyer.
 */
export async function getCellioStock(
  userId: string
): Promise<HouseholdStockItem[]> {
  const { data, error } = await cellioServerDb
    .from('items')
    .select(
      `
        id,
        produit,
        qte,
        unite,
        categorie,
        date_entree,
        date_peremption,
        notes,
        cellar_id
      `
    )
    .eq('user_id', userId)
    .order('produit', { ascending: true })

  if (error) {
    throw new Error(
      `Erreur lecture stock Cellio : ${error.message}`
    )
  }

  return (data ?? []).map((item: any) => ({
    id: item.id,
    produit: item.produit,
    qte: Number(item.qte ?? 0),
    unite: item.unite ?? '',
    categorie: item.categorie ?? '',
    source: 'cellio',
    date_entree: item.date_entree ?? null,
    date_peremption: item.date_peremption ?? null,
    notes: item.notes ?? null,
    cellar_id: item.cellar_id ?? null,
  }))
}

/**
 * Récupère le stock complet du foyer.
 */
export async function getHouseholdStockServer(
  username: string
): Promise<HouseholdStockItem[]> {
  const household = await requireHousehold(username)

  const [frostiStock, cellioStock] = await Promise.all([
    household.frostiUserId
      ? getFrostiStock(household.frostiUserId)
      : Promise.resolve([]),

    household.cellioUserId
      ? getCellioStock(household.cellioUserId)
      : Promise.resolve([]),
  ])

  return [...frostiStock, ...cellioStock]
}

/**
 * Données autorisées pour créer un article.
 *
 * Les champs propres à Frosti / Cellio sont séparés.
 */
export interface CreateStockItemInput {
  source: 'frosti' | 'cellio'
  produit: string
  qte?: number
  unite?: string
  categorie: string
  date_entree?: string | null
  date_peremption?: string | null
  notes?: string | null
  congelo_id?: string | null
  cellar_id?: string | null
}

/**
 * Ajoute un article dans Frosti ou Cellio.
 */
export async function createHouseholdStockItem(
  username: string,
  input: CreateStockItemInput
): Promise<HouseholdStockItem> {
  const household = await requireHousehold(username)

  const produit = input.produit?.trim()
  const categorie = input.categorie?.trim()

  if (!produit) {
    throw new Error('Le produit est obligatoire.')
  }

  if (!categorie) {
    throw new Error('La catégorie est obligatoire.')
  }

  const qte =
    input.qte === undefined || input.qte === null
      ? 1
      : Number(input.qte)

  if (!Number.isFinite(qte)) {
    throw new Error('La quantité est invalide.')
  }

  if (input.source === 'frosti') {
    if (!household.frostiUserId) {
      throw new Error(
        `Utilisateur "${household.username}" absent de Frosti.`
      )
    }

    const payload: Record<string, unknown> = {
      user_id: household.frostiUserId,
      produit,
      qte,
      unite: input.unite?.trim() || 'pièce(s)',
      categorie,
    }

    if (input.date_entree !== undefined) {
      payload.date_entree = input.date_entree
    }

    if (input.date_peremption !== undefined) {
      payload.date_peremption = input.date_peremption
    }

    if (input.notes !== undefined) {
      payload.notes = input.notes
    }

    if (input.congelo_id !== undefined) {
      payload.congelo_id = input.congelo_id
    }

    const { data, error } = await frostiServerDb
      .from('items')
      .insert(payload)
      .select(
        `
          id,
          produit,
          qte,
          unite,
          categorie,
          date_entree,
          date_peremption,
          notes,
          congelo_id
        `
      )
      .single()

    if (error) {
      throw new Error(
        `Erreur ajout article Frosti : ${error.message}`
      )
    }

    return {
      id: data.id,
      produit: data.produit,
      qte: Number(data.qte ?? 0),
      unite: data.unite ?? '',
      categorie: data.categorie ?? '',
      source: 'frosti',
      date_entree: data.date_entree ?? null,
      date_peremption: data.date_peremption ?? null,
      notes: data.notes ?? null,
      congelo_id: data.congelo_id ?? null,
    }
  }

  if (!household.cellioUserId) {
    throw new Error(
      `Utilisateur "${household.username}" absent de Cellio.`
    )
  }

  const payload: Record<string, unknown> = {
    user_id: household.cellioUserId,
    produit,
    qte,
    unite: input.unite?.trim() || 'Bouteille 75cl',
    categorie,
  }

  if (input.date_entree !== undefined) {
    payload.date_entree = input.date_entree
  }

  if (input.date_peremption !== undefined) {
    payload.date_peremption = input.date_peremption
  }

  if (input.notes !== undefined) {
    payload.notes = input.notes
  }

  if (input.cellar_id !== undefined) {
    payload.cellar_id = input.cellar_id
  }

  const { data, error } = await cellioServerDb
    .from('items')
    .insert(payload)
    .select(
      `
        id,
        produit,
        qte,
        unite,
        categorie,
        date_entree,
        date_peremption,
        notes,
        cellar_id
      `
    )
    .single()

  if (error) {
    throw new Error(
      `Erreur ajout article Cellio : ${error.message}`
    )
  }

  return {
    id: data.id,
    produit: data.produit,
    qte: Number(data.qte ?? 0),
    unite: data.unite ?? '',
    categorie: data.categorie ?? '',
    source: 'cellio',
    date_entree: data.date_entree ?? null,
    date_peremption: data.date_peremption ?? null,
    notes: data.notes ?? null,
    cellar_id: data.cellar_id ?? null,
  }
}

/**
 * Modifie un article existant.
 *
 * La source est obligatoire afin d'éviter toute modification
 * accidentelle d'un article portant le même UUID dans l'autre base.
 */
export interface UpdateStockItemInput {
  source: 'frosti' | 'cellio'
  produit?: string
  qte?: number
  unite?: string
  categorie?: string
  date_entree?: string | null
  date_peremption?: string | null
  notes?: string | null
  congelo_id?: string | null
  cellar_id?: string | null
}

export async function updateHouseholdStockItem(
  username: string,
  itemId: string,
  input: UpdateStockItemInput
): Promise<HouseholdStockItem> {
  const household = await requireHousehold(username)

  const normalizedId = itemId.trim()

  if (!normalizedId) {
    throw new Error('Identifiant article absent.')
  }

  const payload: Record<string, unknown> = {}

  if (input.produit !== undefined) {
    const produit = input.produit.trim()

    if (!produit) {
      throw new Error('Le produit ne peut pas être vide.')
    }

    payload.produit = produit
  }

  if (input.qte !== undefined) {
    const qte = Number(input.qte)

    if (!Number.isFinite(qte)) {
      throw new Error('La quantité est invalide.')
    }

    payload.qte = qte
  }

  if (input.unite !== undefined) {
    payload.unite = input.unite.trim()
  }

  if (input.categorie !== undefined) {
    const categorie = input.categorie.trim()

    if (!categorie) {
      throw new Error('La catégorie ne peut pas être vide.')
    }

    payload.categorie = categorie
  }

  if (input.date_entree !== undefined) {
    payload.date_entree = input.date_entree
  }

  if (input.date_peremption !== undefined) {
    payload.date_peremption = input.date_peremption
  }

  if (input.notes !== undefined) {
    payload.notes = input.notes
  }

  if (input.congelo_id !== undefined) {
    payload.congelo_id = input.congelo_id
  }

  if (input.cellar_id !== undefined) {
    payload.cellar_id = input.cellar_id
  }

  if (Object.keys(payload).length === 0) {
    throw new Error('Aucune modification demandée.')
  }

  if (input.source === 'frosti') {
    if (!household.frostiUserId) {
      throw new Error(
        `Utilisateur "${household.username}" absent de Frosti.`
      )
    }

    const { data, error } = await frostiServerDb
      .from('items')
      .update(payload)
      .eq('id', normalizedId)
      .eq('user_id', household.frostiUserId)
      .select(
        `
          id,
          produit,
          qte,
          unite,
          categorie,
          date_entree,
          date_peremption,
          notes,
          congelo_id
        `
      )
      .maybeSingle()

    if (error) {
      throw new Error(
        `Erreur modification article Frosti : ${error.message}`
      )
    }

    if (!data) {
      throw new Error('Article Frosti introuvable.')
    }

    return {
      id: data.id,
      produit: data.produit,
      qte: Number(data.qte ?? 0),
      unite: data.unite ?? '',
      categorie: data.categorie ?? '',
      source: 'frosti',
      date_entree: data.date_entree ?? null,
      date_peremption: data.date_peremption ?? null,
      notes: data.notes ?? null,
      congelo_id: data.congelo_id ?? null,
    }
  }

  if (!household.cellioUserId) {
    throw new Error(
      `Utilisateur "${household.username}" absent de Cellio.`
    )
  }

  const { data, error } = await cellioServerDb
    .from('items')
    .update(payload)
    .eq('id', normalizedId)
    .eq('user_id', household.cellioUserId)
    .select(
      `
        id,
        produit,
        qte,
        unite,
        categorie,
        date_entree,
        date_peremption,
        notes,
        cellar_id
      `
    )
    .maybeSingle()

  if (error) {
    throw new Error(
      `Erreur modification article Cellio : ${error.message}`
    )
  }

  if (!data) {
    throw new Error('Article Cellio introuvable.')
  }

  return {
    id: data.id,
    produit: data.produit,
    qte: Number(data.qte ?? 0),
    unite: data.unite ?? '',
    categorie: data.categorie ?? '',
    source: 'cellio',
    date_entree: data.date_entree ?? null,
    date_peremption: data.date_peremption ?? null,
    notes: data.notes ?? null,
    cellar_id: data.cellar_id ?? null,
  }
}

/**
 * Supprime un article du stock.
 */
export async function deleteHouseholdStockItem(
  username: string,
  itemId: string,
  source: 'frosti' | 'cellio'
): Promise<void> {
  const household = await requireHousehold(username)

  const normalizedId = itemId.trim()

  if (!normalizedId) {
    throw new Error('Identifiant article absent.')
  }

  if (source === 'frosti') {
    if (!household.frostiUserId) {
      throw new Error(
        `Utilisateur "${household.username}" absent de Frosti.`
      )
    }

    const { data, error } = await frostiServerDb
      .from('items')
      .delete()
      .eq('id', normalizedId)
      .eq('user_id', household.frostiUserId)
      .select('id')
      .maybeSingle()

    if (error) {
      throw new Error(
        `Erreur suppression article Frosti : ${error.message}`
      )
    }

    if (!data) {
      throw new Error('Article Frosti introuvable.')
    }

    return
  }

  if (!household.cellioUserId) {
    throw new Error(
      `Utilisateur "${household.username}" absent de Cellio.`
    )
  }

  const { data, error } = await cellioServerDb
    .from('items')
    .delete()
    .eq('id', normalizedId)
    .eq('user_id', household.cellioUserId)
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(
      `Erreur suppression article Cellio : ${error.message}`
    )
  }

  if (!data) {
    throw new Error('Article Cellio introuvable.')
  }
}

