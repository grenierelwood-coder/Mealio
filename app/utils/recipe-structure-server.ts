import { cookiwikiServerDb } from '../lib/supabase-server'
import { recipeJsonKey } from './recipe-quality-policy'
/** Structures are separate: Cookiwiki keeps classic flat name/qty/unit ingredients. */
export async function loadRecipeStructures(recipeId?:string):Promise<any[]> {
  let query=cookiwikiServerDb.from('mealio_recipe_structures').select('recipe_id,structure,ingredients_snapshot')
  if(recipeId)query=query.eq('recipe_id',recipeId)
  const {data,error}=await query
  if(error){if(['42P01','PGRST205'].includes(error.code))return [];throw new Error(`Structure de recette indisponible : ${error.message}`)}
  return data||[]
}
export function activeRecipeStructure(recipe:any,row:any){
  return row&&recipeJsonKey(recipe.ingredients)===recipeJsonKey(row.ingredients_snapshot)?row.structure:recipe.ingredients
}
