import { createHash,randomUUID } from 'node:crypto'
import { mealioServerDb,frostiServerDb,cellioServerDb } from '../lib/supabase-server'
import { stockAction, operationUuid,requireHousehold } from './household-server'
export interface EcosystemAction {source:'frosti'|'cellio';action:'use'|'add';item_id:string|null;payload:Record<string,unknown>}
export interface EcosystemJob {id:string;user_id:string;kind:'transfer'|'preparation'|'consumption';request_hash:string;request:any;actions:EcosystemAction[];result:any;status:'pending'|'processing'|'blocked'|'completed';error?:string|null;created_at?:string;completed_steps?:number;step_results?:any[];overrides?:Record<string,Record<string,unknown>>;repair_log?:any[]}
export async function findJob(username:string,id:string):Promise<EcosystemJob|null>{
 const {data,error}=await mealioServerDb.from('ecosystem_jobs').select('*').eq('user_id',username).eq('id',id).maybeSingle();if(error)throw new Error(error.message);return data;
}
export async function reserveJob(username:string,id:string,kind:EcosystemJob['kind'],request:unknown,actions:EcosystemAction[],result:unknown):Promise<EcosystemJob>{
 const hash=createHash('sha256').update(JSON.stringify(request)).digest('hex');
 const {error}=await mealioServerDb.from('ecosystem_jobs').upsert({id,user_id:username,kind,request_hash:hash,request,actions,result,status:'pending'},{onConflict:'id',ignoreDuplicates:true});
 if(error)throw new Error(error.message);
 const stored=await findJob(username,id);if(!stored||stored.request_hash!==hash||stored.kind!==kind)throw new Error('Identifiant déjà utilisé pour une autre opération.');return stored;
}
export async function claimJob(username:string,id:string){const token=randomUUID();const {data,error}=await mealioServerDb.rpc('mealio_claim_job',{p_user:username,p_id:id,p_token:token});if(error)throw new Error(error.message);if(data!==true)throw new Error('Cette opération est déjà en cours. Réessayez dans deux minutes si elle a été interrompue.');return token}
export async function releaseJob(username:string,id:string,token:string){const {error}=await mealioServerDb.from('ecosystem_jobs').update({lease_token:null,lease_until:null}).eq('id',id).eq('user_id',username).eq('lease_token',token);if(error)throw new Error('Journal enregistré ; verrou à libérer : '+error.message)}
/** Resume the immutable plan. Each source commits and remembers its action atomically. */
export async function executeActions(job:EcosystemJob,apply:(action:EcosystemAction,operation:string)=>Promise<unknown>){
 for(let index=0;index<job.actions.length;index++)await apply(job.actions[index],operationUuid(`${job.id}:${index}`));return job.result;
}
export async function runJob(username:string,id:string):Promise<EcosystemJob>{
 let job=await findJob(username,id);if(!job)throw new Error('Opération introuvable.');if(job.status==='completed')return job;
 const token=await claimJob(username,id)
 try{
 job=(await findJob(username,id))!;if(!job)throw new Error('Opération introuvable.')
 const {error:startError}=await mealioServerDb.from('ecosystem_jobs').update({status:'processing',error:null,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',username).neq('status','completed');if(startError)throw new Error(startError.message);
  if(job.kind==='preparation'&&job.request.meal_plan_id){
   const values={user_id:username,meal_plan_id:job.request.meal_plan_id,recipe_id:job.request.recipe_id,preparation_id:job.id}
   const {error}=await mealioServerDb.from('meal_preparation_links').upsert(values,{onConflict:'user_id,meal_plan_id',ignoreDuplicates:true});if(error)throw new Error(error.message)
   const {data:link,error:readError}=await mealioServerDb.from('meal_preparation_links').select('preparation_id').eq('user_id',username).eq('meal_plan_id',job.request.meal_plan_id).single();if(readError||link?.preparation_id!==job.id)throw new Error('Ce repas est déjà associé à une autre préparation.')
  }
  const household=await requireHousehold(username)
  const receipts:any[]=[]
  await executeActions(job,async(a,op)=>{
   const index=receipts.length
   const payload={...a.payload,...job!.overrides?.[String(index)]}
   let result:any
   if(job!.overrides?.[String(index)]){
    const db=a.source==='frosti'?frostiServerDb:cellioServerDb,owner=a.source==='frosti'?household.frostiUserId:household.cellioUserId
    const {data:receipt,error}=await db.from(`${a.source}_operations`).select('request,result').eq('user_id',owner).eq('operation_id',op).maybeSingle();if(error)throw new Error(error.message)
    if(receipt){
     const canonical=(value:any):string=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v)
     const matches=(p:any)=>canonical(receipt.request)===canonical({action:a.action,item:a.item_id,payload:{...p,origin:'mealio'}})
     if(!matches(a.payload)&&!matches(payload))throw new Error('Le reçu ne correspond pas à cette étape.')
     result=receipt.result
    }
   }
   result??=await stockAction(username,a.source,op,a.action,a.item_id,payload,household)
   receipts.push({index,source:a.source,action:a.action,item_id:a.item_id,result})
   const {error}=await mealioServerDb.from('ecosystem_jobs').update({completed_steps:receipts.length,step_results:receipts,lease_until:new Date(Date.now()+120000).toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',username).neq('status','completed');if(error)throw new Error('Étape effectuée ; journal à finaliser : '+error.message)
   return result
  });
  if(job.kind==='consumption'){const {error}=await mealioServerDb.from('meal_consumption_events').update({status:'confirmed',consumed_items:job.result.consumed,shortages:job.result.shortages}).eq('user_id',username).eq('meal_plan_id',job.request.meal_plan_id);if(error)throw new Error(`Stocks traités ; journal à finaliser : ${error.message}`)}
  const {error}=await mealioServerDb.from('ecosystem_jobs').update({status:'completed',error:null,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',username);if(error)throw new Error(error.message);
  return {...job,status:'completed',error:null,completed_steps:job.actions.length,step_results:receipts};
 }catch(error){
  const message=error instanceof Error?error.message:'Opération interrompue.';
  const {error:journalError}=await mealioServerDb.from('ecosystem_jobs').update({status:'blocked',error:message,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',username).neq('status','completed');
  if(journalError)throw new Error(`${message} Journal indisponible : ${journalError.message}`);throw new Error(message);
 }finally{await releaseJob(username,id,token)}
}
