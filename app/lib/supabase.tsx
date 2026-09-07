import { createClient } from '@supabase/supabase-js'

// --- FROSTI (Congélateurs & Frigos) ---
const frostiUrl = process.env.NEXT_PUBLIC_FROSTI_URL!
const frostiKey = process.env.NEXT_PUBLIC_FROSTI_ANON_KEY!
export const frostiDb = createClient(frostiUrl, frostiKey)

// --- CELLIO (Caves & Réserves) ---
const cellioUrl = process.env.NEXT_PUBLIC_CELLIO_URL!
const cellioKey = process.env.NEXT_PUBLIC_CELLIO_ANON_KEY!
export const cellioDb = createClient(cellioUrl, cellioKey)

// --- COOKIWIKI (Recettes publiques) ---
const cookiwikiUrl = process.env.NEXT_PUBLIC_COOKIWIKI_URL!
const cookiwikiKey = process.env.NEXT_PUBLIC_COOKIWIKI_ANON_KEY!
export const cookiwikiDb = createClient(cookiwikiUrl, cookiwikiKey)

// --- MEALIO — client navigateur ---
// IMPORTANT : on n'utilise PLUS la service_role ici.
// Ce client est sûr pour les composants client.
const mealioUrl = process.env.NEXT_PUBLIC_MEALIO_URL!
const mealioAnonKey = process.env.NEXT_PUBLIC_MEALIO_ANON_KEY!
export const mealioDb = createClient(mealioUrl, mealioAnonKey)
