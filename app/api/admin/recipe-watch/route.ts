import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { newRecipesForKH } from '../../../utils/recipe-watch-server'
export async function GET(){
 const session=await getAuthSession();if(!session)return NextResponse.json({error:'Non authentifié.'},{status:401})
 if(session.username!=='KH')return NextResponse.json({enabled:false,recipes:[]})
 try{return NextResponse.json({enabled:true,recipes:await newRecipesForKH(session.username)})}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Suivi indisponible.'},{status:500})}
}
