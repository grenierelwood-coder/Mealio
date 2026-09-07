'use client'

import { useState } from 'react'
import { frostiDb } from '../lib/supabase'
import { useRouter } from 'next/navigation'

// Mealio n'a pas sa propre table d'utilisateurs : un foyer Mealio correspond
// exactement à un compte app_users déjà existant dans Frosti (cf. cahier
// des charges §2). On vérifie donc les identifiants directement contre la
// base Frosti via son client anon déjà configuré dans lib/supabase.tsx.

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data, error } = await frostiDb
      .from('app_users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single()

    if (error || !data) {
      setError('Identifiant ou mot de passe incorrect.')
      setLoading(false)
    } else {
      // Cookie ET localStorage (le localStorage sert de secours sur mobile
      // — cf. le bug qu'on avait rencontré et corrigé côté Frosti).
      document.cookie = `congelo_user_id=${data.id}; path=/; max-age=86400`
      document.cookie = `congelo_username=${data.username}; path=/; max-age=86400`
      localStorage.setItem('congelo_user_id', data.id)
      localStorage.setItem('congelo_username', data.username)

      router.push('/')
    }
  }

  return (
    <div className="flex flex-col justify-center items-center min-h-screen p-4 bg-gray-50">
      <div className="w-full max-w-sm p-6 bg-white rounded-2xl shadow-lg">
        <h1 className="text-2xl font-bold text-center text-emerald-600 mb-6">Mealio 🍽️</h1>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom d'utilisateur</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-black"
              placeholder="ex: papa"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mot de passe</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 pr-11 border rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-black"
                placeholder="••••••••"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                title={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                tabIndex={-1}
              >
                {showPassword ? '🙈' : '👁️'}
              </button>
            </div>
          </div>

          {error && <p className="text-red-500 text-sm text-center">{error}</p>}

          <div className="pt-4">
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 text-white py-2 rounded-lg font-medium hover:bg-emerald-700 transition"
            >
              {loading ? 'Connexion...' : 'Se connecter'}
            </button>
          </div>
        </form>

        <p className="text-xs text-center text-gray-400 mt-4">
          Utilise les mêmes identifiants que sur Frosti.
        </p>
      </div>
    </div>
  )
}
