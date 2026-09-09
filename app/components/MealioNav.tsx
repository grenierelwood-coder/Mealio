'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const links = [
  { href: '/planning', label: '📅 Planning' },
  { href: '/courses', label: '🛒 Courses' },
  { href: '/purchases', label: '🧾 Achats' },
  { href: '/stock', label: '❄️ Stock' },
  { href: '/admin', label: '⚙️ Admin' },
]

export default function MealioNav() {
  const pathname = usePathname()
  const router = useRouter()
  const [username, setUsername] = useState('KH')

  useEffect(() => {
    setUsername(localStorage.getItem('congelo_username') || 'KH')
  }, [])

  if (pathname === '/login') return null

  function logout() {
    document.cookie = 'congelo_user_id=; path=/; max-age=0'
    document.cookie = 'congelo_username=; path=/; max-age=0'
    localStorage.removeItem('congelo_user_id')
    localStorage.removeItem('congelo_username')
    router.push('/login')
  }

  return (
    <header className="sticky top-0 z-[100] border-b border-stone-200 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2.5 sm:px-5">
        <Link href="/" className="shrink-0 text-xl font-black tracking-tight text-emerald-700 sm:text-2xl">
          Mealio
        </Link>

        <nav className="min-w-0 flex-1 overflow-x-auto">
          <div className="flex min-w-max items-center gap-1 text-xs font-bold sm:gap-2 sm:text-sm">
            {links.map(link => {
              const active = link.href === '/'
                ? pathname === '/'
                : pathname === link.href || pathname.startsWith(`${link.href}/`)
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`whitespace-nowrap rounded-xl px-2.5 py-2 transition sm:px-3 ${active ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100 hover:text-emerald-700'}`}
                >
                  {link.label}
                </Link>
              )
            })}
          </div>
        </nav>

        <div className="hidden shrink-0 items-center gap-3 sm:flex">
          <span className="text-xs text-slate-500">Bonjour <b>{username}</b></span>
          <button onClick={logout} className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold hover:bg-stone-50">
            Déconnexion
          </button>
        </div>
      </div>
    </header>
  )
}
