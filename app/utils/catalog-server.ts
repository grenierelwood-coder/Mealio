import {mealioServerDb} from '../lib/supabase-server'
export async function catalogRows(table:'official_ingredients'|'ingredient_synonyms',columns:string){
 const rows:any[]=[];for(let offset=0;offset<50000;offset+=500){const {data,error}=await mealioServerDb.from(table).select(columns).order('id').range(offset,offset+499);if(error)throw new Error(`Référentiel ${table} indisponible : ${error.message}`);rows.push(...(data??[]));if(!data||data.length<500)return rows}throw new Error('Référentiel trop volumineux.')
}
