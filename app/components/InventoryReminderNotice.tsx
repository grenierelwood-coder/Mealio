'use client'
import Link from 'next/link'
import { useEffect,useState } from 'react'
import { stockLocationKey } from '../utils/stock-location-policy'
import type { InventoryReminder } from '../utils/inventory-reminder-policy'
export default function InventoryReminderNotice({username,pathname}:{username:string;pathname:string}){
 const [due,setDue]=useState<InventoryReminder[]>([])
 useEffect(()=>{if(!username)return;let active=true;fetch('/api/inventory/reminders',{cache:'no-store'}).then(async r=>{if(!r.ok)return;const d=await r.json();if(active)setDue((d.locations||[]).filter((x:InventoryReminder)=>x.due))}).catch(()=>{});return()=>{active=false}},[username,pathname])
 if(!username||!due.length)return null
 return <aside role="status" className="mx-auto my-3 max-w-5xl rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm"><b>Petit rappel d’inventaire</b>{due.map(l=><p key={stockLocationKey(l.source,l.location_id)} className="mt-2"><Link href={`/inventaire?location=${encodeURIComponent(stockLocationKey(l.source,l.location_id))}`} className="font-bold underline">{l.source==='frosti'?'Frosti':'Cellio'} · {l.name} →</Link> · délai de {l.interval_weeks} semaine(s) atteint</p>)}<p className="mt-2 text-xs">Tu peux continuer à utiliser Mealio. Le délai se règle dans Inventaire, pour chaque lieu.</p></aside>
}
