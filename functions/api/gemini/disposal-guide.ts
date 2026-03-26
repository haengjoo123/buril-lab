interface Env {
  GEMINI_API_KEY?: string
}

const GEMINI_PRIMARY_MODEL = 'gemini-3-flash-preview'
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'

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

interface ChemicalInput {
  name?: string
  casNumber?: string
  molecularFormula?: string
  category?: string
}

export const onRequestPost = async (context: {
  request: Request
  env: Env
}) => {
  if (!context.env.GEMINI_API_KEY) {
    return json({ error: 'Gemini API key is not configured.' }, { status: 500 })
  }

  const { chemicals } = await context.request.json() as {
    chemicals?: ChemicalInput[]
  }

  if (!chemicals || chemicals.length === 0) {
    return json({ error: 'At least one chemical is required.' }, { status: 400 })
  }

  const chemicalList = chemicals
    .map((c, i) => `${i + 1}. ${c.name || '(이름 없음)'}${c.molecularFormula ? ` (${c.molecularFormula})` : ''}${c.casNumber ? ` [CAS: ${c.casNumber}]` : ''}`)
    .join('\n')

  const prompt = `대한민국 대학교 실험실 폐기물 전문가로서, 아래 시약 혼합물의 폐기 방법을 아주 간결하게 안내하세요.

시약 목록:
${chemicalList}

아래 형식을 정확히 따르세요:

🪣 추천 폐액통
→ (한 줄로: 어떤 폐액통에 버려야 하는지)

⚠️ 주의사항
→ (한 줄로: 이 조합의 핵심 위험)

규칙: 한국어, 각 항목 반드시 1줄, 마크다운 금지, 불확실하면 "MSDS 확인" 안내`

  try {
    const guide = await generateGeminiText(context.env.GEMINI_API_KEY, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    return json({ guide })
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate disposal guide.',
      },
      { status: 502 },
    )
  }
}
