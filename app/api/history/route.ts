import { NextResponse } from 'next/server'
import { getAuthSession } from '../../utils/auth-server'
import { getHouseholdHistory } from '../../utils/household-history-server'
export async function GET(){
  const username=(await getAuthSession())?.username?.trim()
  if(!username)return NextResponse.json({error:'Non authentifié.'},{status:401})
  try{return NextResponse.json(await getHouseholdHistory(username),{headers:{'Cache-Control':'private, no-store'}})}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Historique indisponible.'},{status:500})}
}
