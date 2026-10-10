import {catalogRows} from '../../utils/catalog-server'
import {getMealPlans} from '../../utils/meal-planner-server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getAuthSession } from '../../utils/auth-server'
import { mealioServerDb,frostiServerDb,cellioServerDb } from '../../lib/supabase-server'
import { getHouseholdStockServer,requireHousehold,operationUuid,type HouseholdStockItem } from '../../utils/household-server'
import { assertSameOrigin } from '../../utils/ecosystem-policy'
import { findJob,reserveJob,runJob,claimJob,releaseJob,type EcosystemAction } from '../../utils/ecosystem-jobs-server'
import { getRecipeDetailsFromCookiwiki } from '../../utils/cookiwiki-fetcher'
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const positive=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>0;
const dateValid=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const sourceValid=(value:unknown):value is 'frosti'|'cellio'=>value==='frosti'||value==='cellio';
async function unfinishedJobs(name:string){const rows:any[]=[];for(let offset=0;offset<50000;offset+=500){const {data,error}=await mealioServerDb.from('ecosystem_jobs').select('*').eq('user_id',name).neq('status','completed').order('created_at',{ascending:false}).order('id').range(offset,offset+499);if(error)throw new Error(error.message);rows.push(...(data??[]));if(!data||data.length<500)return {data:rows,error:null}}throw new Error('Trop d’opérations à reprendre.')}
async function username(){return (await getAuthSession())?.username?.trim()}
export async function GET(){
 const name=await username();if(!name)return NextResponse.json({error:'Non authentifié.'},{status:401});
 try{
  const [unfinished,recent,ingredients,plans]=await Promise.all([
   unfinishedJobs(name),
   mealioServerDb.from('ecosystem_jobs').select('*').eq('user_id',name).eq('status','completed').order('created_at',{ascending:false}).limit(100),
   catalogRows('official_ingredients','id,nom'),getMealPlans(name)])
  if(recent.error)throw new Error(recent.error.message)
  const jobs=Array.from(new Map([...(unfinished.data??[]),...(recent.data??[])].map(j=>[j.id,j])).values())
  return NextResponse.json({jobs,ingredients,plans})
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Lecture impossible.'},{status:503})}
}
async function targetFor(name:string,source:'frosti'|'cellio',location:string){
 if(!uuid.test(location))throw new Error('Équipement invalide.');const h=await requireHousehold(name);const owner=source==='frosti'?h.frostiUserId:h.cellioUserId;
 const {data,error}=await (source==='frosti'?frostiServerDb:cellioServerDb).from(source==='frosti'?'freezers':'cellars').select('id').eq('id',location).eq('user_id',owner).is('archived_at',null).maybeSingle();if(error)throw new Error(error.message);if(!data)throw new Error('Équipement indisponible pour ce foyer.');
}
function lotPayload(lot:HouseholdStockItem,qte:number,source:'frosti'|'cellio',target:string){
 const payload:Record<string,unknown>={qte,merge_exact:true,[source==='frosti'?'congelo_id':'cellar_id']:target};
 for(const key of ['produit','categorie','unite','date_entree','date_peremption','notes','date_kind','ingredient_id','ingredient_name','content_quantity','content_unit','product_type','preparation_origin','date_role','date_fabrication','millesime','domaine','format','preparation_id','recipe_id','portions_per_unit'] as const)payload[key]=lot[key]??null;
 payload.date_role=lot.date_role??'unknown';payload.date_kind=lot.date_kind??'declared';return payload;
}
export async function POST(request:Request){
 const name=await username();if(!name)return NextResponse.json({error:'Non authentifié.'},{status:401});let jobId:string|undefined;
 try{
  assertSameOrigin(request);const body=await request.json();
  if(body.action==='repair_destination'){
   if(!uuid.test(body.id??'')||!Number.isInteger(body.index))throw new Error('Étape invalide.')
   const job=await findJob(name,body.id);if(!job||job.status==='completed')throw new Error('Opération indisponible.')
   const action=job.actions[body.index];if(!action||action.action!=='add')throw new Error('Seule une étape de rangement peut changer de destination.')
   const lease=await claimJob(name,job.id)
   try{
   const current=Number(job.completed_steps??0);if(body.index<current)throw new Error('Cette étape est déjà effectuée.')
   await targetFor(name,action.source,body.target_id)
   // Disallow repair after a lost response from a committed destination action.
   const h=await requireHousehold(name);const db=action.source==='frosti'?frostiServerDb:cellioServerDb
   const owner=action.source==='frosti'?h.frostiUserId:h.cellioUserId
   const {data:receipt,error:receiptError}=await db.from(`${action.source}_operations`).select('operation_id').eq('user_id',owner).eq('operation_id',operationUuid(`${job.id}:${body.index}`)).maybeSingle()
   if(receiptError)throw new Error(receiptError.message);if(receipt)throw new Error('Le rangement a déjà été effectué. Reprenez le journal pour le finaliser.')
   // The lease excludes replay while the destination is checked and repaired.
   const override={[action.source==='frosti'?'congelo_id':'cellar_id']:body.target_id}
   const {data:changed,error}=await mealioServerDb.from('ecosystem_jobs').update({overrides:{...job.overrides,[String(body.index)]:override},repair_log:[...(job.repair_log??[]),{index:body.index,target_id:body.target_id,at:new Date().toISOString()}],updated_at:new Date().toISOString()}).eq('id',job.id).eq('user_id',name).eq('lease_token',lease).select('id').maybeSingle()
   if(error||!changed)throw new Error(error?.message??'L’opération a changé. Actualisez le journal.')
   }finally{await releaseJob(name,job.id,lease)}
   return NextResponse.json({job:await runJob(name,job.id)})
  }
  if(body.action==='resume'){
   if(!uuid.test(body.id??''))throw new Error('Identifiant invalide.');const job=await runJob(name,body.id);
   return NextResponse.json({job});
  }
  jobId=body.operation_id??randomUUID();if(!uuid.test(jobId!))throw new Error('Identifiant invalide.');
  if(!['transfer','preparation'].includes(body.kind))throw new Error('Type d’opération invalide.');
  const existing=await findJob(name,jobId!);
  if(existing){
   // Same request only: reservation verifies the fingerprint without replacing the frozen plan.
   await reserveJob(name,jobId!,body.kind,body,existing.actions,existing.result);return NextResponse.json({job:await runJob(name,jobId!)});
  }
  const stock=await getHouseholdStockServer(name);const actions:EcosystemAction[]=[];const seen=new Set<string>();
  const consumption=body.kind==='transfer'?body.lots:body.inputs;
  if(!Array.isArray(consumption)||consumption.length>100||(body.kind==='transfer'&&!consumption.length))throw new Error('Sélectionnez de 1 à 100 lots pour un transfert.');
  const selected:Array<{lot:HouseholdStockItem,amount:number}>=[];
  for(const row of consumption){
   if(!sourceValid(row.source)||!uuid.test(row.id??'')||!positive(row.amount))throw new Error('Lot ou quantité invalide.');
   const key=`${row.source}:${row.id}`;if(seen.has(key))throw new Error('Lot sélectionné deux fois.');seen.add(key);
   const lot=stock.find(i=>i.source===row.source&&i.id===row.id);if(!lot||row.amount>lot.qte||row.version!==lot.version)throw new Error('Un lot a changé. Actualisez le stock avant de confirmer.');
   selected.push({lot,amount:row.amount});actions.push({source:lot.source,action:'use',item_id:lot.id,payload:{amount:row.amount,version:lot.version}});
  }
  if(body.kind==='transfer'){
   if(!sourceValid(body.target_source)||!uuid.test(body.target_id??''))throw new Error('Destination invalide.');
   if(selected.some(({lot})=>lot.source===body.target_source))throw new Error('Utilisez Frosti ou Cellio pour un transfert dans la même application.');
   await targetFor(name,body.target_source,body.target_id);
   for(const {lot,amount} of selected)actions.push({source:body.target_source,action:'add',item_id:null,payload:lotPayload(lot,amount,body.target_source,body.target_id)});
  }else{
   if(typeof body.label!=='string'||!body.label.trim()||body.label.length>200)throw new Error('Nommez la préparation.');
   if(body.fabrication_date&&!dateValid(body.fabrication_date))throw new Error('Date de fabrication invalide.');
   if(body.recipe_id){if(!uuid.test(body.recipe_id))throw new Error('Recette invalide.');await getRecipeDetailsFromCookiwiki(body.recipe_id)}
   if(body.meal_plan_id){const plan=(await getMealPlans(name)).find(p=>p.id===body.meal_plan_id);if(!plan||plan.recipe_id!==body.recipe_id)throw new Error('Choisissez un repas de ce foyer correspondant à la recette.');const consumed=await findJob(name,operationUuid(`consumption:${name}:${plan.id}`));const {data:event,error}=await mealioServerDb.from('meal_consumption_events').select('status').eq('user_id',name).eq('meal_plan_id',plan.id).maybeSingle();if(error)throw new Error(error.message);if(consumed||event)throw new Error('Ce repas a déjà été traité. Choisissez un autre repas.')}
   if(!Array.isArray(body.outputs)||body.outputs.length<1||body.outputs.length>20)throw new Error('Indiquez de 1 à 20 lots réellement produits.');
   for(const output of body.outputs){
    if(!sourceValid(output.source)||!positive(output.qte)||typeof output.produit!=='string'||!output.produit.trim()||typeof output.categorie!=='string'||!output.categorie.trim()||typeof output.unite!=='string'||!output.unite.trim())throw new Error('Produit, catégorie, quantité et unité obligatoires.');
    if(output.date_peremption&&!dateValid(output.date_peremption))throw new Error('Date de suivi invalide.');
    if(['dlc','ddm'].includes(output.date_role)&&!output.date_peremption)throw new Error('Indiquez une date pour une DLC ou une DDM.');
    if(output.produit.length>200||output.categorie.length>200||output.unite.length>60)throw new Error('Libellé trop long.');
    await targetFor(name,output.source,output.location_id);
    let ingredientName:null|string=null;
    if(output.ingredient_id){if(!uuid.test(output.ingredient_id))throw new Error('Ingrédient invalide.');const {data,error}=await mealioServerDb.from('official_ingredients').select('nom').eq('id',output.ingredient_id).maybeSingle();if(error||!data)throw new Error('Ingrédient officiel introuvable.');ingredientName=data.nom;}
    if(output.content_quantity!=null&&(!positive(output.content_quantity)||!['g','mL','pièce(s)'].includes(output.content_unit)))throw new Error('Contenu par unité invalide.');
    if(!['unknown','dlc','ddm','indicative'].includes(output.date_role??'unknown'))throw new Error('Rôle de la date invalide.');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris'}).format(new Date());
    if(body.recipe_id&&!positive(output.portions_per_unit))throw new Error('Indiquez le nombre de portions par unité produite.')
    actions.push({source:output.source,action:'add',item_id:null,payload:{produit:output.produit.trim(),categorie:output.categorie.trim(),qte:output.qte,unite:output.unite.trim(),date_entree:today,date_fabrication:body.fabrication_date??today,date_peremption:output.date_peremption||null,date_kind:output.date_role==='indicative'?'estimated':'declared',date_role:output.date_role??'unknown',ingredient_id:output.ingredient_id||null,ingredient_name:ingredientName,content_quantity:output.content_quantity??null,content_unit:output.content_quantity==null?null:output.content_unit,product_type:'food',preparation_origin:'homemade',preparation_id:jobId,recipe_id:body.recipe_id||null,portions_per_unit:body.recipe_id?output.portions_per_unit:null,apply_default_expiry:true,notes:output.notes||null,[output.source==='frosti'?'congelo_id':'cellar_id']:output.location_id}});
   }
  }
  const result={label:body.label??'Transfert',recipe_id:body.recipe_id??null,consumed:selected.map(({lot,amount})=>({produit:lot.produit,source:lot.source,qte:amount,unite:lot.unite})),outputs:actions.filter(a=>a.action==='add').map(a=>({source:a.source,...a.payload}))};
  await reserveJob(name,jobId!,body.kind,body,actions,result);return NextResponse.json({job:await runJob(name,jobId!)});
 }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Opération impossible.',job_id:jobId},{status:409})}
}
