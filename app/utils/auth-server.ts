import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

const SESSION_COOKIE = 'mealio_session'
const SESSION_MAX_AGE = 60 * 60 * 24 * 7

type SessionPayload = {
  username: string
  frostiUserId: string
  exp: number
}

function getSessionSecret(): string {
  const secret = process.env.MEALIO_SESSION_SECRET || process.env.FROSTI_SERVICE_ROLE_KEY
  if (!secret) {
    throw new Error('MEALIO_SESSION_SECRET ou FROSTI_SERVICE_ROLE_KEY manquant.')
  }
  return secret
}

function encode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function decode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(data: string): string {
  return createHmac('sha256', getSessionSecret()).update(data).digest('base64url')
}

export function createSessionValue(username: string, frostiUserId: string): string {
  const payload: SessionPayload = {
    username: username.trim(),
    frostiUserId: frostiUserId.trim(),
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  }

  const encoded = encode(JSON.stringify(payload))
  return `${encoded}.${sign(encoded)}`
}

export function verifySessionValue(value: string | undefined): SessionPayload | null {
  if (!value) return null

  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null

  const encoded = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  const expected = sign(encoded)

  try {
    const a = Buffer.from(signature, 'base64url')
    const b = Buffer.from(expected, 'base64url')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }

  try {
    const payload = JSON.parse(decode(encoded)) as Partial<SessionPayload>
    if (
      typeof payload.username !== 'string' ||
      !payload.username.trim() ||
      typeof payload.frostiUserId !== 'string' ||
      !payload.frostiUserId.trim() ||
      typeof payload.exp !== 'number' ||
      payload.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null
    }

    return {
      username: payload.username.trim(),
      frostiUserId: payload.frostiUserId.trim(),
      exp: payload.exp,
    }
  } catch {
    return null
  }
}

export async function getAuthSession(): Promise<SessionPayload | null> {
  const store = await cookies()
  return verifySessionValue(store.get(SESSION_COOKIE)?.value)
}

export async function requireAuth(): Promise<SessionPayload> {
  const session = await getAuthSession()
  if (!session) throw new Error('AUTH_REQUIRED')
  return session
}

export const AUTH_COOKIE_NAME = SESSION_COOKIE
export const AUTH_COOKIE_MAX_AGE = SESSION_MAX_AGE
