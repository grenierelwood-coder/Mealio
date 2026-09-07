import { createClient } from '@supabase/supabase-js'

/**
 * Clients Supabase SERVEUR.
 *
 * IMPORTANT :
 * - ces clients utilisent les service_role keys ;
 * - ce fichier ne doit jamais être importé dans un composant client ;
 * - les service_role keys ne doivent jamais être exposées au navigateur.
 */

function requiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `Variable d'environnement manquante : ${name}`
    )
  }

  return value
}

function createServerClient(
  urlEnvName: string,
  keyEnvName: string
) {
  return createClient(
    requiredEnv(urlEnvName),
    requiredEnv(keyEnvName),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
  )
}

/**
 * Base Mealio
 */
export const mealioServerDb = createServerClient(
  'NEXT_PUBLIC_MEALIO_URL',
  'MEALIO_SERVICE_ROLE_KEY'
)

/**
 * Base Frosti
 */
export const frostiServerDb = createServerClient(
  'NEXT_PUBLIC_FROSTI_URL',
  'FROSTI_SERVICE_ROLE_KEY'
)

/**
 * Base Cellio
 */
export const cellioServerDb = createServerClient(
  'NEXT_PUBLIC_CELLIO_URL',
  'CELLIO_SERVICE_ROLE_KEY'
)

/**
 * Base Cookiwiki
 */
export const cookiwikiServerDb = createServerClient(
  'NEXT_PUBLIC_COOKIWIKI_URL',
  'COOKIWIKI_SERVICE_ROLE_KEY'
)