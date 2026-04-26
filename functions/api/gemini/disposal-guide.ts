import { generateGeminiText, json } from './_utils'

interface Env {
  GEMINI_API_KEY?: string
}

interface SolutionContextInput {
  physicalForm?: string
  solventClass?: string
  solventName?: string
  solventPreset?: string
  isCustomSolvent?: boolean
  isSolventVerified?: boolean
  solventResolution?: string
  solventCasNumber?: string
  solventMolecularFormula?: string
}

interface ChemicalInput {
  name?: string
  casNumber?: string
  molecularFormula?: string
  category?: string
  solutionContext?: SolutionContextInput
}

const formatSolutionContext = (context?: SolutionContextInput): string => {
  if (!context) return '형태: 원액/고체 기준(기존 데이터)'

  if (context.physicalForm === 'neat_or_solid' || context.solventClass === 'none') {
    return '형태: 원액/고체'
  }

  if (context.physicalForm === 'aqueous' || context.solventClass === 'aqueous') {
    return '형태: 물/수용액'
  }

  if (context.physicalForm === 'mixed_or_unknown' || context.solventClass === 'mixed_or_unknown') {
    return '형태: 혼합/잘 모름'
  }

  if (context.physicalForm === 'organic_solvent') {
    const solventClassLabel =
      context.solventClass === 'organic_halogen'
        ? '할로겐 유기용매'
        : context.solventClass === 'organic_non_halogen'
          ? '비할로겐 유기용매'
          : '성상 미확인 유기용매'
    const verifiedLabel = context.isSolventVerified ? '확인됨' : '미확인'
    return `형태: 유기용매 / 용매: ${context.solventName || '미입력'} / 성상: ${solventClassLabel} / 검증: ${verifiedLabel}`
  }

  return '형태: 미확인'
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
    .map((c, i) => `${i + 1}. ${c.name || '(이름 없음)'}${c.molecularFormula ? ` (${c.molecularFormula})` : ''}${c.casNumber ? ` [CAS: ${c.casNumber}]` : ''} / 기존 분류: ${c.category || 'UNKNOWN'} / ${formatSolutionContext(c.solutionContext)}`)
    .join('\n')

  const prompt = `당신은 실험실 폐기물 분류 시스템의 AI 보조입니다. 아래 분류 체계에 따라 시약 혼합물의 폐기 방법을 판단하세요.

## 폐액통 분류 체계 (이 용어만 사용)
- 산성 폐액통 (빨간색) — 무기산 (HCl, H2SO4 등). 단, 질산/과염소산은 "반응성 폐기물"로 별도 처리
- 알칼리 폐액통 (파란색) — 무기 염기 (NaOH, KOH 등)
- 할로겐족 유기 폐액통 (오렌지색) — 탄소+할로겐(F,Cl,Br,I) 포함 유기물
- 비할로겐족 유기 폐액통 (노란색) — 탄소 포함, 할로겐 없는 유기물
- 중금속 폐액통 — Ag, Cd, Pb, Hg, Cr, As 등 포함
- 시안/황화물계 폐액통 — CN 또는 S2- 포함. 절대 산과 혼합 금지
- 반응성/산화성 폐기물 — 폭발성, 산화성, 자기반응성 물질. 단독 밀폐
- 고체 폐기물 — 고형 시약, 오염된 초자류
- 수계 폐액 — 유기물/중금속/독성 없는 순수 수용액만 해당
- 특수 유해 폐기물 — 맹독성/고인화성 물질. 안전관리자 인계

## 용매/형태 보정 규칙
- 기존 분류는 순수 시약/고체 기준이며, 용매 정보가 있으면 실제 폐액 스트림을 함께 고려하세요.
- 혼합/잘 모름 또는 성상 미확인 유기용매는 확정 분류로 단정하지 말고 안전관리자 확인 필요로 안내하세요.
- 유기용매가 할로겐성이면 할로겐족 유기 폐액 흐름을 우선 고려하되, 중금속/시안/반응성/특수유해 성분 경고를 유지하세요.
- 수용액은 산/알칼리/중성/시안/중금속/반응성 분류를 낮추지 말고, 유기물이 수용액에 녹은 경우 수계 유기성 폐액 여부 확인 필요를 언급하세요.

## 혼합 전용 분류 (혼합물에만 적용)
- 알칼리 + 유기계 혼합 폐액 — 알칼리+유기 혼합 시, 유기물이 수용성이고 중화 가능한 경우. 희석 후 중화(pH 6-8)하여 수계 배출
- 반응성 유기 혼합 폐액 — 알칼리+유기 혼합 시, 유기물이 수용성이지만 중화 불가(반응성)인 경우. 중화 금지, 별도 위탁
- 유기 혼합 폐액 — 알칼리+유기 혼합 시, 유기물이 불용성인 경우. 층 분리 상태로 밀폐하여 위탁

## 판단할 시약 목록
${chemicalList}

## 응답 형식 (정확히 따르세요)

🪣 추천 폐액통
→ (위 분류 체계의 정확한 이름 사용, 한 줄)

⚠️ 주의사항
→ (이 조합의 핵심 위험 한 줄)

규칙: 한국어, 각 항목 1줄, 마크다운 금지, 불확실하면 "MSDS 확인 필요" 명시`

  try {
    const result = await generateGeminiText(context.env.GEMINI_API_KEY, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    })

    return json({ guide: result.text })
  } catch (error) {
    return json(
      {
        error: error instanceof Error ? error.message : 'Failed to generate disposal guide.',
      },
      { status: 502 },
    )
  }
}
