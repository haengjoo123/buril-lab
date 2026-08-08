import { generateGeminiText, json } from './_utils'
import { normalizeCasNumber } from '../../../src/utils/casNumber'
import { parseCapacityMeasurement } from '../../../src/utils/capacityParser'
import { normalizeExpiryDate } from '../../../src/utils/dateValidation'
import {
  isManufacturerDateType,
  type ManufacturerDateType,
} from '../../../src/utils/manufacturerDate'

interface Env {
  GEMINI_API_KEY?: string
}

type ContainerType = 'A' | 'B' | 'C' | 'D'
type ScanValidation = 'valid' | 'missing' | 'invalid' | 'review_required'

export interface ScanFieldSnapshot<T = string> {
  value: T | null
  confidence: number
  validation: ScanValidation
}

export interface ReagentLabelFieldSnapshots {
  name: ScanFieldSnapshot<string>
  casNumber: ScanFieldSnapshot<string>
  capacity: ScanFieldSnapshot<string>
  expiryDate: ScanFieldSnapshot<string>
  manufacturerDateType: ScanFieldSnapshot<ManufacturerDateType>
  brand: ScanFieldSnapshot<string>
  productNumber: ScanFieldSnapshot<string>
  containerType: ScanFieldSnapshot<ContainerType>
}

export interface ReagentLabelScanResponse {
  name: string
  casNumber?: string
  suggestedContainerType: ContainerType | null
  capacity?: string
  expiryDate?: string
  manufacturerDateType?: ManufacturerDateType
  brand?: string
  productNumber?: string
  fieldSnapshots: ReagentLabelFieldSnapshots
  reviewRequired: boolean
  reviewReasons: string[]
  success: true
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const AUTO_PLACE_CONFIDENCE = 0.8
const VALID_CONTAINER_TYPES = new Set<ContainerType>(['A', 'B', 'C', 'D'])
const CAPACITY_PATTERN = /^(\d+(?:[.,]\d+)?)\s*(uL|µL|μL|mL|L|ug|µg|μg|mg|g|kg)$/i
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

type JsonRecord = Record<string, unknown>

void CAPACITY_PATTERN
void ISO_DATE_PATTERN

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function parseImageDataUrl(imageSrc: string) {
  const [header, base64Data] = imageSrc.split(',', 2)
  const mimeMatch = header?.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64$/)

  if (!mimeMatch || !base64Data) {
    throw new Error('A valid base64 image is required.')
  }

  const approximateBytes = Math.floor((base64Data.length * 3) / 4)
  if (approximateBytes > MAX_IMAGE_BYTES) {
    throw new Error('Image is too large to analyze.')
  }

  return {
    mimeType: mimeMatch[1],
    data: base64Data,
  }
}

function normalizeConfidence(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseFloat(value)
      : 0

  if (!Number.isFinite(parsed)) return 0
  if (parsed < 0 || parsed > 100) return 0
  return parsed > 1 ? parsed / 100 : parsed
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (/^(?:null|unknown|none|n\/?a|not visible|not found)$/i.test(normalized)) return null
  return normalized || null
}

function readRawField(parsed: JsonRecord, fieldName: string): {
  value: string | null
  confidence: number
} {
  const fields = isRecord(parsed.fields) ? parsed.fields : null
  const field = fields && isRecord(fields[fieldName]) ? fields[fieldName] : null

  if (field && Object.prototype.hasOwnProperty.call(field, 'value')) {
    return {
      value: normalizeText(field.value),
      confidence: normalizeConfidence(field.confidence),
    }
  }

  const confidences = isRecord(parsed.confidences) ? parsed.confidences : null
  return {
    value: normalizeText(parsed[fieldName]),
    confidence: normalizeConfidence(confidences?.[fieldName]),
  }
}

function validateTextField(
  raw: { value: string | null; confidence: number },
  maxLength: number,
): ScanFieldSnapshot<string> {
  if (!raw.value) {
    return { value: null, confidence: raw.confidence, validation: 'missing' }
  }

  return {
    value: raw.value.slice(0, Math.max(maxLength, 1) * 2),
    confidence: raw.confidence,
    validation: raw.value.length <= maxLength ? 'valid' : 'invalid',
  }
}

function validateCasField(
  raw: { value: string | null; confidence: number },
): ScanFieldSnapshot<string> {
  if (!raw.value) {
    return { value: null, confidence: raw.confidence, validation: 'missing' }
  }

  const normalized = normalizeCasNumber(raw.value)
  return {
    value: normalized || raw.value.slice(0, 64),
    confidence: raw.confidence,
    validation: normalized ? 'valid' : 'invalid',
  }
}

