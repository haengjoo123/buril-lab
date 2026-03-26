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

  const prompt = `당신은 대한민국 대학교 실험실의 폐기물 안전 관리 전문가입니다.
아래 시약들이 하나의 폐액통에 함께 폐기될 예정입니다. 이 혼합물에 대해 전문적인 폐기 가이드를 작성해주세요.

## 폐기 예정 시약 목록
${chemicalList}

## 반드시 포함할 내용 (아래 형식을 정확히 따라주세요)

🪣 추천 폐액통
→ 어떤 종류의 폐액통에 버려야 하는지 (예: 할로겐 유기 폐액통, 산성 폐액통 등)

⚠️ 혼합 시 주의사항
→ 이 시약 조합에서 발생할 수 있는 구체적 위험 (발열, 가스 발생 등)

📋 폐기 절차
→ 안전한 폐기를 위한 단계별 절차 (1, 2, 3 순서로)

💡 추가 안전 팁
→ 보호장비, 환기 등 실무 팁

## 작성 규칙
- 한국어로 작성
- 간결하고 실용적으로 (각 섹션 2-3줄)
- 확실하지 않은 경우 반드시 "MSDS를 확인하세요"로 안내
- 마크다운 형식 사용하지 말 것 (순수 텍스트, 이모지와 화살표만 사용)`

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
