// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const postJsonMock = vi.hoisted(() => vi.fn())

vi.mock('./supabaseClient', () => ({ supabase: { auth: { getSession: vi.fn() } } }))
vi.mock('./internalApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('./internalApi')>(),
  postJson: postJsonMock,
}))

import { updateSafetyCenterApprovalStatus } from './opsAdminService'

const CENTER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('safety-center status call', () => {
  beforeEach(() => {
    postJsonMock.mockReset()
    postJsonMock.mockResolvedValue({ item: { id: CENTER_ID } })
  })

  it('sends the reason and note with a rejection', async () => {
    await updateSafetyCenterApprovalStatus(CENTER_ID, 'rejected', { reasonPreset: 'other', note: '서류가 만료되었습니다.' })
    expect(postJsonMock).toHaveBeenCalledWith('/api/admin/safety-centers/status', {
      centerId: CENTER_ID, status: 'rejected', reasonPreset: 'other', note: '서류가 만료되었습니다.',
    })
  })

  it('sends a rejection without a review as status only, so the stored reason is kept', async () => {
    await updateSafetyCenterApprovalStatus(CENTER_ID, 'rejected')
    expect(postJsonMock).toHaveBeenCalledWith('/api/admin/safety-centers/status', { centerId: CENTER_ID, status: 'rejected' })
  })

  it('never sends a review with another status', async () => {
    await updateSafetyCenterApprovalStatus(CENTER_ID, 'approved', { reasonPreset: 'domain_mismatch', note: null })
    expect(postJsonMock).toHaveBeenCalledWith('/api/admin/safety-centers/status', { centerId: CENTER_ID, status: 'approved' })
  })
})
