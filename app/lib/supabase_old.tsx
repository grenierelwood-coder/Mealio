import { createClient } from '@supabase/supabase-js'

// --- FROSTI (Frigos & Congélos) ---
const frostiUrl = process.env.NEXT_PUBLIC_FROSTI_URL!
const frostiKey = process.env.NEXT_PUBLIC_FROSTI_ANON_KEY!
export const frostiDb = createClient(frostiUrl, frostiKey)

// --- CELLIO (Caves & Réserves) ---
const cellioUrl = process.env.NEXT_PUBLIC_CELLIO_URL!
const cellioKey = process.env.NEXT_PUBLIC_CELLIO_ANON_KEY!
export const cellioDb = createClient(cellioUrl, cellioKey)

// --- COOKIWIKI (Recettes) ---
const cookiwikiUrl = process.env.NEXT_PUBLIC_COOKIWIKI_URL!
const cookiwikiKey = process.env.NEXT_PUBLIC_COOKIWIKI_ANON_KEY!
export const cookiwikiDb = createClient(cookiwikiUrl, cookiwikiKey)


// --- MEALIO (Planning, listes, référentiels) ---
const mealioUrl = process.env.NEXT_PUBLIC_MEALIO_URL!
const mealioKey = process.env.MEALIO_SERVICE_ROLE_KEY!
export const mealioDb = createClient(mealioUrl, mealioKey)