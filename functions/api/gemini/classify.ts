import { generateGeminiText, json } from './_utils'
import { readAICache, stableCacheKey, writeAICache, type AICacheEnv } from './_cache'

interface Env extends AICacheEnv {
  GEMINI_API_KEY?: string
}

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

type ValidCategory = typeof VALID_CATEGORIES[number]

interface ChemicalInput {
  name?: string
  molecularFormula?: string
  casNumber?: string
}

interface ClassificationCachePayload {
  category?: ValidCategory | null
}

function isValidCategory(value: unknown): value is ValidCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as readonly string[]).includes(value)
}

function generateCacheKey(chemical: ChemicalInput): string {
  return stableCacheKey('classify:v1', {
    name: chemical.name || '',
    casNumber: chemical.casNumber || '',
    molecularFormula: chemical.molecularFormula || '',
  })
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}) => {
  if (!context.env.GEMINI_API_KEY) {
    return json({ error: 'Gemini API key is not configured.' }, { status: 500 })
  }

  const { chemical } = await context.request.json() as {
    chemical?: ChemicalInput
  }

  if (!chemical?.name?.trim()) {
    return json({ error: 'Chemical name is required.' }, { status: 400 })
  }

  const cacheKey = generateCacheKey(chemical)
  const cached = await readAICache<ClassificationCachePayload>(context.env, 'classify', cacheKey)

  if (isValidCategory(cached?.category) && cached.category !== 'UNKNOWN') {
    return json({ category: cached.category, responseSource: 'cache' })
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
    const result = await generateGeminiText(context.env.GEMINI_API_KEY, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    const rawText = result.text

    const normalizedText = rawText.toUpperCase()
    const category = VALID_CATEGORIES.find((value) => normalizedText.includes(value)) || 'UNKNOWN'

    if (category !== 'UNKNOWN') {
      await writeAICache(context.env, 'classify', cacheKey, { category })
    }

    return json({ category, responseSource: 'ai' })
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to classify chemical.',
      },
      { status: 502 },
    )
  }
}
