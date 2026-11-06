// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SafetyCenterApprovalItem, SafetyCenterRejectReview } from '../../services/opsAdminService'

const listSafetyCenterApprovals = vi.fn<() => Promise<SafetyCenterApprovalItem[]>>()
const updateSafetyCenterApprovalStatus = vi.fn<(id: string, status: string, review?: SafetyCenterRejectReview) => Promise<SafetyCenterApprovalItem>>()
const getSafetyCenterVerificationDocumentUrl = vi.fn<(id: string) => Promise<{ url: string; expiresIn: number; fileName: string | null }>>()

// A stable translation object, like react-i18next's, so effects keyed on `t` run once.
const translation = vi.hoisted(() => ({
  t: (key: string, options?: unknown) => (
    options && typeof options === 'object' ? `${key}:${JSON.stringify(options)}` : key
  ),
  i18n: { language: 'ko' },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
}))
vi.mock('../../services/supabaseClient', () => ({ supabase: {} }))
vi.mock('../../services/opsAdminService', () => ({
  listSafetyCenterApprovals: () => listSafetyCenterApprovals(),
  // Forwards the review only when the view sends one, so calls without it keep two arguments.
  updateSafetyCenterApprovalStatus: (id: string, status: string, review?: SafetyCenterRejectReview) => (
    review === undefined ? updateSafetyCenterApprovalStatus(id, status) : updateSafetyCenterApprovalStatus(id, status, review)
  ),
  getSafetyCenterVerificationDocumentUrl: (id: string) => getSafetyCenterVerificationDocumentUrl(id),
}))
vi.mock('../../components/MfaSettingsPanel', () => ({
  MfaSettingsPanel: () => <div>mfa-settings-marker</div>,
}))

import { InternalApiError } from '../../services/internalApi'
import { SafetyCenterApprovalsView } from './SafetyCenterApprovalsView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DAY_MS = 24 * 60 * 60 * 1000
const REQUESTER_ID = '11111111-2222-4333-8444-555555555555'
/** 12:00 KST, so whole-day offsets stay on the same Asia/Seoul calendar days. */
const NOW = Date.parse('2026-11-06T03:00:00.000Z')

function center(overrides: Partial<SafetyCenterApprovalItem>): SafetyCenterApprovalItem {
  return {
    id: 'center-id',
    institution_name: '버릴대학교',
    institution_domain: 'buril.ac.kr',
    center_name: '센터',
    status: 'pending',
    created_by: REQUESTER_ID,
    approved_by: null,
    approved_at: null,
    verification_document_path: 'docs/proof.pdf',
    verification_document_name: 'proof.pdf',
    verification_document_mime_type: 'application/pdf',
    verification_document_size: 2048,
    verification_document_uploaded_at: new Date(NOW).toISOString(),
    created_at: new Date(NOW).toISOString(),
    updated_at: new Date(NOW).toISOString(),
    ...overrides,
  }
}

const olderPending = center({ id: 'older', center_name: '오래된 센터', created_at: new Date(NOW - 5 * DAY_MS).toISOString() })
const newerPending = center({ id: 'newer', center_name: '새 센터', created_at: new Date(NOW - DAY_MS - 60_000).toISOString() })

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>
const probe = { search: '' }

function LocationProbe() {
  const { search } = useLocation()
  useEffect(() => { probe.search = search }, [search])
  return null
}

async function render(path = '/ops/centers', onItemsChange?: (items: SafetyCenterApprovalItem[], loadedAt: number) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <SafetyCenterApprovalsView onItemsChange={onItemsChange} />
        <LocationProbe />
      </MemoryRouter>,
    )
  })
}

function pendingNames(): Array<string | null> {
  return Array.from(container.querySelectorAll('article h3')).map((element) => element.textContent)
}

