import { mealioServerDb,cookiwikiServerDb } from '../lib/supabase-server'
import { requireHousehold,getHouseholdStockServer } from './household-server'
import { loadReferenceData } from './matcher'
import { listStorageLocations,listStorageRoutingRules } from './storage-routing-server'
import { loadInventoryReminders } from './inventory-reminder-server'
import type { ReadinessCheck } from './production-readiness-policy'
/** Read-only, authenticated household scope. No Claude, purchase, stock or recipe mutation. */
export async function productionReadiness(username:string){
 const checks:ReadinessCheck[]=[]
 async function check(id:string,title:string,task:()=>Promise<string>,href?:string){try{checks.push({id,title,status:'pass',detail:await task(),href})}catch(e){checks.push({id,title,status:'fail',detail:e instanceof Error?e.message:'Contrôle impossible.',href})}}
 let context:Awaited<ReturnType<typeof requireHousehold>>|null=null
 await check('household','Foyer Frosti / Cellio',async()=>{context=await requireHousehold(username);return `Foyer ${username} retrouvé. Frosti : ${context.frostiUserId?'présent':'absent'} ; Cellio : ${context.cellioUserId?'présent':'absent'}.`})
 const h=context as Awaited<ReturnType<typeof requireHousehold>>|null
 await Promise.all([
 check('cookiwiki','Lecture Cookiwiki',async()=>{const {data,error}=await cookiwikiServerDb.from('recipes').select('id').limit(1);if(error)throw new Error(error.message);return data?.length?'Recettes accessibles.':'Connexion accessible ; bibliothèque vide.'},'/admin/recipes'),
 check('reference','Référentiel et suivi du foyer',async()=>{const ref=await loadReferenceData(username);if(!ref.officialList.length)throw new Error('Référentiel ingrédients vide.');return `${ref.officialList.length} ingrédients officiels ; ${[...(ref.pantryProducts?.values()||[])].filter(p=>p.enabled).length} produits configurés en présence.`},'/admin/pantry'),
 check('stock','Lecture complète des stocks',async()=>{if(!h)throw new Error('Foyer non résolu.');const rows=await getHouseholdStockServer(username,h);return `${rows.length} lignes de stock lues pour ${username}.`},'/stock'),
 check('inventory','Paramétrage des rappels',async()=>{const result=await loadInventoryReminders(username);if(result.warning)throw new Error(result.warning);return `${result.locations.length} lieux physiques ; ${result.locations.filter(l=>l.interval_weeks!==null).length} rappels activés.`},'/inventaire'),
 ...(['frosti','cellio'] as const).map(source=>check('routing-'+source,`Lieux et règles ${source==='frosti'?'Frosti':'Cellio'}`,async()=>{const id=source==='frosti'?h?.frostiUserId:h?.cellioUserId;if(!id)throw new Error(`Foyer absent de ${source}.`);const [places,rules]=await Promise.all([listStorageLocations(source,id),listStorageRoutingRules(source,id)]);if(!places.length)throw new Error('Aucun lieu physique : en créer dans l’application source.');const active=rules.filter(r=>r.is_active);if(!active.length)throw new Error('Aucune règle active : configurer le rangement.');if(active.some(r=>!places.some(l=>l.id===r.location_id)))throw new Error('Une règle active désigne un lieu absent du foyer.');return `${places.length} lieux et ${active.length} règles actives. Destinations existantes vérifiées.`},'/admin/storage')),
 ...(['shopping_lists','household_pantry_signals','household_inventory_reminders','cookiwiki_recipe_checks'] as const).map(table=>check('table-'+table,`Table ${table}`,async()=>{const {error}=await mealioServerDb.from(table).select('*').eq('user_id',username).limit(1);if(error)throw new Error(error.message);return 'Table accessible ; lecture limitée au foyer connecté.'},'/admin/data')),
 check('history','Historique des achats',async()=>{const {data,error}=await mealioServerDb.from('shopping_lists').select('id').eq('user_id',username).limit(1);if(error)throw new Error(error.message);const ids=(data||[]).map(r=>r.id);const result=await mealioServerDb.from('shopping_purchase_events').select('id').in('list_id',ids.length?ids:['00000000-0000-0000-0000-000000000000']).limit(1);if(result.error)throw new Error(result.error.message);return 'Table historique accessible ; accès par les listes du foyer.'},'/purchases'),
 ])
 checks.push({id:'real-cycle',title:'Cycle réel et séparation des foyers',status:'warning',detail:'Non exécutés par ce diagnostic en lecture seule. Effectuer le cycle sur un foyer de test et les essais croisés de deux foyers.',href:'/admin/integration'}, {id:'deployment',title:'Build et smartphone',status:'warning',detail:'Non vérifiés par ce bouton. Exécuter le build sur l’installation puis tester la version déployée.'})
 return {household:username,date:new Date().toISOString(),scope:'lecture seule des DB réelles ; pas de mutation ni appel Claude',checks,readable:!checks.some(c=>c.status==='fail')}
}
