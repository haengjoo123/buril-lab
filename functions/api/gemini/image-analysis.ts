interface Env {
  GEMINI_API_KEY?: string
}

const GEMINI_PRIMARY_MODEL = 'gemini-3-flash-preview'
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'
const MAX_IMAGE_BYTES = 5 * 1024 * 1024

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
): Promise<{ text: string; usedModelName: string }> {
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

  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((part) => part.text || '')
    .join('')
    .trim()

  return {
    text,
    usedModelName: model,
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
    const prompt = `Identify the primary chemical substance in this image.
Return ONLY the best single search term to look it up in a database.
Prefer the CAS Number if it is clearly visible. If no CAS Number is visible, return the most prominent chemical name (Korean or English).
Do not include any other text, explanation, punctuation, or formatting. Just the search term itself.`

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

    if (!result.text) {
      return json({ searchTerm: '', success: false, error: 'No valid search term identified in the image.' }, { status: 422 })
    }

    return json({
      searchTerm: result.text.replace(/\n/g, ' ').trim(),
      success: true,
      usedModelName: result.usedModelName,
    })
  } catch (error) {
    return json(
      {
        searchTerm: '',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to analyze image with Gemini API.',
      },
      { status: 502 },
    )
  }
}
