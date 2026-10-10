import { addCalendarDays, forecastPurchases, parisDate, type PantryPurchase } from './pantry-history-policy'

export interface HistoryPurchase extends PantryPurchase {
  id: string; produit: string; list_id: string; storage: string | null; location_name: string | null
}
export interface HistoryNeed {
  ingredient_id: string | null; produit: string; quantity: number | null; unite: string
  presence: boolean; warning?: string
}
export interface HistoryMeal {
  id: string; recipe_id: string; recipe_nom: string; scheduled_date: string; servings: number
  meal_type: string; origin: 'planning' | 'confirmed' | 'skipped' | 'processing'
  needs: HistoryNeed[]
}
export interface HistoryConsumption {
  id: string; date: string; recipe_nom: string; produit: string; quantity: number; unite: string; source: string
}
export interface HistoryRecommendation {
  key: string; kind: 'threshold' | 'recurring'; ingredient_id: string; produit: string; unite: string
  quantity: number; minimum: number; interval_days: number; next_due_date: string; reason: string
}
export interface HistoryAnalysis {
  from: string; to: string; weeks: number
  needs: Array<{ ingredient_id: string; produit: string; presence: boolean; unite: string; total: number; weekly: number; weeks_used: number; meals: number; incomplete: boolean }>
  recipes: Array<{ recipe_id: string; nom: string; count: number; last_date: string; interval_days: number | null }>
  recommendations: HistoryRecommendation[]
}
export interface HistoryData {
  household: string; today: string; purchases: HistoryPurchase[]; meals: HistoryMeal[]
  consumptions: HistoryConsumption[]; analysis: HistoryAnalysis; warnings: string[]; canActivate: boolean
}
export function validHistoryDay(day: string): boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return false
  const date=new Date(`${day}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === day
}
export function isPastMeal(day: string, today: string): boolean {
  try { return validHistoryDay(day) && day < today } catch { return false }
}
export function historySearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
}
export function roundedRuleQuantity(quantity: number, unit: string): number {
  const whole = /^(pi[eè]ce|gousse|tranche|bouquet|sachet|pot|bouteille|paquet|bo[iî]te|brin|feuille|rouleau)$/i.test(unit)
  return whole ? Math.ceil(quantity) : Math.ceil(quantity * 100) / 100
}
/** All input is already scoped by the server. Planned demand is never measured consumption. */
export function analyseHistory(
  meals: HistoryMeal[], purchases: HistoryPurchase[], today: string,
  products: Array<{id:string;nom:string;unite:string;presence:boolean;pack:number;packUnit:string}>,
  existing: Set<string>, hidden: Set<string>, now=new Date(`${today}T23:59:59Z`),
): HistoryAnalysis {
  const end = addCalendarDays(today,-1), windowStart = addCalendarDays(today,-84)
  const validMeals = meals.filter(m=>['planning','confirmed'].includes(m.origin) && isPastMeal(m.scheduled_date,today))
  const purchaseDates = purchases.filter(p=>['range','a_ranger'].includes(p.status||'') && Number(p.quantity)>0)
    .map(p=>parisDate(p.purchased_at)).filter((d):d is string=>Boolean(d && d<today))
  const first = [...validMeals.map(m=>m.scheduled_date),...purchaseDates].sort()[0] || today
  const from = first > windowStart ? first : windowStart
  const days = Math.max(0,(Date.parse(today)-Date.parse(from))/86400000), weeks=days/7
  const needs = new Map<string,HistoryAnalysis['needs'][number] & {used:Set<number>}>()
  const recipes = new Map<string,{recipe_id:string;nom:string;count:number;dates:string[]}>()
  // A monthly recipe needs more than a 12-week demand window to establish its rhythm.
  for(const meal of validMeals.filter(m=>m.scheduled_date>=addCalendarDays(today,-365))){
    const r=recipes.get(meal.recipe_id)||{recipe_id:meal.recipe_id,nom:meal.recipe_nom,count:0,dates:[]}
    r.count++;r.dates.push(meal.scheduled_date);recipes.set(meal.recipe_id,r)
  }
  for (const meal of validMeals.filter(m=>m.scheduled_date>=from)) {
    const inMeal=new Set<string>()
    for(const n of meal.needs){
      if(!n.ingredient_id)continue
      const a=needs.get(n.ingredient_id)||{ingredient_id:n.ingredient_id,produit:n.produit,presence:n.presence,unite:n.unite,total:0,weekly:0,weeks_used:0,meals:0,incomplete:false,used:new Set<number>()}
      if(!inMeal.has(n.ingredient_id)){a.meals++;inMeal.add(n.ingredient_id)}
      if(n.warning || (!n.presence && (n.quantity===null || !Number.isFinite(n.quantity))))a.incomplete=true
      else if(!n.presence)a.total+=n.quantity!
      a.used.add(Math.floor((Date.parse(meal.scheduled_date)-Date.parse(from))/(7*86400000)))
      needs.set(n.ingredient_id,a)
    }
  }
  const needsList=[...needs.values()].map(({used,...n})=>({...n,weeks_used:used.size,weekly:weeks>0?n.total/weeks:0})).sort((a,b)=>b.meals-a.meals)
  const recommendations:HistoryRecommendation[]=[]
  for(const p of products){
    if(existing.has(p.id))continue
    const n=needsList.find(n=>n.ingredient_id===p.id)
    const key=`threshold:${p.id}`
    if(!p.presence && n && !n.incomplete && days>=28 && n.weeks_used>=4 && n.weekly>0 && p.unite && !hidden.has(key)){
      const minimum=roundedRuleQuantity(n.weekly,p.unite), quantity=Math.max(roundedRuleQuantity(n.weekly*2,p.unite),minimum+roundedRuleQuantity(1,p.unite))
      recommendations.push({key,kind:'threshold',ingredient_id:p.id,produit:p.nom,unite:p.unite,minimum,quantity,interval_days:7,next_due_date:today,
        reason:`${n.meals} repas sur ${Math.round(days)} jours : besoin moyen estimé de ${Number(n.weekly.toFixed(2))} ${p.unite}/semaine. Seuil proposé : une semaine ; cible : deux semaines. Le stock réel déterminera ce qu’il manque.`})
      continue
    }
    const forecast=forecastPurchases(purchases.filter(row=>(parisDate(row.purchased_at)||'')>=addCalendarDays(today,-365)),p.id,now)
    const recurringKey=`recurring:${p.id}`
    // Purchase format is taken from the household pantry policy, never guessed from recipe doses.
    if(p.presence && forecast && forecast.interval_days<=366 && (parisDate(forecast.last_purchased_at)||'')>=addCalendarDays(today,-90) && p.pack>0 && p.packUnit && !hidden.has(recurringKey)){
      recommendations.push({key:recurringKey,kind:'recurring',ingredient_id:p.id,produit:p.nom,unite:p.packUnit,minimum:0,quantity:p.pack,
        interval_days:forecast.interval_days,next_due_date:forecast.due_date<today?today:forecast.due_date,
        reason:`${forecast.purchases} jours d’achat distincts : intervalle habituel de ${forecast.interval_days} jours. Format d’achat du foyer. Ce rythme ne mesure pas la quantité consommée.`})
    }
  }
  return {from,to:end,weeks,needs:needsList,recipes:[...recipes.values()].map(r=>{
    const dates=[...new Set(r.dates)].sort(), gaps=dates.slice(1).map((d,i)=>(Date.parse(d)-Date.parse(dates[i]))/86400000).sort((a,b)=>a-b)
    const regular=gaps.length>=3 && gaps[0]>0 && gaps[gaps.length-1]<=gaps[0]*3
    return {recipe_id:r.recipe_id,nom:r.nom,count:r.count,last_date:dates[dates.length-1],interval_days:regular?Math.round(gaps[Math.floor(gaps.length/2)]):null}
  }).sort((a,b)=>b.count-a.count),recommendations}
}
