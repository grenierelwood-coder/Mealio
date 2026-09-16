'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

const links = [
  { href: '/planning', label: 'Planning', icon: '📅' },
  { href: '/courses', label: 'Courses', icon: '🛒' },
  { href: '/purchases', label: 'Achats', icon: '🧾' },
  { href: '/stock', label: 'Stock', icon: '📦' },
  { href: '/anti-gaspi', label: 'Anti-Gaspi', icon: '🥕' },
  { href: '/replenishment', label: 'Ravitaillement', icon: '🔄' },
  { href: '/point-frigo', label: 'Point Frigo', icon: '🧊' },
  { href: '/admin', label: 'Administration', icon: '⚙️' },
  { href: '/admin/storage', label: 'Rangement', icon: '🗄️' },
  { href: '/matcher', label: 'Matcher', icon: '🧠' },
]

const bottomLinks = [
  { href: '/', label: 'Accueil', icon: '⌂' },
  { href: '/planning', label: 'Planning', icon: '📅' },
  { href: '/courses', label: 'Courses', icon: '🛒' },
  { href: '/anti-gaspi', label: 'Anti-Gaspi', icon: '🥕' },
]

export default function MealioNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [username, setUsername] = useState('')

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) return null
        return response.json()
      })
      .then(data => {
        if (!cancelled) setUsername(data?.username ?? '')
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [pathname])

  const activeHref = useMemo(() => {
    const exact = links.find(link => pathname === link.href)
    if (exact) return exact.href
    const nested = links.find(link => pathname.startsWith(`${link.href}/`))
    return nested?.href ?? (pathname === '/' ? '/' : '')
  }, [pathname])

  if (pathname === '/login') return null

  async function logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      router.push('/login')
      router.refresh()
    }
  }

  function go(href: string) {
    setDrawerOpen(false)
    router.push(href)
  }

  return (
    <>
      <header className="sticky top-0 z-[100] border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <div className="mx-auto flex h-[64px] max-w-7xl items-center gap-3 px-3 sm:px-5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white ring-1 ring-slate-200 shadow-sm active:scale-95"
            aria-label="Ouvrir le menu Mealio"
          >
            <img
              src="/mealio-logo.png"
              alt="Mealio"
              className="h-10 w-10 rounded-xl object-contain"
            />
          </button>

          <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-hidden lg:flex">
            {links.slice(0, 9).map(link => {
              const active = activeHref === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`whitespace-nowrap rounded-xl px-2.5 py-2 text-xs font-bold transition ${active ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100 hover:text-emerald-700'}`}
                >
                  {link.icon} {link.label}
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto hidden shrink-0 items-center gap-3 sm:flex">
            {username && <span className="text-xs text-slate-500">{username}</span>}
            <button
              type="button"
              onClick={logout}
              className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              Déconnexion
            </button>
          </div>

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-xl text-xl text-slate-600 hover:bg-slate-100 lg:hidden"
            aria-label="Ouvrir le menu"
          >
            ⋯
          </button>
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-[90] border-t border-slate-200 bg-white/96 px-1 pb-[max(6px,env(safe-area-inset-bottom))] pt-1 shadow-[0_-4px_18px_rgba(15,23,42,0.06)] backdrop-blur lg:hidden">
        <div className="mx-auto grid max-w-xl grid-cols-5 gap-1">
          {bottomLinks.map(link => {
            const active = link.href === '/'
              ? pathname === '/'
              : pathname === link.href || pathname.startsWith(`${link.href}/`)
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex min-h-[58px] flex-col items-center justify-center rounded-xl px-1 text-[10px] font-bold ${active ? 'bg-emerald-50 text-emerald-700' : 'text-slate-500'}`}
              >
                <span className="text-lg leading-5">{link.icon}</span>
                <span className="mt-0.5 truncate">{link.label}</span>
              </Link>
            )
          })}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex min-h-[58px] flex-col items-center justify-center rounded-xl px-1 text-[10px] font-bold text-slate-500"
            aria-label="Ouvrir Plus"
          >
            <span className="text-lg leading-5">•••</span>
            <span className="mt-0.5">Plus</span>
          </button>
        </div>
      </nav>

      {drawerOpen && (
        <div className="fixed inset-0 z-[200]">
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-slate-950/35"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[min(88vw,360px)] flex-col bg-white shadow-2xl">
            <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
              <img src="/mealio-logo.png" alt="Mealio" className="h-12 w-12 rounded-2xl object-contain ring-1 ring-slate-100" />
              <div className="min-w-0 flex-1">
                <div className="font-black text-slate-900">{username || 'Mealio'}</div>
                <div className="text-xs text-slate-500">Mon foyer</div>
              </div>
              <button type="button" onClick={() => setDrawerOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-xl text-2xl text-slate-500 hover:bg-slate-100" aria-label="Fermer">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 pb-6">
              <button
                type="button"
                onClick={() => go('/')}
                className={`mb-1 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold ${pathname === '/' ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-50'}`}
              >
                <span className="w-6 text-center">⌂</span> Accueil
              </button>
              {links.map(link => (
                <button
                  key={link.href}
                  type="button"
                  onClick={() => go(link.href)}
                  className={`mb-1 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-bold ${activeHref === link.href ? 'bg-emerald-50 text-emerald-700' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="w-6 text-center">{link.icon}</span>
                  {link.label}
                </button>
              ))}
            </div>

            <div className="border-t border-slate-200 p-3">
              <button type="button" onClick={logout} className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-left text-sm font-bold text-slate-600">
                ⇥ Déconnexion
              </button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}
