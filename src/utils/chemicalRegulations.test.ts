import { describe, expect, it } from 'vitest'
import {
  categorizeRegulationType,
  hazardousRegulationEntries,
  parseKecoChemicalResponse,
  readKecoResultCode,
} from './chemicalRegulations'

// Trimmed from a real chemSbstnList response for 50-00-0 (2026-10-19).
const formaldehydeItem = {
  sbstnId: '18238',
  casNo: '50-00-0',
  korexst: 'KE-17074',
  sbstnNmKor: '포르말린',
  sbstnNmEng: 'Formaldehyde',
  typeList: [
    { sbstnClsfTypeNm: '기존화학물질', unqNo: 'KE-17074', contInfo: '', excpInfo: '', ancmntYmd: '20141230', ancmntInfo: '환경부고시 제2014-237호' },
    { sbstnClsfTypeNm: '인체등유해성물질', unqNo: '97-1-345', contInfo: '인체급성유해성 : 1%, 인체만성유해성 : 0.1%', excpInfo: '', ancmntYmd: '20250807', ancmntInfo: '화학물질안전원고시 제2025-19호' },
    { sbstnClsfTypeNm: '사고대비물질', unqNo: '1', contInfo: '포르말린 또는 포름알데히드 및 이를 1% 이상 함유한 혼합물', excpInfo: '', ancmntYmd: '        ', ancmntInfo: '' },
  ],
}

describe('categorizeRegulationType', () => {
  it.each([
    ['금지물질', 'banned'],
    ['제한물질', 'restricted'],
    ['허가물질', 'permitted'],
    ['사고대비물질', 'accident_preparedness'],
    ['유독물질', 'toxic'],
    ['인체급성유해성물질', 'acute_toxic'],
    ['인체만성유해성물질', 'chronic_toxic'],
    ['생태유해성물질', 'eco_toxic'],
    ['인체등유해성물질', 'human_eco_hazard'],
    ['중점관리물질', 'priority_control'],
    ['기존화학물질', 'existing'],
    ['등록대상기존화학물질', 'existing'],
    ['알 수 없는 분류', 'other'],
  ] as const)('maps %s to %s', (typeName, expected) => {
    expect(categorizeRegulationType(typeName)).toBe(expected)
  })
})

describe('parseKecoChemicalResponse', () => {
  it('parses the bare { header, body } shape and orders hazardous classes first', () => {
    const record = parseKecoChemicalResponse({
      header: { resultCode: '200', resultMsg: 'NORMAL SERVICE.' },
      body: { items: [formaldehydeItem], totalCount: '1' },
    }, '50-00-0')

    expect(record).toMatchObject({ casNumber: '50-00-0', keNumber: 'KE-17074', nameKo: '포르말린', nameEn: 'Formaldehyde' })
    expect(record?.entries.map((entry) => entry.category)).toEqual(['accident_preparedness', 'human_eco_hazard', 'existing'])
    expect(record?.entries[0]).toEqual({
      category: 'accident_preparedness',
      typeName: '사고대비물질',
      uniqueNumber: '1',
      contentThreshold: '포르말린 또는 포름알데히드 및 이를 1% 이상 함유한 혼합물',
    })
    expect(record?.entries[1]).toMatchObject({
      contentThreshold: '인체급성유해성 : 1%, 인체만성유해성 : 0.1%',
      noticeDate: '2025-08-07',
    })
    expect(record?.entries[2].contentThreshold).toBeUndefined()
  })

  it('accepts the { response: { body: { items: { item } } } } shape and a single typeList object', () => {
    const record = parseKecoChemicalResponse({
      response: {
        header: { resultCode: '00' },
        body: { items: { item: { ...formaldehydeItem, typeList: { sbstnClsfTypeNm: '기존화학물질', unqNo: 'KE-17074' } } } },
      },
    }, '50-00-0')

    expect(record?.entries).toEqual([{ category: 'existing', typeName: '기존화학물질', uniqueNumber: 'KE-17074' }])
  })

  it('keeps only the exact CAS match from a partial-match search', () => {
    const record = parseKecoChemicalResponse({
      body: { items: [{ ...formaldehydeItem, casNo: '9002-81-7' }, formaldehydeItem] },
    }, '50-00-0')
    expect(record?.casNumber).toBe('50-00-0')
    expect(record?.entries).toHaveLength(3)
  })

  it('returns null when nothing matches or the CAS number is invalid', () => {
    expect(parseKecoChemicalResponse({ body: { items: '' } }, '50-00-0')).toBeNull()
    expect(parseKecoChemicalResponse({ body: { items: [formaldehydeItem] } }, '50-00-1')).toBeNull()
    expect(parseKecoChemicalResponse(null, '50-00-0')).toBeNull()
  })

  it('drops duplicate classification rows', () => {
    const record = parseKecoChemicalResponse({ body: { items: [formaldehydeItem, formaldehydeItem] } }, '50-00-0')
    expect(record?.entries).toHaveLength(3)
  })
})

describe('hazardousRegulationEntries', () => {
  it('excludes inventory-only classes such as 기존화학물질', () => {
    const record = parseKecoChemicalResponse({ body: { items: [formaldehydeItem] } }, '50-00-0')!
    expect(hazardousRegulationEntries(record).map((entry) => entry.typeName)).toEqual(['사고대비물질', '인체등유해성물질'])
  })
})

describe('readKecoResultCode', () => {
  it('reads the code from either response shape', () => {
    expect(readKecoResultCode({ header: { resultCode: '200' } })).toBe('200')
    expect(readKecoResultCode({ response: { header: { resultCode: '03' } } })).toBe('03')
    expect(readKecoResultCode('not json')).toBeUndefined()
  })
})
