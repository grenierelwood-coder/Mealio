import { NextResponse } from 'next/server'
import { getAuthSession } from '../../../utils/auth-server'

export async function GET() {
  const session = await getAuthSession()

  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 })
  }

  return NextResponse.json({
    authenticated: true,
    username: session.username,
  })
}
