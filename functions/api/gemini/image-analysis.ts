import { generateGeminiText, json } from './_utils'

interface Env {
  GEMINI_API_KEY?: string
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

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
