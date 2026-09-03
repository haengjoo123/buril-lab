// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InternalApiError } from './internalApi'
import { isLabMembershipLimitError, LAB_MEMBERSHIP_LIMIT_ERROR, labService } from './labService'

const mocked = vi.hoisted(() => ({ postJson: vi.fn(), rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(),
  select: vi.fn(), eq: vi.fn(), single: vi.fn() }))
vi.mock('./internalApi', async (original) => ({ ...await original<typeof import('./internalApi')>(), postJson: mocked.postJson }))
vi.mock('./supabaseClient', () => ({ supabase: { rpc: mocked.rpc, from: mocked.from,
  auth: { getUser: mocked.getUser } } }))

const labId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const userId = '11111111-1111-4111-8111-111111111111'
const member = { id: 'synthetic-membership', lab_id: labId, user_id: userId, role: 'student' }
beforeEach(() => {
  vi.resetAllMocks()
  mocked.postJson.mockResolvedValue({ success: true, labId })
  mocked.getUser.mockResolvedValue({ data: { user: { id: userId } } })
  const chain = { select: mocked.select, eq: mocked.eq, single: mocked.single }
  mocked.from.mockReturnValue(chain)
  mocked.select.mockReturnValue(chain)
  mocked.eq.mockReturnValue(chain)
  mocked.single.mockResolvedValue({ data: member, error: null })
})

describe('new client join path', () => {
  it('sends only the intended fields to the server and reads its own new membership', async () => {
    expect(await labService.joinLab(labId.toUpperCase(), 'synthetic-password', 'nickname')).toEqual(member)
    expect(mocked.postJson).toHaveBeenCalledExactlyOnceWith('/api/labs/join', {
      labId, password: 'synthetic-password', nickname: 'nickname',
    }, { signal: expect.any(AbortSignal) })
    expect(mocked.eq).toHaveBeenCalledWith('lab_id', labId)
    expect(mocked.eq).toHaveBeenCalledWith('user_id', userId)
    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it('preserves passwordless legacy labs and omits an absent nickname', async () => {
    await labService.joinLab(labId)
    expect(mocked.postJson.mock.calls[0][1]).toEqual({ labId, password: '' })
  })

  it.each([
    ['join_locked', 429, '30분', 1800], ['RATE_LIMITED', 429, '1분', 60],
    ['incorrect_password', 403, '비밀번호가 올바르지', undefined],
    ['already_member', 409, '이미', undefined], ['lab_not_found', 404, '다시 검색', undefined],
    ['max_lab_memberships_exceeded', 409, LAB_MEMBERSHIP_LIMIT_ERROR, undefined],
    ['UNAUTHENTICATED', 401, '다시 로그인', undefined],
    ['JOIN_UNAVAILABLE', 503, '가입 여부', undefined], ['RATE_LIMIT_UNAVAILABLE', 503, '가입 여부', 60],
  ])('shows a clear message for %s without calling the old RPC', async (code, status, message, retry) => {
    mocked.postJson.mockRejectedValueOnce(new InternalApiError('sensitive-server-message', status, code, retry))
    const error = await labService.joinLab(labId, 'synthetic-password').catch((error: unknown) => error)
    expect(error).toBeInstanceOf(InternalApiError)
    expect(error).toMatchObject({ message: expect.stringContaining(message), status,
      code: code === 'already_member' ? '23505' : code, retryAfterSeconds: retry })
    expect((error as Error).message).not.toContain('sensitive-server-message')
    expect(mocked.rpc).not.toHaveBeenCalled()
    expect(mocked.from).not.toHaveBeenCalled()
    expect(mocked.postJson).toHaveBeenCalledTimes(1)
  })

  it.each([new TypeError('offline'), new DOMException('timeout', 'TimeoutError')])(
    'does not resubmit an uncertain result after %s', async (cause) => {
      mocked.postJson.mockRejectedValueOnce(cause)
      await expect(labService.joinLab(labId)).rejects.toThrow('가입 여부')
      expect(mocked.postJson).toHaveBeenCalledTimes(1)
      expect(mocked.rpc).not.toHaveBeenCalled()
    },
  )

  it.each([{ success: false, labId }, { success: true, labId: userId }, null])(
    'does not trust a malformed success: %j', async (payload) => {
      mocked.postJson.mockResolvedValueOnce(payload)
      await expect(labService.joinLab(labId)).rejects.toThrow('가입 여부')
      expect(mocked.getUser).not.toHaveBeenCalled()
      expect(mocked.rpc).not.toHaveBeenCalled()
    },
  )

  it('retains the read-only missing-column fallback without resubmitting the join', async () => {
    mocked.single.mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column institution_name does not exist' } })
    expect(await labService.joinLab(labId)).toEqual(member)
    expect(mocked.single).toHaveBeenCalledTimes(2)
    expect(mocked.postJson).toHaveBeenCalledTimes(1)
    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it('distinguishes a successful join followed by a failed membership read', async () => {
    mocked.single.mockResolvedValueOnce({ data: null, error: { message: 'sensitive-db-error' } })
    await expect(labService.joinLab(labId)).rejects.toThrow('가입은 처리됐지만')
    expect(mocked.postJson).toHaveBeenCalledTimes(1)
    expect(mocked.rpc).not.toHaveBeenCalled()
  })

  it('recognizes a structured membership limit error', () => {
    expect(isLabMembershipLimitError({ code: 'max_lab_memberships_exceeded' })).toBe(true)
  })
})

describe('Ops8 lab password writes', () => {
  it('preserves every password character for the server policy and full-input hash', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { success: true }, error: null })
    await labService.updateLabJoinPassword(labId, '  Safe phrase 2026!  ')
    expect(mocked.rpc).toHaveBeenCalledExactlyOnceWith('set_lab_join_password', {
      target_lab_id: labId,
      p_password: '  Safe phrase 2026!  ',
    })
  })

  it('uses null only for an intentional password removal', async () => {
    mocked.rpc.mockResolvedValueOnce({ data: { success: true }, error: null })
    await labService.updateLabJoinPassword(labId, '')
    expect(mocked.rpc).toHaveBeenCalledExactlyOnceWith('set_lab_join_password', {
      target_lab_id: labId,
      p_password: null,
    })
  })
})
