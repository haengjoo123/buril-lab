import { postJson } from './internalApi'

export interface DisposalGuideResult {
    guide: string
}

export async function getAIDisposalGuide(
    chemicals: Array<{
        name: string
        casNumber?: string
        molecularFormula?: string
        category?: string
    }>
): Promise<DisposalGuideResult> {
    return postJson<DisposalGuideResult>('/api/gemini/disposal-guide', { chemicals })
}
