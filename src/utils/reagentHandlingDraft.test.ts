import { describe, expect, it } from 'vitest'
import { flaggedDraftFields, projectReagentHandlingDraft } from './reagentHandlingDraft'

const record = {
  handling: {
    ppe: ['니트릴 장갑', ' '],
    key_cautions: ['흄후드에서 다룬다'],
    first_aid: { inhalation: '신선한 공기', skin: '물로 씻는다', note_to_physician: 'COHb 측정' },
    spill_small: '흡착패드로 흡수',
    spill_large: '대피',
  },
  storage: {
    temp: '실온',
    container: '갈색 유리병',
    conditions: ['마개를 꽉 닫는다'],
    light_sensitive: true,
    hygroscopic: false,
    storage_group: '독성물질(시건 보관)',
    segregate_from_groups: ['산화제'],
  },
  waste: { lab_waste_category: '할로겐 유기용제 폐액' },
}

describe('reagent handling draft projection', () => {
  it('parses reviewer field paths, dropping indexes and notes', () => {
    expect([...flaggedDraftFields({
      issues: [
        { field: 'handling.key_cautions[0], handling.key_cautions[1], needs_review[1]', severity: 'major' },
        { field: 'ghs (필드 누락)', severity: 'major' },
        { field: 'handling.spill_large', severity: 'minor' },
      ],
    })].sort()).toEqual(['ghs', 'handling.key_cautions', 'needs_review'])
  })

  it('withholds only the fields a reviewer flagged as major or critical', () => {
    const draft = projectReagentHandlingDraft({
      name_ko: '디클로로메탄',
      review_status: 'unreviewed',
      record,
      verify: { issues: [
        { field: 'handling.key_cautions[2]', severity: 'major' },
        { field: 'handling.first_aid.skin', severity: 'critical' },
        { field: 'storage.temp', severity: 'minor' },
      ] },
    })
    expect(draft?.reviewStatus).toBe('unreviewed')
    expect(draft?.handling.keyCautions).toBeUndefined()
    expect(draft?.handling.firstAid).toEqual({ inhalation: '신선한 공기', noteToPhysician: 'COHb 측정' })
    expect(draft?.handling.ppe).toEqual(['니트릴 장갑'])
    expect(draft?.storage).toEqual({ temp: '실온', container: '갈색 유리병', conditions: ['마개를 꽉 닫는다'], lightSensitive: true })
  })

  it('never sends storage group, segregation or waste fields', () => {
    const json = JSON.stringify(projectReagentHandlingDraft({ name_ko: 'x', review_status: 'unreviewed', record, verify: null }))
    expect(json).not.toContain('독성물질')
    expect(json).not.toContain('산화제')
    expect(json).not.toContain('할로겐 유기용제')
  })

  it('a flag on the parent withholds the whole section', () => {
    const draft = projectReagentHandlingDraft({
      name_ko: 'x', review_status: 'unreviewed', record,
      verify: { issues: [{ field: 'handling', severity: 'major' }, { field: 'storage', severity: 'major' }] },
    })
    expect(draft).toBeNull()
  })

  it('shows everything once a person verified the draft, and nothing when rejected', () => {
    const flagged = { issues: [{ field: 'handling', severity: 'major' }] }
    expect(projectReagentHandlingDraft({ name_ko: 'x', review_status: 'verified', record, verify: flagged })?.handling.keyCautions)
      .toEqual(['흄후드에서 다룬다'])
    expect(projectReagentHandlingDraft({ name_ko: 'x', review_status: 'rejected', record, verify: null })).toBeNull()
  })
})
