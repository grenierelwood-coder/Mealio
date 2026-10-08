'use client'
import Link from 'next/link'
import { useEffect,useState } from 'react'
export default function RecipeWatchNotice({username,pathname}:{username:string;pathname:string}){
 const [recipes,setRecipes]=useState<{id:string;title:string}[]>([]),[error,setError]=useState('')
 useEffect(()=>{if(username!=='KH')return;let active=true;fetch('/api/admin/recipe-watch',{cache:'no-store'}).then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);if(active){setRecipes(d.recipes||[]);setError('')}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[username,pathname])
 if(username!=='KH'||(!recipes.length&&!error))return null
 return <aside role="status" className="mx-auto my-3 max-w-5xl rounded-xl border border-indigo-300 bg-indigo-50 p-3 text-sm">{error?<p>{error}</p>:<><b>KH · {recipes.length} nouvelle(s) recette(s) Cookiwiki à tester</b><p className="mt-1">{recipes.slice(0,3).map(r=>r.title).join(' · ')}{recipes.length>3?'…':''}</p><Link href="/admin/integration?new=1" className="mt-2 inline-block min-h-11 rounded-lg bg-indigo-700 px-3 py-3 font-bold text-white">Tester les nouvelles recettes →</Link></>}</aside>
}
