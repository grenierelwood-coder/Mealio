import { createClient } from '@supabase/supabase-js'

const cookiwikiUrl = process.env.NEXT_PUBLIC_COOKIWIKI_URL || ''
// On utilise la clé de service pour un accès administrateur entre microservices, comme défini dans le cahier des charges
const cookiwikiKey = process.env.COOKIWIKI_SERVICE_ROLE_KEY || '' 

export const cookiwikiDb = createClient(cookiwikiUrl, cookiwikiKey)