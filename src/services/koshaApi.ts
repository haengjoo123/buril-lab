/* eslint-disable @typescript-eslint/no-explicit-any */
import { XMLParser } from 'fast-xml-parser'
import type { MsdsSection } from '../types'
import { getJson } from './internalApi'
import i18n from '../locales/i18n';

export { parseKoshaPhDetail } from '../utils/koshaPh'

const KOSHA_MSDS_SECTION_COUNT = 16

interface KoshaMsdsSectionResponse {
  sectionNumber: number
  status: number
  body: string
}

interface KoshaMsdsApiResponse {
  mode?: 'full' | 'link_only'
  officialUrl?: string
  sections?: KoshaMsdsSectionResponse[]
  missingSections?: number[]
}

export interface KoshaMsdsResult {
  mode: 'full' | 'link_only'
  officialUrl?: string
  sections: MsdsSection[]
  missingSections: number[]
}

const msdsPendingRequests = new Map<number, Promise<KoshaMsdsResult>>()
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

const msdsSectionNames = () => Array.from({ length: 16 }, (_, i) => i18n.t(`msc_kosha_section_${i + 1}`))

/** Full MSDS is the only browser-facing KOSHA operation. It is still one
 * internal API request; identity and section 9 pH belong to enrichment. */
export async function fetchKoshaMsds(chemId: number): Promise<KoshaMsdsResult> {
  const pending = msdsPendingRequests.get(chemId)
  if (pending) return pending
  const request = fetchKoshaMsdsDocument(chemId)
  msdsPendingRequests.set(chemId, request)
  try {
    return await request
  } finally {
    msdsPendingRequests.delete(chemId)
  }
}

async function fetchKoshaMsdsDocument(chemId: number): Promise<KoshaMsdsResult> {
  const paddedId = String(chemId).padStart(6, '0')
  const response = await getJson<KoshaMsdsApiResponse>(
    `/api/kosha/msds?chemId=${encodeURIComponent(paddedId)}&policy=20260824.2`,
    { cache: 'no-store' },
  )
  if (response.mode === 'link_only') {
    return {
      mode: 'link_only',
      officialUrl: response.officialUrl,
      sections: [],
      missingSections: Array.from({ length: KOSHA_MSDS_SECTION_COUNT }, (_, index) => index + 1),
    }
  }
  const responseSections = response.sections || []
  const missingSections = new Set(response.missingSections || [])
  const sections: MsdsSection[] = []

  responseSections.forEach((responseSection) => {
    const sectionNumber = responseSection.sectionNumber
    if (responseSection.status < 200 || responseSection.status >= 300) {
      missingSections.add(sectionNumber)
      return
    }
    try {
      const parsed = parser.parse(responseSection.body)
      const items = parsed?.response?.body?.items?.item
      if (!items) {
        missingSections.add(sectionNumber)
        return
      }
      const list = Array.isArray(items) ? items : [items]
      const content = list.map((item: any) => ({
        label: item.msdsItemNameKor || 'Unknown',
        value: item.itemDetail || i18n.t('msc_kosha_no_data'),
      }))
      if (content.length > 0) {
        sections.push({ title: msdsSectionNames()[sectionNumber - 1] || `Section ${sectionNumber}`, content })
      } else {
        missingSections.add(sectionNumber)
      }
    } catch {
      missingSections.add(sectionNumber)
    }
  })

  for (let sectionNumber = 1; sectionNumber <= KOSHA_MSDS_SECTION_COUNT; sectionNumber += 1) {
    if (!responseSections.some((section) => section.sectionNumber === sectionNumber)) missingSections.add(sectionNumber)
  }
  return {
    mode: 'full',
    officialUrl: response.officialUrl,
    sections,
    missingSections: Array.from(missingSections).sort((left, right) => left - right),
  }
}
