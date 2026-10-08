import { mealioServerDb } from '../lib/supabase-server'
import { getAuthSession } from './auth-server'
export type IngredientPreparation={ingredient_id:string;enabled:boolean;components:{name:string;qty:number;unit:string}[]}
/** Household choice: a fixed composition per base recipe, scaled with its servings. */
export async function loadIngredientPreparations(username?:string):Promise<Map<string,IngredientPreparation>>{
 const household=username??(await getAuthSession())?.username
 if(!household)return new Map()
 const {data,error}=await mealioServerDb.from('household_ingredient_preparations').select('ingredient_id,enabled,components').eq('user_id',household)
 if(error){if(['42P01','PGRST205'].includes(error.code))return new Map();throw new Error(`Préparations maison indisponibles : ${error.message}`)}
 const result=new Map<string,IngredientPreparation>()
 for(const row of data||[]){if(typeof row.ingredient_id!=='string'||typeof row.enabled!=='boolean'||!Array.isArray(row.components)||!row.components.length||row.components.some((c:any)=>typeof c.name!=='string'||!c.name.trim()||!Number.isFinite(c.qty)||c.qty<0||typeof c.unit!=='string'))throw new Error('Composition maison invalide. Vérifier les réglages du foyer.');result.set(row.ingredient_id,row)}
 return result
}
