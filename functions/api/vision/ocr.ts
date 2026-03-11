interface Env {
  GOOGLE_VISION_API_KEY?: string
}

interface VisionVertex {
  x?: number
  y?: number
}

interface VisionSymbol {
  text?: string
}

interface VisionWord {
  symbols?: VisionSymbol[]
}

interface VisionParagraph {
  words?: VisionWord[]
}

interface VisionBlock {
  blockType?: string
  confidence?: number
  paragraphs?: VisionParagraph[]
  boundingBox?: {
    vertices?: VisionVertex[]
  }
}

interface VisionPage {
  width?: number
  height?: number
  blocks?: VisionBlock[]
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

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

  return base64Data
}

function verticesToBox(vertices: VisionVertex[]) {
  const xs = vertices.map((vertex) => vertex.x || 0)
  const ys = vertices.map((vertex) => vertex.y || 0)

  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  }
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}) => {
  if (!context.env.GOOGLE_VISION_API_KEY) {
    return json({ error: 'Google Vision API key is not configured.' }, { status: 500 })
  }

  const { imageSrc } = await context.request.json() as { imageSrc?: string }

  if (!imageSrc) {
    return json({ error: 'Image data is required.' }, { status: 400 })
  }

  try {
    const base64Image = parseImageDataUrl(imageSrc)
    const visionResponse = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${context.env.GOOGLE_VISION_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: {
                languageHints: ['ko', 'en'],
              },
            },
          ],
        }),
      },
    )

    if (!visionResponse.ok) {
      const errorText = await visionResponse.text()
      throw new Error(`Vision API error: ${visionResponse.status} ${errorText}`)
    }

    const data = await visionResponse.json() as {
      responses?: Array<{
        fullTextAnnotation?: {
          text?: string
          pages?: VisionPage[]
        }
      }>
    }

    const fullTextAnnotation = data.responses?.[0]?.fullTextAnnotation

    if (!fullTextAnnotation) {
      return json({
        text: '',
        source: 'Google Vision',
        blocks: [],
        imageWidth: 0,
        imageHeight: 0,
      })
    }

    const page = fullTextAnnotation.pages?.[0]
    const blocks = (page?.blocks || [])
      .filter((block) => block.blockType === 'TEXT')
      .map((block) => {
        const text = (block.paragraphs || [])
          .flatMap((paragraph) => paragraph.words || [])
          .map((word) => (word.symbols || []).map((symbol) => symbol.text || '').join(''))
          .join(' ')
          .trim()

        return {
          text,
          confidence: block.confidence || 0,
          boundingBox: block.boundingBox?.vertices
            ? verticesToBox(block.boundingBox.vertices)
            : { x: 0, y: 0, width: 0, height: 0 },
        }
      })
      .filter((block) => block.text)

    return json({
      text: (fullTextAnnotation.text || '').trim(),
      source: 'Google Vision',
      blocks,
      imageWidth: page?.width || 0,
      imageHeight: page?.height || 0,
    })
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to perform OCR.',
      },
      { status: 502 },
    )
  }
}
