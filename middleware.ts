import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const userId = request.cookies.get('congelo_user_id')?.value

  if (!userId && !request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

// Exclut : les routes API (chacune vérifie elle-même le cookie — voir
// shopping-list-generate-route.ts — pour renvoyer un vrai 401 JSON plutôt
// qu'une redirection HTML inexploitable par un appel fetch), les assets
// Next.js, le favicon, et tous les fichiers statiques par extension
// (sw.js, manifest.json, icônes...) — cf. le bug identifié et corrigé sur
// Frosti où le Service Worker était bloqué par ce même middleware.
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|json|js|webmanifest|txt)$).*)',
  ],
}
