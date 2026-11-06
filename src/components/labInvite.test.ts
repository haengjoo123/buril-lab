// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { LabMember } from '../store/useLabStore'
import { buildLabInviteUrl, readLabJoinTarget, shareLabInvite, withoutLabJoinParams } from './labInvite'
import { resolveLabFormDefaults } from './labFormDefaults'

const labId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('lab invite link', () => {
  it('opens the lab inventory with the lab preselected and never carries a password', () => {
    const url = buildLabInviteUrl({ labId: labId.toUpperCase(), labName: ' QA-E 테스트랩 ' }, 'https://burillab.com/')
    expect(url).toBe(`https://burillab.com/app/inventory?joinLab=${labId}&lab=QA-E+%ED%85%8C%EC%8A%A4%ED%8A%B8%EB%9E%A9`)
    expect(readLabJoinTarget(new URL(url).search)).toEqual({ labId, labName: 'QA-E 테스트랩' })
  })

  it('ignores malformed invite params', () => {
    expect(readLabJoinTarget('?joinLab=not-a-lab&lab=Kim')).toBeNull()
    expect(readLabJoinTarget(`?joinLab=${labId}`)).toBeNull()
    expect(readLabJoinTarget('?q=acetone')).toBeNull()
  })

  it('removes only the invite params from the address', () => {
    expect(withoutLabJoinParams(`https://burillab.com/app/inventory?joinLab=${labId}&lab=Kim&tab=1#top`))
      .toBe('/app/inventory?tab=1#top')
  })
})

describe('shareLabInvite', () => {
  const payload = { title: 'Kim Lab', text: 'Join Kim Lab', url: 'https://burillab.com/app/inventory' }

  it('uses the share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    await expect(shareLabInvite(payload, { share, clipboard: { writeText } } as never)).resolves.toBe('shared')
    expect(share).toHaveBeenCalledWith(payload)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('treats a dismissed share sheet as cancelled, not as a copy', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('dismissed'), { name: 'AbortError' }))
    const writeText = vi.fn()
    await expect(shareLabInvite(payload, { share, clipboard: { writeText } } as never)).resolves.toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the text and link when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    await expect(shareLabInvite(payload, { clipboard: { writeText } } as never)).resolves.toBe('copied')
    expect(writeText).toHaveBeenCalledWith('Join Kim Lab\nhttps://burillab.com/app/inventory')
  })

  it('reports failure when the clipboard is blocked', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    await expect(shareLabInvite(payload, { clipboard: { writeText } } as never)).resolves.toBe('failed')
  })
})

describe('resolveLabFormDefaults', () => {
  const membership = (id: string, joinedAt: string, extra: Partial<LabMember> = {}, lab: Partial<NonNullable<LabMember['lab']>> = {}): LabMember => ({
    id: `m-${id}`,
    lab_id: id,
    user_id: 'user-1',
    role: 'graduate',
    joined_at: joinedAt,
    ...extra,
    lab: { id, name: id, created_by: 'user-0', created_at: joinedAt, ...lab },
  })

  it('prefills from the most recent membership and lists known institutions for autocomplete', () => {
    const defaults = resolveLabFormDefaults([
      membership('old', '2025-01-01T00:00:00Z', { nickname: '김옛날' }, { institution_name: '버릴대학교', institution_type: 'university' }),
      membership('new', '2026-06-01T00:00:00Z', { nickname: '  김연구 ' }, { institution_name: '버릴연구원', institution_type: 'research_institute_gov' }),
      membership('none', '2026-07-01T00:00:00Z'),
    ])
    expect(defaults).toEqual({
      nickname: '김연구',
      institutionName: '버릴연구원',
      institutionType: 'research_institute_gov',
      institutionNames: ['버릴연구원', '버릴대학교'],
    })
  })

  it('leaves fields empty for a user without labs', () => {
    expect(resolveLabFormDefaults([])).toEqual({ nickname: '', institutionName: '', institutionType: '', institutionNames: [] })
  })
})