function buttonWithText(text: string, scope: ParentNode = container): HTMLButtonElement {
  const button = Array.from(scope.querySelectorAll('button')).find((element) => element.textContent?.includes(text))
  if (!button) throw new Error(`button not found: ${text}`)
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

async function typeInto(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function openDialog(): HTMLElement {
  const dialog = container.querySelector('[role="dialog"]')
  if (!(dialog instanceof HTMLElement)) throw new Error('dialog not open')
  return dialog
}

function reasonRadio(dialog: HTMLElement, reason: string): HTMLInputElement {
  const radio = dialog.querySelector(`input[type="radio"][value="${reason}"]`)
  if (!(radio instanceof HTMLInputElement)) throw new Error(`reason not found: ${reason}`)
  return radio
}

function noteField(dialog: HTMLElement): HTMLTextAreaElement {
  const field = dialog.querySelector('textarea')
  if (!field) throw new Error('note field not found')
  return field
}

describe('SafetyCenterApprovalsView', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    listSafetyCenterApprovals.mockResolvedValue([newerPending, olderPending])
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('lists pending requests oldest first with waiting days and no raw requester id', async () => {
    await render()

    const names = Array.from(container.querySelectorAll('article h3')).map((element) => element.textContent)
    expect(names).toEqual(['오래된 센터', '새 센터'])
    expect(container.textContent).toContain('ops_centers_waiting_days:{"count":5}')
    expect(container.textContent).toContain('ops_centers_waiting_days:{"count":1}')
    expect(container.textContent).toContain('buril.ac.kr')
    expect(container.textContent).not.toContain(REQUESTER_ID)
    expect(container.querySelector('[role="tablist"]')?.textContent).toContain('ops_centers_filter_pending2')
  })

  it('approves in one tap and undoes back to pending from the toast', async () => {
    await render()
    updateSafetyCenterApprovalStatus.mockResolvedValueOnce({ ...olderPending, status: 'approved', approved_at: new Date().toISOString() })

    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))

    expect(updateSafetyCenterApprovalStatus).toHaveBeenCalledWith('older', 'approved')
    expect(container.textContent).toContain('ops_centers_toast_approved')
    expect(Array.from(container.querySelectorAll('article h3')).map((element) => element.textContent)).toEqual(['새 센터'])

    updateSafetyCenterApprovalStatus.mockResolvedValueOnce(olderPending)
    await click(buttonWithText('admin_action_undo'))

    expect(updateSafetyCenterApprovalStatus).toHaveBeenLastCalledWith('older', 'pending')
    expect(container.textContent).toContain('ops_centers_toast_approval_undone')
    expect(Array.from(container.querySelectorAll('article h3')).map((element) => element.textContent)).toEqual(['오래된 센터', '새 센터'])
  })

  it('asks before rejecting and sends the chosen reason with the trimmed note', async () => {
    await render()

    await click(buttonWithText('ops_centers_action_reject', container.querySelector('article') as HTMLElement))
    const dialog = openDialog()
    expect(dialog.textContent).toContain('ops_centers_reject_confirm_title')
    expect(dialog.textContent).toContain('ops_centers_reject_shown_to_applicant')
    expect(dialog.querySelectorAll('input[type="radio"]')).toHaveLength(6)
    expect(dialog.textContent).toContain('sc_review_reason_document_unverifiable')
    expect(updateSafetyCenterApprovalStatus).not.toHaveBeenCalled()

    // No reason yet: the confirm stays disabled.
    expect(buttonWithText('ops_centers_action_reject', dialog).disabled).toBe(true)
    await click(reasonRadio(dialog, 'domain_mismatch'))
    await typeInto(noteField(dialog), '  학교 메일로 다시 신청해 주세요.  ')
    expect(dialog.textContent).toContain('ops_centers_reject_note_count:{"count":18}')
    expect(buttonWithText('ops_centers_action_reject', dialog).disabled).toBe(false)

    updateSafetyCenterApprovalStatus.mockResolvedValueOnce({
      ...olderPending, status: 'rejected', review_reason: 'domain_mismatch', review_note: '학교 메일로 다시 신청해 주세요.',
    })
    await click(buttonWithText('ops_centers_action_reject', dialog))

    expect(updateSafetyCenterApprovalStatus).toHaveBeenCalledWith('older', 'rejected', {
      reasonPreset: 'domain_mismatch', note: '학교 메일로 다시 신청해 주세요.',
    })
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain('ops_centers_toast_rejected')
  })

  it('explains why the rejection cannot be sent yet', async () => {
    await render()
    await click(buttonWithText('ops_centers_action_reject', container.querySelector('article') as HTMLElement))
    const dialog = openDialog()

    expect(dialog.textContent).not.toContain('ops_centers_reject_reason_required')
    await typeInto(noteField(dialog), '메모만 적음')
    expect(dialog.textContent).toContain('ops_centers_reject_reason_required')
    expect(buttonWithText('ops_centers_action_reject', dialog).disabled).toBe(true)

    // Other needs a note.
    await typeInto(noteField(dialog), '   ')
    await click(reasonRadio(dialog, 'other'))
    expect(dialog.textContent).not.toContain('ops_centers_reject_reason_required')
    expect(dialog.textContent).toContain('ops_centers_reject_note_required')
    expect(buttonWithText('ops_centers_action_reject', dialog).disabled).toBe(true)

    // At most 500 code points: an emoji counts once.
    await typeInto(noteField(dialog), '😀'.repeat(501))
    expect(dialog.textContent).toContain('ops_centers_reject_note_too_long')
    expect(dialog.textContent).toContain('ops_centers_reject_note_count:{"count":501}')
    expect(buttonWithText('ops_centers_action_reject', dialog).disabled).toBe(true)

    await typeInto(noteField(dialog), '😀'.repeat(500))
    expect(dialog.textContent).not.toContain('ops_centers_reject_note_too_long')
    expect(buttonWithText('ops_centers_action_reject', dialog).disabled).toBe(false)

    // Enter in the note adds a line; it never sends the rejection.
    await act(async () => {
      noteField(dialog).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(updateSafetyCenterApprovalStatus).not.toHaveBeenCalled()
  })

  it('starts every rejection with an empty form', async () => {
    await render()
    await click(buttonWithText('ops_centers_action_reject', container.querySelector('article') as HTMLElement))
    let dialog = openDialog()
    await click(reasonRadio(dialog, 'other'))
    await typeInto(noteField(dialog), '지난 메모')
    await click(buttonWithText('btn_cancel', dialog))
    expect(container.querySelector('[role="dialog"]')).toBeNull()

    await click(buttonWithText('ops_centers_action_reject', container.querySelectorAll('article')[1] as HTMLElement))
    dialog = openDialog()
    expect(Array.from(dialog.querySelectorAll<HTMLInputElement>('input[type="radio"]')).some((radio) => radio.checked)).toBe(false)
    expect(noteField(dialog).value).toBe('')
    expect(buttonWithText('ops_centers_action_reject', dialog).disabled).toBe(true)
  })

  it('shows the stored reason and note on rejected rows only', async () => {
    const longNote = '부서 공문이나 재직 증명서를 문의하기 메일로 보내 주세요. '.repeat(8).trim()
    listSafetyCenterApprovals.mockResolvedValue([
      center({ id: 'rejected', center_name: '반려된 센터', status: 'rejected', review_reason: 'other', review_note: longNote }),
      center({ id: 'reason-only', center_name: '사유만', status: 'rejected', review_reason: 'duplicate_center', review_note: null }),
      center({ id: 'legacy', center_name: '사유 없음', status: 'rejected' }),
      center({ id: 'approved', center_name: '다시 승인', status: 'approved', review_reason: 'document_unverifiable', review_note: '예전 메모' }),
    ])
    await render('/ops/centers?status=all')

    const rows: Record<string, HTMLElement> = Object.fromEntries(Array.from(container.querySelectorAll('article')).map((article) => [
      article.querySelector('h3')?.textContent ?? '', article,
    ]))
    expect(rows['반려된 센터'].textContent).toContain('ops_centers_review_reason_display:{"reason":"sc_review_reason_other"}')
    const note = Array.from(rows['반려된 센터'].querySelectorAll('p')).find((element) => element.textContent === longNote)
    expect(note?.getAttribute('title')).toBe(longNote)
    expect(note?.className).toContain('truncate')
    expect(rows['사유만'].textContent).toContain('ops_centers_review_reason_display:{"reason":"sc_review_reason_duplicate_center"}')
    expect(rows['사유 없음'].textContent).not.toContain('ops_centers_review_reason_display')
    expect(rows['다시 승인'].textContent).not.toContain('ops_centers_review_reason_display')
    expect(rows['다시 승인'].textContent).not.toContain('예전 메모')
  })

  it('undoes an approval back to rejected without sending a review, so the stored reason stays', async () => {
    const rejected = center({ id: 'rejected', center_name: '반려된 센터', status: 'rejected', review_reason: 'other', review_note: '메모' })
    listSafetyCenterApprovals.mockResolvedValue([rejected])
    await render('/ops/centers?status=rejected')
    updateSafetyCenterApprovalStatus.mockResolvedValueOnce({ ...rejected, status: 'approved', approved_at: new Date().toISOString() })

    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))
    expect(updateSafetyCenterApprovalStatus).toHaveBeenLastCalledWith('rejected', 'approved')

    updateSafetyCenterApprovalStatus.mockResolvedValueOnce(rejected)
    await click(buttonWithText('admin_action_undo'))

    expect(updateSafetyCenterApprovalStatus).toHaveBeenLastCalledWith('rejected', 'rejected')
    expect(updateSafetyCenterApprovalStatus.mock.lastCall).toHaveLength(2)
    expect(container.querySelector('article')?.textContent).toContain('ops_centers_review_reason_display')
  })

  it('moves a center back to pending without a review', async () => {
    listSafetyCenterApprovals.mockResolvedValue([center({ id: 'rejected', center_name: '반려된 센터', status: 'rejected' })])
    await render('/ops/centers?status=rejected')
    await click(buttonWithText('ops_centers_action_set_pending', container.querySelector('article') as HTMLElement))
    const dialog = openDialog()
    expect(dialog.querySelector('input[type="radio"]')).toBeNull()
    expect(buttonWithText('ops_centers_action_set_pending', dialog).disabled).toBe(false)

    updateSafetyCenterApprovalStatus.mockResolvedValueOnce(center({ id: 'rejected', center_name: '반려된 센터' }))
    await click(buttonWithText('ops_centers_action_set_pending', dialog))
    expect(updateSafetyCenterApprovalStatus).toHaveBeenCalledWith('rejected', 'pending')
  })

  it('keeps the list and names the approver role when only the status change is refused', async () => {
    await render()
    updateSafetyCenterApprovalStatus.mockRejectedValueOnce(new InternalApiError('refused', 403, 'OPERATOR_ROLE_REQUIRED'))

    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))

    expect(container.textContent).toContain('ops_access_role_title')
    expect(container.textContent).toContain('ops_access_role_needed:{"role":"approver"}')
    expect(container.querySelectorAll('article')).toHaveLength(2)
  })

  it('keeps each row busy until its own request finishes', async () => {
    await render()
    let resolveOlder: (value: SafetyCenterApprovalItem) => void = () => {}
    let resolveNewer: (value: SafetyCenterApprovalItem) => void = () => {}
    updateSafetyCenterApprovalStatus
      .mockReturnValueOnce(new Promise((resolve) => { resolveOlder = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveNewer = resolve }))

    const [olderRow, newerRow] = Array.from(container.querySelectorAll('article'))
    await click(buttonWithText('ops_centers_action_approve', olderRow))
    await click(buttonWithText('ops_centers_action_approve', newerRow))
    await act(async () => {
      resolveOlder({ ...olderPending, status: 'approved', approved_at: new Date().toISOString() })
    })

    expect(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement).disabled).toBe(true)

    await act(async () => {
      resolveNewer({ ...newerPending, status: 'approved', approved_at: new Date().toISOString() })
    })
    expect(container.querySelectorAll('article')).toHaveLength(0)
  })

  it('keeps the list when only a refresh is rate-limited', async () => {
    await render()
    listSafetyCenterApprovals.mockRejectedValueOnce(new InternalApiError('slow down', 429, 'RATE_LIMITED', 30))

    await click(buttonWithText('ops_centers_refresh'))

    expect(container.textContent).toContain('ops_access_rate_limited_title')
    expect(container.textContent).toContain('ops_access_rate_limited_wait:{"seconds":30}')
    expect(container.querySelectorAll('article')).toHaveLength(2)
  })

  it('asks before moving an approved center back to pending', async () => {
    listSafetyCenterApprovals.mockResolvedValue([
      center({ id: 'approved', center_name: '승인된 센터', status: 'approved', approved_at: new Date().toISOString() }),
    ])
    await render()

    await click(buttonWithText('ops_centers_status_approved', container.querySelector('[role="tablist"]') as HTMLElement))
    await click(buttonWithText('ops_centers_action_set_pending', container.querySelector('article') as HTMLElement))

    const dialog = container.querySelector('[role="dialog"]') as HTMLElement
    expect(dialog.textContent).toContain('ops_centers_pending_confirm_title')
    expect(dialog.textContent).toContain('ops_centers_pending_confirm_body_approved')
    expect(updateSafetyCenterApprovalStatus).not.toHaveBeenCalled()
  })

  it('shows the MFA step-up in place of the list when the list is refused', async () => {
    listSafetyCenterApprovals.mockRejectedValueOnce(new InternalApiError('mfa', 403, 'MFA_REQUIRED'))
    await render()

    expect(container.textContent).toContain('ops_access_mfa_title')
    expect(container.textContent).toContain('mfa-settings-marker')
    expect(container.querySelectorAll('article')).toHaveLength(0)
  })

  it('opens the document tab before waiting for the signed URL', async () => {
    await render()
    const documentWindow = {
      opener: {} as unknown,
      closed: false,
      document: { title: '', body: { textContent: '' } },
      location: { replace: vi.fn() },
      close: vi.fn(),
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(documentWindow as unknown as Window)
    let resolveUrl: (value: { url: string; expiresIn: number; fileName: string | null }) => void = () => {}
    getSafetyCenterVerificationDocumentUrl.mockReturnValueOnce(new Promise((resolve) => { resolveUrl = resolve }))

    await click(buttonWithText('ops_centers_open_document', container.querySelector('article') as HTMLElement))

    expect(open).toHaveBeenCalledWith('', '_blank')
    expect(documentWindow.opener).toBeNull()
    expect(documentWindow.location.replace).not.toHaveBeenCalled()

    await act(async () => {
      resolveUrl({ url: 'https://storage.example/proof.pdf', expiresIn: 60, fileName: 'proof.pdf' })
    })
    expect(documentWindow.location.replace).toHaveBeenCalledWith('https://storage.example/proof.pdf')
  })

  it('preselects the status filter from ?status and keeps the URL in sync', async () => {
    listSafetyCenterApprovals.mockResolvedValue([
      olderPending,
      center({ id: 'approved', center_name: '승인된 센터', status: 'approved', approved_at: new Date().toISOString() }),
    ])
    await render('/ops/centers?status=approved')

    expect(Array.from(container.querySelectorAll('article h3')).map((element) => element.textContent)).toEqual(['승인된 센터'])

    await click(buttonWithText('ops_centers_summary_total', container.querySelector('[role="tablist"]') as HTMLElement))
    expect(probe.search).toBe('?status=all')
    expect(container.querySelectorAll('article')).toHaveLength(2)

    await click(buttonWithText('ops_centers_filter_pending', container.querySelector('[role="tablist"]') as HTMLElement))
    expect(probe.search).toBe('')
    expect(Array.from(container.querySelectorAll('article h3')).map((element) => element.textContent)).toEqual(['오래된 센터'])
  })

  it('falls back to pending for an unknown ?status value and drops it from the URL', async () => {
    await render('/ops/centers?status=everything&from=home')
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(probe.search).toBe('?from=home')
  })

  it('keeps the home link ?status=pending as it is', async () => {
    await render('/ops/centers?status=pending')
    expect(container.querySelectorAll('article')).toHaveLength(2)
    expect(probe.search).toBe('?status=pending')
  })

  it('shows the requester domain check on pending rows only', async () => {
    listSafetyCenterApprovals.mockResolvedValue([
      center({ id: 'match', center_name: '일치', created_at: new Date(Date.now() - 3 * DAY_MS).toISOString(), requester_email_domain: 'chem.buril.ac.kr', domain_matches: true }),
      center({ id: 'mismatch', center_name: '다름', created_at: new Date(Date.now() - 2 * DAY_MS).toISOString(), requester_email_domain: 'gmail.com', domain_matches: false }),
      center({ id: 'unknown', center_name: '모름', created_at: new Date(Date.now() - DAY_MS).toISOString(), requester_email_domain: null, domain_matches: null }),
      center({ id: 'approved', center_name: '승인', status: 'approved', requester_email_domain: 'gmail.com', domain_matches: false }),
    ])
    await render('/ops/centers?status=all')

    const rows = Object.fromEntries(Array.from(container.querySelectorAll('article')).map((article) => [
      article.querySelector('h3')?.textContent, article.textContent ?? '',
    ]))
    expect(rows['일치']).toContain('ops_centers_domain_match')
    expect(rows['다름']).toContain('ops_centers_domain_mismatch:{"domain":"gmail.com"}')
    expect(rows['모름']).not.toContain('ops_centers_domain_')
    expect(rows['승인']).not.toContain('ops_centers_domain_')
  })

  it('keeps the domain check after an approval is undone', async () => {
    const checked = { ...olderPending, requester_email_domain: 'buril.ac.kr', domain_matches: true }
    listSafetyCenterApprovals.mockResolvedValue([checked])
    await render()
    updateSafetyCenterApprovalStatus.mockResolvedValueOnce({ ...olderPending, status: 'approved', approved_at: new Date().toISOString() })
    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))

    updateSafetyCenterApprovalStatus.mockResolvedValueOnce(olderPending)
    await click(buttonWithText('admin_action_undo'))

    expect(container.querySelector('article')?.textContent).toContain('ops_centers_domain_match')
  })

  it('closes the document tab and names the role when the signed URL is refused', async () => {
    await render()
    const documentWindow = {
      opener: {} as unknown,
      closed: false,
      document: { title: '', body: { textContent: '' } },
      location: { replace: vi.fn() },
      close: vi.fn(),
    }
    vi.spyOn(window, 'open').mockReturnValue(documentWindow as unknown as Window)
    getSafetyCenterVerificationDocumentUrl.mockRejectedValueOnce(new InternalApiError('refused', 403, 'OPERATOR_ROLE_REQUIRED'))

    await click(buttonWithText('ops_centers_open_document', container.querySelector('article') as HTMLElement))

    expect(documentWindow.close).toHaveBeenCalled()
    expect(container.textContent).toContain('ops_access_role_needed:{"role":"raw_exporter"}')
  })

  it('counts waiting days on the Asia/Seoul calendar', async () => {
    vi.setSystemTime(Date.parse('2026-11-06T00:00:00.000Z')) // 09:00 KST
    listSafetyCenterApprovals.mockResolvedValue([
      // 22:00 KST yesterday: 11 hours ago, but not today's request.
      center({ id: 'yesterday', center_name: '어제 센터', created_at: '2026-11-05T13:00:00.000Z' }),
      // 00:30 KST today.
      center({ id: 'today', center_name: '오늘 센터', created_at: '2026-11-05T15:30:00.000Z' }),
    ])
    await render()

    const rows = Object.fromEntries(Array.from(container.querySelectorAll('article')).map((article) => [
      article.querySelector('h3')?.textContent, article.textContent ?? '',
    ]))
    expect(rows['어제 센터']).toContain('ops_centers_waiting_days:{"count":1}')
    expect(rows['어제 센터']).not.toContain('ops_centers_waiting_today')
    expect(rows['오늘 센터']).toContain('ops_centers_waiting_today')
  })

  it('hands the list to the console after the load and after each status change', async () => {
    const onItemsChange = vi.fn()
    await render('/ops/centers', onItemsChange)

    expect(onItemsChange).toHaveBeenCalledTimes(1)
    expect(onItemsChange).toHaveBeenLastCalledWith([newerPending, olderPending], NOW)

    updateSafetyCenterApprovalStatus.mockResolvedValueOnce({ ...olderPending, status: 'approved' })
    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))

    expect(onItemsChange).toHaveBeenCalledTimes(2)
    const [items, loadedAt] = onItemsChange.mock.lastCall as [SafetyCenterApprovalItem[], number]
    expect(items.map((item) => [item.id, item.status])).toEqual([['newer', 'pending'], ['older', 'approved']])
    // Still the time of the list load: the other rows are no fresher than that.
    expect(loadedAt).toBe(NOW)
  })

  it('does not hand over an empty list when the list is refused', async () => {
    const onItemsChange = vi.fn()
    listSafetyCenterApprovals.mockRejectedValueOnce(new InternalApiError('mfa', 403, 'MFA_REQUIRED'))
    await render('/ops/centers', onItemsChange)

    expect(onItemsChange).not.toHaveBeenCalled()
  })

  it('keeps an approval that finished while a refresh was on its way', async () => {
    await render()
    let resolveList: (items: SafetyCenterApprovalItem[]) => void = () => {}
    listSafetyCenterApprovals.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve }))
    updateSafetyCenterApprovalStatus.mockResolvedValueOnce({ ...olderPending, status: 'approved' })

    await click(buttonWithText('ops_centers_refresh'))
    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))
    expect(pendingNames()).toEqual(['새 센터'])

    // The list was read before the approval: its copy of that row is older than the screen's.
    const added = center({ id: 'added', center_name: '추가된 센터', created_at: new Date(NOW - 2 * DAY_MS).toISOString() })
    await act(async () => { resolveList([added, newerPending, olderPending]) })

    expect(pendingNames()).toEqual(['추가된 센터', '새 센터'])
  })

  it('keeps the list and names the role when only an action role needs its monthly review', async () => {
    await render()
    updateSafetyCenterApprovalStatus.mockRejectedValueOnce(new InternalApiError('review', 403, 'OPERATOR_REVIEW_REQUIRED'))

    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))

    expect(container.textContent).toContain('ops_access_review_title')
    expect(container.textContent).toContain('ops_access_review_role:{"role":"approver"}')
    expect(container.querySelectorAll('article')).toHaveLength(2)
  })

  it('names the document role when opening a document needs its monthly review', async () => {
    await render()
    const documentWindow = {
      opener: {} as unknown,
      closed: false,
      document: { title: '', body: { textContent: '' } },
      location: { replace: vi.fn() },
      close: vi.fn(),
    }
    vi.spyOn(window, 'open').mockReturnValue(documentWindow as unknown as Window)
    getSafetyCenterVerificationDocumentUrl.mockRejectedValueOnce(new InternalApiError('review', 403, 'OPERATOR_REVIEW_REQUIRED'))

    await click(buttonWithText('ops_centers_open_document', container.querySelector('article') as HTMLElement))

    expect(container.textContent).toContain('ops_access_review_role:{"role":"raw_exporter"}')
    expect(container.querySelectorAll('article')).toHaveLength(2)
  })

  it('replaces the screen when the list role itself needs its monthly review', async () => {
    listSafetyCenterApprovals.mockRejectedValueOnce(new InternalApiError('review', 403, 'OPERATOR_REVIEW_REQUIRED'))
    await render()

    expect(container.textContent).toContain('ops_access_review_title')
    expect(container.textContent).toContain('ops_access_review_role:{"role":"reader"}')
    expect(container.querySelectorAll('article')).toHaveLength(0)
  })

  it('still replaces the screen when an action needs MFA', async () => {
    await render()
    updateSafetyCenterApprovalStatus.mockRejectedValueOnce(new InternalApiError('mfa', 403, 'MFA_REQUIRED'))

    await click(buttonWithText('ops_centers_action_approve', container.querySelector('article') as HTMLElement))

    expect(container.textContent).toContain('mfa-settings-marker')
    expect(container.querySelectorAll('article')).toHaveLength(0)
  })
})
