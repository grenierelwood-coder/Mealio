// Claude côté SERVEUR uniquement.
// Ce fichier ne doit jamais être importé depuis un composant client.

export interface ClaudeCandidate {
  id: string
  label: string
  lexicalScore?: number
  metadata?: Record<string, unknown>
}

export interface ClaudeMatchResponse {
  matched: string | null
  confidence: number
  reason: string
}

function extractJson(text: string): any | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0])
  } catch {
    return null
  }
}

async function callClaude(prompt: string): Promise<string | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('⚠️ ANTHROPIC_API_KEY absente — fallback IA désactivé.')
    return null
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 220,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    console.error(`❌ Claude HTTP ${response.status}: ${body.slice(0, 500)}`)
    return null
  }

  const data = await response.json()
  const blocks = Array.isArray(data?.content) ? data.content as Array<{ type?: string; text?: string }> : []
  const textBlock = blocks.find(b => b.type === 'text')
  return textBlock?.text?.trim() || null
}

export async function resolveOfficialIngredientWithClaude(
  rawName: string,
  candidates: ClaudeCandidate[],
): Promise<ClaudeMatchResponse> {
  const candidateList = candidates.map((c, i) => ({
    rank: i + 1,
    id: c.id,
    nom: c.label,
    score_lexical: c.lexicalScore,
  }))

  const prompt = `
Tu es le moteur de résolution des ingrédients de Mealio.

Ingrédient brut extrait d'une recette :
"${rawName}"

Tu dois choisir uniquement parmi les candidats ci-dessous.

${JSON.stringify(candidateList, null, 2)}

Règles :
- Choisis le candidat réellement équivalent à l'ingrédient demandé.
- La marque et le conditionnement ne comptent pas.
- Ne confonds pas deux ingrédients simplement parce qu'ils appartiennent à la même famille.
- Respecte les caractéristiques discriminantes : rouge/vert, chèvre/brebis, coco/amande, etc.
- Si aucun candidat n'est suffisamment équivalent, réponds AUCUN.
- Ne crée jamais un ingrédient qui n'est pas dans la liste.

Réponds UNIQUEMENT avec :
{"match":"ID exact du candidat ou AUCUN","confidence":0.00,"reason":"courte raison"}
`

  try {
    const answer = await callClaude(prompt)
    if (!answer) return { matched: null, confidence: 0, reason: 'IA indisponible' }

    const parsed = extractJson(answer)
    if (!parsed || !parsed.match || String(parsed.match).toUpperCase() === 'AUCUN') {
      return {
        matched: null,
        confidence: 0,
        reason: String(parsed?.reason || 'Aucun ingrédient officiel suffisamment fiable'),
      }
    }

    const selected = candidates.find(c => c.id === String(parsed.match))
    if (!selected) {
      return { matched: null, confidence: 0, reason: 'Claude a renvoyé un candidat inexistant' }
    }

    return {
      matched: selected.id,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || ''),
    }
  } catch (error) {
    console.error('❌ Erreur Claude résolution ingrédient :', error)
    return { matched: null, confidence: 0, reason: 'Exception IA' }
  }
}

export async function matchStockWithClaude(
  ingredientName: string,
  candidates: ClaudeCandidate[],
): Promise<ClaudeMatchResponse> {
  const candidateList = candidates.map((c, i) => ({
    rank: i + 1,
    id: c.id,
    produit: c.label,
    score_lexical: c.lexicalScore,
  }))

  const prompt = `
Tu es le moteur de rapprochement stock de Mealio.

INGRÉDIENT DEMANDÉ :
"${ingredientName}"

CANDIDATS DU STOCK :
${JSON.stringify(candidateList, null, 2)}

Règles strictes :
1. Choisis uniquement un candidat présent dans la liste.
2. Tu peux répondre AUCUN.
3. La marque et le conditionnement ne comptent pas.
4. Ne considère pas deux ingrédients comme équivalents simplement parce qu'ils appartiennent à la même famille.
5. Respecte les caractéristiques discriminantes : rouge ≠ vert, chèvre ≠ brebis, coco ≠ amande, etc.
6. Ne tiens pas compte des quantités.
7. Ne fais aucune conversion d'unité.
8. En cas de doute important, préfère AUCUN.

Réponds UNIQUEMENT avec :
{"match":"ID exact du candidat ou AUCUN","confidence":0.00,"reason":"courte raison"}
`

  try {
    const answer = await callClaude(prompt)
    if (!answer) return { matched: null, confidence: 0, reason: 'IA indisponible' }

    const parsed = extractJson(answer)
    if (!parsed || !parsed.match || String(parsed.match).toUpperCase() === 'AUCUN') {
      return {
        matched: null,
        confidence: 0,
        reason: String(parsed?.reason || 'Aucun produit suffisamment fiable'),
      }
    }

    const selected = candidates.find(c => c.id === String(parsed.match))
    if (!selected) {
      return { matched: null, confidence: 0, reason: 'Claude a renvoyé un candidat inexistant' }
    }

    return {
      matched: selected.id,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || ''),
    }
  } catch (error) {
    console.error('❌ Erreur Claude matching stock :', error)
    return { matched: null, confidence: 0, reason: 'Exception IA' }
  }
}
