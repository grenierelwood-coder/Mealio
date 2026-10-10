'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { screenHelp } from '../utils/contextual-help'
export default function ContextualHelp(){
 const pathname=usePathname(),help=screenHelp(pathname)
 if(!help)return null
 return <div className="mx-auto w-full max-w-5xl px-3 pt-2"><details key={pathname} className="group rounded-xl open:border open:bg-white open:p-3"><summary className="ml-auto flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-xl border bg-white px-3 text-sm font-bold text-emerald-800">❔ Aide · {help.title}<span aria-hidden="true" className="group-open:rotate-180">▾</span></summary><div className="mt-3 space-y-2 text-sm text-slate-700"><p className="text-xs text-slate-500">Parcours : planifier → acheter → ranger → consulter l’historique.</p><p className="font-bold text-emerald-800">{help.position}</p><p>{help.logic}</p><p>{help.action}</p><div className="flex flex-wrap gap-2"><Link href={help.next.href} className="inline-flex min-h-11 items-center rounded-lg border px-3 font-bold text-emerald-800">{help.next.label} →</Link>{help.extra&&<Link href={help.extra.href} className="inline-flex min-h-11 items-center rounded-lg border px-3 font-bold">{help.extra.label} →</Link>}</div></div></details></div>
}