function validateCapacityField(
  raw: { value: string | null; confidence: number },
): ScanFieldSnapshot<string> {
  if (!raw.value) {
    return { value: null, confidence: raw.confidence, validation: 'missing' }
  }

  const parsed = parseCapacityMeasurement(raw.value)
  const isValid = parsed.numericValue !== null && parsed.unit !== null

  return {
    value: raw.value.slice(0, 64),
    confidence: raw.confidence,
    validation: isValid ? 'valid' : 'invalid',
  }
}

function validateExpiryField(
  raw: { value: string | null; confidence: number },
): ScanFieldSnapshot<string> {
  if (!raw.value) {
    return { value: null, confidence: raw.confidence, validation: 'missing' }
  }

  const normalized = normalizeExpiryDate(raw.value)
  const isValid = normalized !== null

  return {
    value: normalized || raw.value.slice(0, 32),
    confidence: raw.confidence,
    validation: isValid ? 'valid' : 'invalid',
  }
}

function validateManufacturerDateTypeField(
  raw: { value: string | null; confidence: number },
): ScanFieldSnapshot<ManufacturerDateType> {
  if (!raw.value) {
    return { value: null, confidence: raw.confidence, validation: 'missing' }
  }

  const normalized = raw.value.trim().toLowerCase()
  const aliases: Record<string, ManufacturerDateType> = {
    expiry: 'expiry',
    expiration: 'expiry',
    exp: 'expiry',
    use_by: 'expiry',
    'use by': 'expiry',
    minimum_shelf_life: 'minimum_shelf_life',
    'minimum shelf life': 'minimum_shelf_life',
    unlabeled: 'unlabeled',
  }
  const value = aliases[normalized] || (isManufacturerDateType(normalized) ? normalized : null)
  return {
    value,
    confidence: raw.confidence,
    validation: value ? 'valid' : 'review_required',
  }
}

function validateContainerField(
  raw: { value: string | null; confidence: number },
): ScanFieldSnapshot<ContainerType> {
  const candidate = raw.value?.toUpperCase() as ContainerType | undefined
  if (candidate && VALID_CONTAINER_TYPES.has(candidate)) {
    return {
      value: candidate,
      confidence: raw.confidence,
      validation: 'valid',
    }
  }

  return {
    value: null,
    confidence: raw.confidence,
    validation: 'review_required',
  }
}

function getReviewReasons(fields: ReagentLabelFieldSnapshots): string[] {
  const reasons = new Set<string>()
  const requiredFields = [
    ['name', fields.name],
    ['containerType', fields.containerType],
  ] as const

  requiredFields.forEach(([key, field]) => {
    if (field.validation !== 'valid' || !field.value) {
      reasons.add(`${key}_${field.validation === 'valid' ? 'missing' : field.validation}`)
    } else if (field.confidence < AUTO_PLACE_CONFIDENCE) {
      reasons.add(`${key}_low_confidence`)
    }
  })

  const optionalFields = [
    ['casNumber', fields.casNumber],
    ['capacity', fields.capacity],
    ['expiryDate', fields.expiryDate],
    ['brand', fields.brand],
    ['productNumber', fields.productNumber],
  ] as const

  optionalFields.forEach(([key, field]) => {
    if (field.validation === 'missing' && !field.value) return
    if (field.validation !== 'valid') {
      reasons.add(`${key}_${field.validation}`)
    } else if (field.confidence < AUTO_PLACE_CONFIDENCE) {
      reasons.add(`${key}_low_confidence`)
    }
  })

  if (fields.expiryDate.validation === 'valid' && fields.expiryDate.value) {
    if (fields.manufacturerDateType.validation !== 'valid'
      || !fields.manufacturerDateType.value
      || fields.manufacturerDateType.value === 'unlabeled') {
      reasons.add('manufacturerDateType_review_required')
    } else if (fields.manufacturerDateType.confidence < AUTO_PLACE_CONFIDENCE) {
      reasons.add('manufacturerDateType_low_confidence')
    }
  }

  return [...reasons]
}

/**
 * Converts either the new confidence-bearing model response or the previous
 * flat response into a server-validated scan snapshot.
 */
