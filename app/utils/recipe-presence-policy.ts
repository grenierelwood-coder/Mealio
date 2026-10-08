/** Normalize recipe labels without importing server-only matcher modules in the UI. */
export function cleanRecipeName(value:string){return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(t=>t&&!['de','d','du','des','la','le','les','a','au','aux'].includes(t)).join(' ')}
