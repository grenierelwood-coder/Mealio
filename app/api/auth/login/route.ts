import { NextResponse } from 'next/server'
import { frostiServerDb } from '../../../lib/supabase-server'
import { AUTH_COOKIE_MAX_AGE, AUTH_COOKIE_NAME, createSessionValue } from '../../../utils/auth-server'

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Corps JSON invalide.' }, { status: 400 })
  }

  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!username || !password) {
    return NextResponse.json({ error: 'Identifiant et mot de passe requis.' }, { status: 400 })
  }

  const { data, error } = await frostiServerDb
    .from('app_users')
    .select('id, username')
    .eq('username', username)
    .eq('password', password)
    .maybeSingle()

  if (error) {
    console.error('❌ Erreur authentification Frosti :', error)
    return NextResponse.json({ error: 'Service d’authentification indisponible.' }, { status: 500 })
  }

  if (!data?.id || !data?.username) {
    return NextResponse.json({ error: 'Identifiant ou mot de passe incorrect.' }, { status: 401 })
  }

  const response = NextResponse.json({
    ok: true,
    username: data.username,
  })

  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: createSessionValue(data.username, data.id),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_COOKIE_MAX_AGE,
  })

  return response
}
