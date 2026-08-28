import { z } from 'zod'
import { json } from '../_shared/json'
import { readAICache, stableCacheKey, writeAICache, type AICacheEnv } from './_cache'
import {
  createSafetyIdentifier,
  getRequestUserId,
  isOpenAIResponsesConfigured,
  parseOpenAIResponse,
  summarizeOpenAIError,
  type OpenAIResponsesEnv,
} from './_openai'

interface Env extends AICacheEnv, OpenAIResponsesEnv {}

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
export const CLASSIFICATION_MAX_OUTPUT_TOKENS = 400

type ValidCategory = typeof VALID_CATEGORIES[number]

interface ChemicalInput {
  name?: string
  molecularFormula?: string
  casNumber?: string
}

interface ClassificationCachePayload {
  category?: ValidCategory | null
}

interface ClassificationResponsePayload {
  category: ValidCategory
  confidence: number
  reason: string
}

const classificationSchema = z.object({
  category: z.enum(VALID_CATEGORIES),
  confidence: z.number().min(0).max(1),
  reason: z.string().min(1).max(500),
})

function isValidCategory(value: unknown): value is ValidCategory {
  return typeof value === 'string' && (VALID_CATEGORIES as readonly string[]).includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Parse only the structured response contract. In particular, never search
 * the whole model response for a category name: explanations can mention
 * multiple categories or negate the category that should be selected.
 */
export function parseClassificationResponse(text: string): ClassificationResponsePayload | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(text.trim()) as unknown
  } catch {
    return null
  }

  if (!isRecord(parsed)) return null

  const { category, confidence, reason } = parsed
  if (
    !isValidCategory(category)
    || typeof confidence !== 'number'
    || !Number.isFinite(confidence)
    || confidence < 0
    || confidence > 1
    || typeof reason !== 'string'
    || !reason.trim()
  ) {
    return null
  }

  return {
    category,
    confidence,
    reason: reason.trim(),
  }
}

export function generateClassificationCacheKey(chemical: ChemicalInput): string {
  return stableCacheKey('classify:v3', {
    name: chemical.name || '',
    casNumber: chemical.casNumber || '',
    molecularFormula: chemical.molecularFormula || '',
  })
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
  data?: Record<string, unknown>
}) => {
  if (!isOpenAIResponsesConfigured(context.env)) {
    return json({ error: 'OpenAI Responses is not configured.' }, { status: 500 })
  }

  const { chemical } = await context.request.json() as {
    chemical?: ChemicalInput
  }

  if (!chemical?.name?.trim()) {
    return json({ error: 'Chemical name is required.' }, { status: 400 })
  }

  const cacheKey = generateClassificationCacheKey(chemical)
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

Return ONLY a JSON object matching this exact shape. Do not wrap it in Markdown or add any other text:
{
  "category": "ORGANIC_NON_HALOGEN",
  "confidence": 0.92,
  "reason": "비할로겐 유기용매로 확인됨"
}

The category value must be exactly one of the allowed category names. The reason may explain your decision and may mention alternatives, but it must not replace the exact category field.`

  try {
    const safetyIdentifier = await createSafetyIdentifier(
      context.env,
      getRequestUserId(context.data),
    )
    const result = await parseOpenAIResponse(context.env, {
      input: prompt,
      maxOutputTokens: CLASSIFICATION_MAX_OUTPUT_TOKENS,
      safetyIdentifier,
      schema: classificationSchema,
      schemaName: 'chemical_classification',
    })

    const parsed = result.data
    const category = parsed.category

    if (category !== 'UNKNOWN') {
      await writeAICache(context.env, 'classify', cacheKey, { category })
    }

    return json({
      category,
      ...(parsed ? { confidence: parsed.confidence, reason: parsed.reason } : {}),
      responseSource: 'ai',
    })
  } catch (error) {
    console.warn('[AI Classification] Falling back to UNKNOWN:', summarizeOpenAIError(error))
    return json({ category: 'UNKNOWN', responseSource: 'deterministic' })
  }
}
