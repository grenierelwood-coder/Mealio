'use client'
import Link from 'next/link'
import { useEffect,useState } from 'react'
export default function HistoryRecommendationNotice(){
 const [count,setCount]=useState<number|null>(null)
 useEffect(()=>{let active=true;fetch('/api/history',{cache:'no-store'}).then(async r=>{if(!r.ok)return;const body=await r.json();if(active)setCount(body.analysis?.recommendations?.length||0)}).catch(()=>{});return()=>{active=false}},[])
 return <aside className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-950"><p className="font-bold">{count?`${count} nouvelle(s) règle(s) proposée(s) à partir de vos habitudes`:'Apprendre de vos achats et des repas passés'}</p><p className="mt-1 text-sm">Les propositions sont propres au foyer. Aucune règle n’est activée sans votre choix.</p><Link href="/history?tab=analysis" className="mt-2 inline-flex min-h-12 items-center rounded-xl border border-indigo-200 bg-white px-3 font-bold">{count===null?'Voir les analyses et recommandations →':count?'Vérifier les propositions →':'Consulter l’historique et les analyses →'}</Link></aside>
}
