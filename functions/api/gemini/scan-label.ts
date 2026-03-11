interface Env {
  GEMINI_API_KEY?: string
}

const GEMINI_PRIMARY_MODEL = 'gemini-3-flash-preview'
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const VALID_CONTAINER_TYPES = new Set(['A', 'B', 'C', 'D'])

function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  })
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

  const { imageSrc } = await context.request.json() as { imageSrc?: string }

  if (!imageSrc) {
    return json({ error: 'Image data is required.' }, { status: 400 })
  }

  try {
    const image = parseImageDataUrl(imageSrc)
    const prompt = `You are a chemistry lab assistant. Analyze this image of a reagent/chemical container label.
Extract the following information and return it as a JSON object ONLY (no markdown, no extra text):

{
  "name": "<Chemical/reagent name, in the language shown on the label>",
  "casNumber": "<CAS Number if visible, otherwise null>",
  "suggestedContainerType": "<One of: A (brown glass bottle), B (plastic container), C (clear glass bottle), D (ampoule/vial box) - choose based on what you see in the image>",
  "capacity": "<Volume or weight shown on the label, e.g. '500mL', '1kg', otherwise null>",
  "expiryDate": "<Expiry date in YYYY-MM-DD format if visible, otherwise null>",
  "brand": "<Manufacturer/brand name if visible, e.g. 'Sigma-Aldrich', 'Merck', otherwise null>",
  "productNumber": "<Product/catalog number if visible, e.g. 'A1234', otherwise null>"
}

Rules:
- For suggestedContainerType: A = amber/brown glass bottle, B = white/opaque plastic bottle or container, C = clear/transparent glass bottle, D = cardboard box with ampoules or vials inside
- If you cannot determine the container type from the image, default to "A"
- Always try to extract the chemical name
- Return ONLY the JSON object, no other text`

    const responseText = await generateGeminiText(context.env.GEMINI_API_KEY, {
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
      responseText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim(),
    ) as {
      name?: string
      casNumber?: string | null
      suggestedContainerType?: string | null
      capacity?: string | null
      expiryDate?: string | null
      brand?: string | null
      productNumber?: string | null
    }

    const suggestedContainerType = VALID_CONTAINER_TYPES.has(parsed.suggestedContainerType || '')
      ? (parsed.suggestedContainerType as 'A' | 'B' | 'C' | 'D')
      : 'A'

    return json({
      name: parsed.name || '',
      casNumber: parsed.casNumber || undefined,
      suggestedContainerType,
      capacity: parsed.capacity || undefined,
      expiryDate: parsed.expiryDate || undefined,
      brand: parsed.brand || undefined,
      productNumber: parsed.productNumber || undefined,
      success: true,
    })
  } catch (error) {
    return json(
      {
        name: '',
        suggestedContainerType: 'A',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze reagent label.',
      },
      { status: 502 },
    )
  }
}
