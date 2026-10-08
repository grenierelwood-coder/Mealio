import type { StockSource } from './stock-location-policy'

// APP_URL is the application address, never the Supabase project URL.
export function stockSourceLink(item: { source: StockSource; id: string; location_id?: string | null }): { url: string; precise: boolean } | null {
  const base = item.source === 'frosti' ? (process.env.NEXT_PUBLIC_FROSTI_APP_URL || 'https://frosti-ten.vercel.app/') : (process.env.NEXT_PUBLIC_CELLIO_APP_URL || 'https://cellio-ten.vercel.app/')
  const template = item.source === 'frosti' ? process.env.NEXT_PUBLIC_FROSTI_STOCK_PATH : process.env.NEXT_PUBLIC_CELLIO_STOCK_PATH
  if (!base) return null
  try {
    const origin = new URL(base)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password) return null
    const precise = Boolean(template?.includes('{id}'))
    if (template?.includes('{location_id}') && !item.location_id) return null
    const path = template?.replaceAll('{id}', encodeURIComponent(item.id)).replaceAll('{location_id}', encodeURIComponent(item.location_id || ''))
    const url = new URL(path || origin.href, origin)
    if (url.origin !== origin.origin || url.username || url.password) return null
    return { url: url.href, precise }
  } catch { return null }
}
