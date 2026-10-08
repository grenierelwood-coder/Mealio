/** Purchase rhythm is an estimate, never a stock quantity or measured consumption. */
export interface PantryPurchase {
  ingredient_id: string | null
  quantity: number
  unite: string
  purchased_at: string
  status?: string
}
export interface PantrySignal {
  ingredient_id: string
  kind: 'almost_finished' | 'history_snooze'
  signaled_at: string
  until_date: string | null
}
export interface PurchaseForecast {
  ingredient_id: string
  purchases: number
  interval_days: number
  due_date: string
  alert_date: string
  last_purchased_at: string
}
export function parisDate(value: string | Date): string | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date)
  return `${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}-${parts.find(p=>p.type==='day')!.value}`
}
export function addCalendarDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0,10)
}
export function validPurchase(row: PantryPurchase): boolean {
  return Boolean(row.ingredient_id) && Number.isFinite(Number(row.quantity)) && Number(row.quantity)>0 &&
    ['range','a_ranger'].includes(row.status ?? '') && parisDate(row.purchased_at)!==null
}
export function latestPurchase(events: PantryPurchase[], id: string, now = new Date()): string | null {
  const rows=events.filter(e=>e.ingredient_id===id && validPurchase(e) && Date.parse(e.purchased_at)<=now.getTime())
  return rows.map(e=>e.purchased_at).sort((a,b)=>Date.parse(b)-Date.parse(a))[0] ?? null
}
export function activeAlmostFinished(signal: PantrySignal | undefined, latest: string | null): boolean {
  return Boolean(signal && signal.kind==='almost_finished' && Number.isFinite(Date.parse(signal.signaled_at)) &&
    (!latest || Date.parse(latest)<Date.parse(signal.signaled_at)))
}
export function forecastPurchases(events: PantryPurchase[], id: string, now = new Date()): PurchaseForecast | null {
  const days = [...new Set(events.filter(e=>e.ingredient_id===id && validPurchase(e) && Date.parse(e.purchased_at)<=now.getTime())
    .map(e=>parisDate(e.purchased_at)!))].sort().slice(-7)
  // Four separate shopping days provide at least three completed intervals.
  if(days.length<4) return null
  const intervals=days.slice(1).map((d,i)=>(Date.parse(d)-Date.parse(days[i]))/86400000)
  const sorted=[...intervals].sort((a,b)=>a-b)
  const median=sorted.length%2 ? sorted[Math.floor(sorted.length/2)] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2
  // Daily buying or very irregular/stockpiling histories are not predictive.
  if(median<3 || sorted[sorted.length-1]>sorted[0]*3) return null
  const interval=Math.round(median)
  const due=addCalendarDays(days[days.length-1],interval)
  return {ingredient_id:id,purchases:days.length,interval_days:interval,due_date:due,
    alert_date:addCalendarDays(due,-Math.min(7,Math.max(1,Math.ceil(interval*.2)))),last_purchased_at:latestPurchase(events,id,now)!}
}
