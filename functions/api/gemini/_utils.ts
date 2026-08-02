export const GEMINI_PRIMARY_MODEL = 'gemini-3-flash-preview'
export const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'

export interface GeminiResult {
  text: string
  usedModelName: string
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function generateGeminiText(
  apiKey: string,
  payload: unknown,
  options: {
    allowFallback?: boolean
    maxRetries?: number
    initialRetryDelay?: number
    timeoutMs?: number
  } = {}
): Promise<GeminiResult> {
  const { 
    allowFallback = true, 
    maxRetries = 2, 
    initialRetryDelay = 1000,
    timeoutMs = 20_000,
  } = options

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Gemini request timeout must be a positive finite number.')
  }

  let currentRetry = 0
  let currentModel = allowFallback ? GEMINI_PRIMARY_MODEL : GEMINI_FALLBACK_MODEL

  while (currentRetry <= maxRetries) {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    let response: Response
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
      )
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`Gemini request timed out after ${timeoutMs}ms.`)
      }
      throw error
    } finally {
      clearTimeout(timeoutId)
    }

    if (response.ok) {
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
        usedModelName: currentModel,
      }
    }

    // Handle 429 Too Many Requests or 503 Service Unavailable
    if (response.status === 429 || response.status === 503) {
      currentRetry++
      
      if (currentRetry <= maxRetries) {
        // Exponential backoff
        const delay = initialRetryDelay * Math.pow(2, currentRetry - 1)
        console.warn(`[Gemini Utils] Request failed with ${response.status}. Retrying in ${delay}ms... (Attempt ${currentRetry}/${maxRetries})`)
        await sleep(delay)
        
        // If we hit 429/503 on primary, try switching to fallback on retry if allowed
        if (allowFallback && currentModel === GEMINI_PRIMARY_MODEL) {
          console.info(`[Gemini Utils] Switching to fallback model: ${GEMINI_FALLBACK_MODEL}`)
          currentModel = GEMINI_FALLBACK_MODEL
        }
        continue
      }
    }

    // If we're here, it's either an unretryable error or we've exhausted retries
    const errorText = await response.text()
    throw new Error(`Gemini request failed with status ${response.status}: ${errorText}`)
  }

  throw new Error('Gemini request failed: Max retries exceeded')
}

export function json(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(init?.headers || {}),
    },
  })
}
