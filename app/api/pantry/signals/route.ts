import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { setPantrySignal } from '../../../utils/pantry-signals-server'
export async function PATCH(request: Request) {
  const session=await getAuthSession()
  if(!session) return NextResponse.json({error:'Non authentifié.'},{status:401})
  const body=await request.json().catch(()=>null)
  if(!body || typeof body.ingredient_id!=='string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.ingredient_id) ||
    !['almost_finished','cancel','snooze'].includes(body.action)) return NextResponse.json({error:'Produit et action invalides.'},{status:400})
  try {
    await setPantrySignal(session.username,body.ingredient_id,body.action)
    return NextResponse.json({ok:true})
  } catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Enregistrement impossible.'},{status:400})}
}
