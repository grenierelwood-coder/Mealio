import { mealioServerDb,cookiwikiServerDb } from '../lib/supabase-server'
export type WatchedRecipe={id:string;title:string}
/** This helper never queries either database for another household. */
export async function newRecipesForKH(username:string):Promise<WatchedRecipe[]>{
 if(username!=='KH')return []
 const {data:checked,error}=await mealioServerDb.from('cookiwiki_recipe_checks').select('recipe_id').eq('user_id','KH')
 if(error)throw new Error('Suivi des nouvelles recettes indisponible. Vérifier le SQL Mealio 1.2.21.')
 const known=new Set((checked||[]).map(r=>r.recipe_id));const fresh:WatchedRecipe[]=[]
 for(let offset=0;offset<10000;offset+=500){const {data,error}=await cookiwikiServerDb.from('recipes').select('id,title').order('id').range(offset,offset+499);if(error)throw new Error(`Lecture Cookiwiki impossible : ${error.message}`);for(const r of data||[])if(!known.has(r.id))fresh.push(r);if((data||[]).length<500)return fresh}
 throw new Error('Bibliothèque supérieure à 10 000 recettes : adapter le suivi avant de conclure.')
}
export async function recordRecipeAnalysis(username:string,recipeId:string):Promise<string|null>{
 if(username!=='KH')return null
 const {error}=await mealioServerDb.from('cookiwiki_recipe_checks').upsert({user_id:'KH',recipe_id:recipeId,tested_at:new Date().toISOString()},{onConflict:'user_id,recipe_id'})
 return error?'Analyse terminée, mais suivi des nouvelles recettes non enregistré. Vérifier le SQL Mealio 1.2.21.':null
}
