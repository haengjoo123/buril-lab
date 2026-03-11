interface Env {
  GEMINI_API_KEY?: string
}

const GEMINI_PRIMARY_MODEL = 'gemini-3-flash-preview'
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'
const VALID_CATEGORIES = [
  'ACID',
  'ALKALI',
  'NEUTRAL',
  'ORGANIC_HALOGEN',
  'ORGANIC_NON_HALOGEN',
  'HEAVY_METAL',
  'CYANIDE',
  'REACTIVE',
  'SOLID_WASTE',
  'UNKNOWN',
] as const

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  })
}

async function generateGeminiText(
  apiKey: string,
  payload: unknown,
  allowFallback = true,
): Promise<string> {
  const model = allowFallback ? GEMINI_PRIMARY_MODEL : GEMINI_FALLBACK_MODEL
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )

  if (!response.ok) {
    if (allowFallback && response.status === 503) {
      return generateGeminiText(apiKey, payload, false)
    }

    const errorText = await response.text()
    throw new Error(`Gemini request failed with status ${response.status}: ${errorText}`)
  }

  const data = await response.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>
      }
    }>
  }

  return (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim()
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}) => {
  if (!context.env.GEMINI_API_KEY) {
    return json({ error: 'Gemini API key is not configured.' }, { status: 500 })
  }

  const { chemical } = await context.request.json() as {
    chemical?: {
      name?: string
      molecularFormula?: string
      casNumber?: string
    }
  }

  if (!chemical?.name?.trim()) {
    return json({ error: 'Chemical name is required.' }, { status: 400 })
  }

  const prompt = `Analyze the following chemical substance and assign it to EXACTLY ONE of these disposal categories:
"ACID", "ALKALI", "NEUTRAL", "ORGANIC_HALOGEN", "ORGANIC_NON_HALOGEN", "HEAVY_METAL", "CYANIDE", "REACTIVE", "SOLID_WASTE", "UNKNOWN"

Chemical Name: ${chemical.name}
Formula: ${chemical.molecularFormula || 'Not provided'}
CAS Number: ${chemical.casNumber || 'Not provided'}

Strict Rules for Assignment:
1. REACTIVE takes ultimate precedence (e.g. explosive, peroxide, nitrate, strong oxidizers AND specifically Nitric Acid / HNO3, Perchloric Acid / HClO4).
2. CYANIDE if it contains cyanide OR sulfide (S2-).
3. HEAVY_METAL if it contains Ag, Cd, Pb, Hg, Cr, As, Ni, Cu, Zn, or Ba.
4. ORGANIC_HALOGEN if it contains Carbon AND Halogens (F, Cl, Br, I).
5. ORGANIC_NON_HALOGEN if it contains Carbon but no Halogens.
6. ACID if it is strictly an inorganic acid (e.g. HCl, H2SO4) but NEVER Nitric/Perchloric/Sulfides.
7. ALKALI if it is strictly an inorganic base.
8. SOLID_WASTE if it is commonly a solid waste (powders, resins, sand, beads) AND NOT reactive, cyanide, or heavy metal.
9. NEUTRAL if it's a completely pure, harmless inorganic aqueous solution WITHOUT any organics, heavy metals, or toxins.
10. UNKNOWN if none of the above perfectly apply.

Return ONLY the category name as a plain string. No other text.`

  try {
    const rawText = await generateGeminiText(context.env.GEMINI_API_KEY, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    const normalizedText = rawText.toUpperCase()
    const category = VALID_CATEGORIES.find((value) => normalizedText.includes(value)) || 'UNKNOWN'

    return json({ category })
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to classify chemical.',
      },
      { status: 502 },
    )
  }
}
