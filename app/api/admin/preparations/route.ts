import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { mealioServerDb } from '../../../lib/supabase-server'
import { loadIngredientPreparations } from '../../../utils/ingredient-preparations-server'
export async function GET(){
 const session=await getAuthSession();if(!session)return NextResponse.json({error:'Non authentifié.'},{status:401})
 try{const preparations=await loadIngredientPreparations(session.username);const {data,error}=await mealioServerDb.from('official_ingredients').select('id,nom');if(error)throw new Error(error.message);return NextResponse.json({preparations:[...preparations.values()].map(p=>({...p,nom:data?.find(i=>i.id===p.ingredient_id)?.nom||'Préparation'}))})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Lecture impossible.'},{status:500})}
}
export async function PATCH(request:Request){
 const session=await getAuthSession();if(!session)return NextResponse.json({error:'Non authentifié.'},{status:401})
 const body=await request.json().catch(()=>null);if(!body||typeof body.ingredient_id!=='string'||typeof body.enabled!=='boolean')return NextResponse.json({error:'Ingrédient et choix requis.'},{status:400})
 const {data,error}=await mealioServerDb.from('household_ingredient_preparations').update({enabled:body.enabled}).eq('user_id',session.username).eq('ingredient_id',body.ingredient_id).select('ingredient_id,enabled').maybeSingle()
 if(error)return NextResponse.json({error:error.message},{status:500});if(!data)return NextResponse.json({error:'Préparation non configurée pour ce foyer. Exécuter le SQL de cette version.'},{status:404})
 return NextResponse.json({preparation:data})
}
