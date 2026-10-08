import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'
import { householdInventoryPlaces,loadInventoryReminders } from '../../../utils/inventory-reminder-server'
import { mealioServerDb } from '../../../lib/supabase-server'
export async function GET(){const session=await getAuthSession();if(!session)return NextResponse.json({error:'Non authentifié.'},{status:401});try{return NextResponse.json(await loadInventoryReminders(session.username))}catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Chargement impossible.'},{status:500})}}
export async function PATCH(request:Request){
 const session=await getAuthSession();if(!session)return NextResponse.json({error:'Non authentifié.'},{status:401})
 const b=await request.json().catch(()=>null)
 if(!b||!['configure','complete'].includes(b.action)||!['frosti','cellio'].includes(b.source)||! /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(b.location_id||'')||b.action==='configure'&&!(b.interval_weeks===null||typeof b.interval_weeks==='number'&&Number.isInteger(b.interval_weeks)&&b.interval_weeks>=1&&b.interval_weeks<=104))return NextResponse.json({error:'Lieu et délai valides obligatoires (1 à 104 semaines, ou rappel désactivé).'}, {status:400})
 try{
  const places=await householdInventoryPlaces(session.username);if(!places.some(p=>p.source===b.source&&p.location_id===b.location_id))return NextResponse.json({error:'Ce lieu n’appartient pas au foyer connecté.'},{status:403})
  const {error}=await mealioServerDb.rpc('mealio_set_inventory_reminder',{p_user_id:session.username,p_source:b.source,p_location_id:b.location_id,p_action:b.action,p_interval_weeks:b.action==='configure'?b.interval_weeks:null})
  if(error)throw new Error(error.message)
  return NextResponse.json({ok:true})
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Enregistrement impossible.'},{status:500})}
}
