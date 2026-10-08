import { cleanRecipeName } from '../../../utils/recipe-presence-policy'
import { loadReferenceData } from '../../../utils/matcher'
import proposals from '../../../../tests/fixtures/recipe-corrections-v1212.json'
import { activeRecipeStructure, loadRecipeStructures } from '../../../utils/recipe-structure-server'
import { NextResponse } from 'next/server'
import { cookiwikiServerDb } from '../../../lib/supabase-server'
import { getAuthSession } from '../../../utils/auth-server'
import { validateRecipeLines } from '../../../utils/recipe-quality-policy'

export async function GET() {
  const session=await getAuthSession();if (!session) return NextResponse.json({error:'Non authentifié.'},{status:401})
  const {data,error} = await cookiwikiServerDb.from('recipes').select('id,title,servings,ingredients,instructions').order('title').limit(1000)
  if(error) return NextResponse.json({error:error.message},{status:500})
  try {const [rows,ref]=await Promise.all([loadRecipeStructures(),loadReferenceData(session.username)]);const presenceNames=[...ref.officialList.filter(i=>ref.pantryProducts?.get(i.id)?.enabled).map(i=>cleanRecipeName(i.nom)),...[...ref.synonymMap].filter(([,id])=>ref.pantryProducts?.get(id)?.enabled).map(([name])=>cleanRecipeName(name))];const byId=new Map(rows.map(row=>[row.recipe_id,row]));return NextResponse.json({presenceNames,household:session.username,recipes:(data||[]).map((recipe:any)=>({...recipe,proposal:proposals.find(p=>p.id===recipe.id)?.ingredients,expectedIngredients:recipe.ingredients,expectedStructure:byId.get(recipe.id)?.structure??null,ingredients:activeRecipeStructure(recipe,byId.get(recipe.id))})),truncated:(data||[]).length===1000})} catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Lecture impossible.'},{status:500})}
}
export async function PATCH(request: Request) {
  const session=await getAuthSession()
  if(!session) return NextResponse.json({error:'Non authentifié.'},{status:401})
  const body=await request.json().catch(()=>null)
  if(!body || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(String(body.id||'')) || !Object.hasOwn(body,'expectedIngredients')) return NextResponse.json({error:'Recette et version initiale obligatoires.'},{status:400})
  try {validateRecipeLines(body.ingredients)} catch(error) {return NextResponse.json({error:error instanceof Error?error.message:'Ingrédients invalides.'},{status:400})}
  const {data,error}=await cookiwikiServerDb.rpc('mealio_update_recipe_ingredients',{
    p_recipe_id:body.id,p_expected:{ingredients:body.expectedIngredients,structure:body.expectedStructure??null},p_next:body.ingredients,p_username:session.username,
  })
  if(error) return NextResponse.json({error:/RECIPE_CONFLICT/.test(error.message)?'La recette a été modifiée ailleurs. Actualiser avant de recommencer.':`Sauvegarde impossible : ${error.message}`},{status:/RECIPE_CONFLICT/.test(error.message)?409:500})
  return NextResponse.json({recipe:data})
}
