import {getMealPlans} from '../../utils/meal-planner-server'
import {assertSameOrigin} from '../../utils/ecosystem-policy'
import {findJob} from '../../utils/ecosystem-jobs-server'
import {operationUuid} from '../../utils/household-server'
import { getAuthSession } from '../../utils/auth-server'
import { NextResponse } from 'next/server'
import {
  getPendingMealConsumptions,
  confirmMealConsumption,prepareConsumptionForPlan,consumptionPreviewKey,
} from '../../utils/meal-consumption-server'

async function getUsername() {
  return (await getAuthSession())?.username?.trim() || null
}

export async function GET(request?:Request) {
  const username = await getUsername()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    const id=request?new URL(request.url).searchParams.get('meal_plan_id'):null;
    if(id){const plan=(await getMealPlans(username)).find(p=>p.id===id);if(!plan)throw new Error('Repas introuvable.');const stored=await findJob(username,operationUuid(`consumption:${username}:${id}`));const proposal=stored?{result:stored.result,actions:stored.actions}:await prepareConsumptionForPlan(username,plan);return NextResponse.json({preview:proposal.result,preview_key:consumptionPreviewKey(proposal.actions)});}
    const pending = await getPendingMealConsumptions(username)
    return NextResponse.json({ pending })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const username = await getUsername()
  if (!username) return NextResponse.json({ error: 'Non authentifié.' }, { status: 401 })

  try {
    assertSameOrigin(request);
    const body = await request.json()
    if(typeof body.confirmed!=='boolean')throw new Error('Choisissez Oui ou Non.')
    if (!body.meal_plan_id) return NextResponse.json({ error: 'meal_plan_id obligatoire.' }, { status: 400 })
    const result = await confirmMealConsumption(username, String(body.meal_plan_id), body.confirmed === true,body.preview_key)
    return NextResponse.json({ result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erreur interne.' }, { status: 400 })
  }
}
