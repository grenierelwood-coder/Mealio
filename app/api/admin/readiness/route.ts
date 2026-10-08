import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { productionReadiness } from '../../../utils/production-readiness-server'
export async function GET(){const session=await getAuthSession();if(!session)return NextResponse.json({error:'Non authentifié.'},{status:401});try{return NextResponse.json(await productionReadiness(session.username))}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Contrôle impossible.'},{status:500})}}