export function buildReagentLabelScanResponse(input: unknown): ReagentLabelScanResponse {
  if (!isRecord(input)) throw new Error('Invalid scan response.')

  const nestedContainer = readRawField(input, 'containerType')
  const container = nestedContainer.value
    ? nestedContainer
    : readRawField(input, 'suggestedContainerType')
  const fields: ReagentLabelFieldSnapshots = {
    name: validateTextField(readRawField(input, 'name'), 300),
    casNumber: validateCasField(readRawField(input, 'casNumber')),
    capacity: validateCapacityField(readRawField(input, 'capacity')),
    expiryDate: validateExpiryField(readRawField(input, 'expiryDate')),
    manufacturerDateType: validateManufacturerDateTypeField(readRawField(input, 'manufacturerDateType')),
    brand: validateTextField(readRawField(input, 'brand'), 200),
    productNumber: validateTextField(readRawField(input, 'productNumber'), 200),
    containerType: validateContainerField(container),
  }

  const reviewReasons = getReviewReasons(fields)
  const validValue = (field: ScanFieldSnapshot<string>) => (
    field.validation === 'valid' && field.value ? field.value : undefined
  )

  return {
    name: validValue(fields.name) || '',
    casNumber: validValue(fields.casNumber),
    suggestedContainerType: fields.containerType.validation === 'valid'
      ? fields.containerType.value
      : null,
    capacity: validValue(fields.capacity),
    expiryDate: validValue(fields.expiryDate),
    manufacturerDateType: fields.manufacturerDateType.validation === 'valid'
      ? fields.manufacturerDateType.value || undefined
      : undefined,
    brand: validValue(fields.brand),
    productNumber: validValue(fields.productNumber),
    fieldSnapshots: fields,
    reviewRequired: reviewReasons.length > 0,
    reviewReasons,
    success: true,
  }
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}) => {
  if (!context.env.GEMINI_API_KEY) {
    return json({ error: 'Gemini API key is not configured.' }, { status: 500 })
  }

  const { imageSrc } = await context.request.json() as { imageSrc?: string }

  if (!imageSrc) {
    return json({ error: 'Image data is required.' }, { status: 400 })
  }

  try {
    const image = parseImageDataUrl(imageSrc)
    const prompt = `You are a chemistry lab assistant. Analyze this image of a reagent/chemical container label.
Extract only information that is visibly supported by the image. Return one JSON object only, with no markdown:

{
  "fields": {
    "name": { "value": "<chemical/reagent name or null>", "confidence": 0.0 },
    "casNumber": { "value": "<CAS number only or null>", "confidence": 0.0 },
    "capacity": { "value": "<amount with unit, such as 500 mL or 1 kg, or null>", "confidence": 0.0 },
    "expiryDate": { "value": "<YYYY-MM-DD or null>", "confidence": 0.0 },
    "manufacturerDateType": { "value": "<expiry, minimum_shelf_life, unlabeled, or null>", "confidence": 0.0 },
    "brand": { "value": "<manufacturer/brand or null>", "confidence": 0.0 },
    "productNumber": { "value": "<catalog/product number or null>", "confidence": 0.0 },
    "containerType": { "value": "<A, B, C, D, or null>", "confidence": 0.0 }
  }
}

Container types:
- A: amber or brown glass bottle
- B: plastic bottle or plastic container
- C: clear or transparent glass bottle
- D: vial, ampoule, or a box visibly containing vials/ampoules

Rules:
- confidence must be a number from 0 to 1 for each field
- use null when text is hidden, ambiguous, or not visible
- never guess a container type and never default an unknown container to A
 - manufacturerDateType must be expiry only when the label explicitly says EXP, expiry, expiration, or use by; it must be minimum_shelf_life only when the label explicitly says minimum shelf life (or equivalent)
 - return null for manufacturerDateType when a date is visible but its label type is not visible or is ambiguous; use unlabeled only when no manufacturer date is printed on the visible label
 - do not infer capacity, expiry, brand, product number, or CAS from the chemical name
- preserve the reagent name in the language shown on the label
- return only the JSON object`

    const result = await generateGeminiText(context.env.GEMINI_API_KEY, {
      contents: [
        {
          role: 'user',
          parts: [
            { text: prompt },
            {
              inlineData: {
                data: image.data,
                mimeType: image.mimeType,
              },
            },
          ],
        },
      ],
    })

    const parsed = JSON.parse(
      result.text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim(),
    ) as unknown

    return json(buildReagentLabelScanResponse(parsed))
  } catch (error) {
    return json(
      {
        name: '',
        suggestedContainerType: null,
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze reagent label.',
      },
      { status: 502 },
    )
  }
}
