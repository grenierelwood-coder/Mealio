import { createHash } from 'node:crypto'
import { mealioServerDb } from '../lib/supabase-server'
type Candidate={item:{produit:string;source?:string}}
export function stockAnalysisKey(ingredientId:string,referenceSignature:string,candidates:Candidate[]){
 const labels=[...new Set(candidates.map(c=>JSON.stringify([c.item.produit.normalize('NFD').toLowerCase().trim(),c.item.source||''])))].sort()
 return createHash('sha256').update(JSON.stringify(['stock-v1220',ingredientId,referenceSignature,labels])).digest('hex')
}
export type StockAnalysis={case_key:string;matched_label:string|null;matched_source:string|null;confidence:number;reason:string}
export async function readStockAnalysis(key:string):Promise<StockAnalysis|null>{
 const {data,error}=await mealioServerDb.from('matcher_stock_analysis_cache').select('case_key,matched_label,matched_source,confidence,reason').eq('case_key',key).maybeSingle()
 if(error){if(['42P01','PGRST205'].includes(error.code))return null;throw new Error(`Lecture mémoire d’analyse impossible : ${error.message}`)}
 return data
}
export async function writeStockAnalysis(row:StockAnalysis){
 const {error}=await mealioServerDb.from('matcher_stock_analysis_cache').upsert(row,{onConflict:'case_key'})
 if(error&&!['42P01','PGRST205'].includes(error.code))throw new Error(`Enregistrement mémoire d’analyse impossible : ${error.message}`)
}
