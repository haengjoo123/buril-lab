// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackInboxItem, FeedbackStatus } from '../../types/feedback'

const listFeedbackInbox = vi.fn<() => Promise<FeedbackInboxItem[]>>()
const updateFeedbackStatus = vi.fn<(id: string, status: FeedbackStatus) => Promise<FeedbackInboxItem>>()

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
vi.mock('../../services/feedbackAdminService', () => ({
  listFeedbackInbox: () => listFeedbackInbox(),
  updateFeedbackStatus: (id: string, status: FeedbackStatus) => updateFeedbackStatus(id, status),
}))
vi.mock('../../components/MfaSettingsPanel', () => ({
  MfaSettingsPanel: () => <div>mfa-settings-marker</div>,
}))

import { InternalApiError } from '../../services/internalApi'
import { FeedbackInboxView } from './FeedbackInboxView'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function feedback(overrides: Partial<FeedbackInboxItem>): FeedbackInboxItem {
  return {
    id: 'feedback-id',
    type: 'bug',
    message: 'message',
    contact: null,
    user_email: 'user@example.com',
    user_id: null,
    user_agent: null,
    created_at: '2026-11-01T00:00:00.000Z',
    status: 'new',
    resolved_at: null,
    resolved_by: null,
    lab_id: null,
    source_screen: null,
    ...overrides,
  }
}

const openItem = feedback({ id: 'open', message: '열린 제안' })
const resolvedItem = feedback({ id: 'done', message: '끝난 제안', status: 'resolved', resolved_at: '2026-11-02T00:00:00.000Z' })

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

async function render(onItemsChange?: (items: FeedbackInboxItem[], loadedAt: number) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(<FeedbackInboxView onItemsChange={onItemsChange} />)
  })
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.includes(text))
  if (!button) throw new Error(`button not found: ${text}`)
  return button
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
  })
}

async function search(value: string) {
  const input = container.querySelector('input[aria-label="cmp_feedback_admin_search_placeholder"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('search field not found')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function articleWith(text: string): HTMLElement {
  const article = Array.from(container.querySelectorAll('article')).find((element) => element.textContent?.includes(text))
  if (!article) throw new Error(`article not found: ${text}`)
  return article
}

describe('FeedbackInboxView', () => {
  beforeEach(() => {
    listFeedbackInbox.mockResolvedValue([openItem, resolvedItem])
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('opens on unresolved feedback', async () => {
    await render()

    expect(container.textContent).toContain('ops_feedback_filter_open')
    expect(container.textContent).toContain('열린 제안')
    expect(container.textContent).not.toContain('끝난 제안')
  })

  it('resolves in one tap and restores the previous status from the toast', async () => {
    await render()
    updateFeedbackStatus.mockResolvedValueOnce({ ...openItem, status: 'resolved', resolved_at: '2026-11-03T00:00:00.000Z' })

    await click(buttonWithText('ops_feedback_action_resolve'))

    expect(updateFeedbackStatus).toHaveBeenCalledWith('open', 'resolved')
    expect(container.textContent).toContain('ops_feedback_toast_resolved')
    expect(container.textContent).not.toContain('열린 제안')

    updateFeedbackStatus.mockResolvedValueOnce(openItem)
    await click(buttonWithText('admin_action_undo'))

    expect(updateFeedbackStatus).toHaveBeenLastCalledWith('open', 'new')
    expect(container.textContent).toContain('ops_feedback_toast_undone')
    expect(container.textContent).toContain('열린 제안')
  })

  it('names the approver role when only the status change is refused', async () => {
    await render()
    updateFeedbackStatus.mockRejectedValueOnce(new InternalApiError('refused', 403, 'OPERATOR_ROLE_REQUIRED'))

    await click(buttonWithText('ops_feedback_action_start'))

    expect(container.textContent).toContain('ops_access_role_needed:{"role":"approver"}')
    expect(container.textContent).toContain('열린 제안')
  })

  it('keeps the list when only a refresh is rate-limited', async () => {
    await render()
    listFeedbackInbox.mockRejectedValueOnce(new InternalApiError('slow down', 429, 'RATE_LIMITED'))

    await click(buttonWithText('cmp_feedback_admin_refresh'))

    expect(container.textContent).toContain('ops_access_rate_limited_title')
    expect(container.textContent).toContain('열린 제안')
  })

  it('replaces the old allowlist copy with the access notice when the list is refused', async () => {
    listFeedbackInbox.mockRejectedValueOnce(new InternalApiError('refused', 403, 'OPERATOR_ROLE_REQUIRED'))
    await render()

    expect(container.textContent).toContain('ops_access_role_title')
    expect(container.textContent).toContain('ops_access_role_needed:{"role":"reader"}')
    expect(container.textContent).not.toContain('cmp_feedback_admin_access_denied_desc')
  })

  it('hands the list to the console after the load and after each status change', async () => {
    const onItemsChange = vi.fn()
    await render(onItemsChange)

    expect(onItemsChange).toHaveBeenCalledTimes(1)
    expect(onItemsChange.mock.lastCall?.[0]).toEqual([openItem, resolvedItem])
    const loadedAt = onItemsChange.mock.lastCall?.[1] as number

    updateFeedbackStatus.mockResolvedValueOnce({ ...openItem, status: 'in_progress' })
    await click(buttonWithText('ops_feedback_action_start'))

    expect(onItemsChange).toHaveBeenCalledTimes(2)
    const [items, changedLoadedAt] = onItemsChange.mock.lastCall as [FeedbackInboxItem[], number]
    expect(items.map((item) => [item.id, item.status])).toEqual([['open', 'in_progress'], ['done', 'resolved']])
    expect(changedLoadedAt).toBe(loadedAt)
  })

  it('keeps a status change that finished while a refresh was on its way', async () => {
    await render()
    let resolveList: (items: FeedbackInboxItem[]) => void = () => {}
    listFeedbackInbox.mockReturnValueOnce(new Promise((resolve) => { resolveList = resolve }))
    updateFeedbackStatus.mockResolvedValueOnce({ ...openItem, status: 'resolved', resolved_at: '2026-11-03T00:00:00.000Z' })

    await click(buttonWithText('cmp_feedback_admin_refresh'))
    await click(buttonWithText('ops_feedback_action_resolve'))
    expect(container.textContent).not.toContain('열린 제안')

    // The list was read before the change: its copy of that item is older than the screen's.
    const added = feedback({ id: 'added', message: '새로 온 제안' })
    await act(async () => { resolveList([added, openItem, resolvedItem]) })

    expect(container.textContent).toContain('새로 온 제안')
    expect(container.textContent).not.toContain('열린 제안')
  })

  it('keeps the list and names the approver role when its monthly review is overdue', async () => {
    await render()
    updateFeedbackStatus.mockRejectedValueOnce(new InternalApiError('review', 403, 'OPERATOR_REVIEW_REQUIRED'))

    await click(buttonWithText('ops_feedback_action_start'))

    expect(container.textContent).toContain('ops_access_review_title')
    expect(container.textContent).toContain('ops_access_review_role:{"role":"approver"}')
    expect(container.textContent).toContain('열린 제안')
  })

  it('shows the screen and lab a feedback was sent from, and nothing when it has none', async () => {
    listFeedbackInbox.mockResolvedValue([
      feedback({ id: 'lab', message: '재고 화면 제안', lab_id: 'lab-1', source_screen: 'inventory', lab_name: '유기합성 연구실' }),
      feedback({ id: 'admin', message: '관리 화면 제안', source_screen: 'admin' }),
      feedback({ id: 'plain', message: '맥락 없는 제안' }),
      feedback({ id: 'deleted', message: '삭제된 연구실', lab_id: null, source_screen: 'logs', lab_name: null }),
    ])
    await render()

    const withLab = articleWith('재고 화면 제안').textContent
    expect(withLab).toContain('ops_feedback_source_screen')
    expect(withLab).toContain('tab_inventory')
    expect(withLab).toContain('ops_feedback_lab')
    expect(withLab).toContain('유기합성 연구실')
    expect(articleWith('관리 화면 제안').textContent).toContain('tab_audit')
    expect(articleWith('관리 화면 제안').textContent).not.toContain('ops_feedback_lab')
    expect(articleWith('맥락 없는 제안').textContent).not.toContain('ops_feedback_source_screen')
    expect(articleWith('맥락 없는 제안').textContent).not.toContain('ops_feedback_lab')
    expect(articleWith('삭제된 연구실').textContent).toContain('tab_logs')
    expect(articleWith('삭제된 연구실').textContent).not.toContain('ops_feedback_lab')
  })

  it('finds feedback by lab name and by the screen it was sent from', async () => {
    listFeedbackInbox.mockResolvedValue([
      feedback({ id: 'lab', message: '재고 화면 제안', lab_id: 'lab-1', source_screen: 'inventory', lab_name: '유기합성 연구실' }),
      feedback({ id: 'cabinet', message: '시약장 제안', source_screen: 'cabinet' }),
    ])
    await render()

    await search('유기합성')
    expect(container.textContent).toContain('재고 화면 제안')
    expect(container.textContent).not.toContain('시약장 제안')

    await search('tab_cabinet')
    expect(container.textContent).toContain('시약장 제안')
    expect(container.textContent).not.toContain('재고 화면 제안')
  })

  it('keeps the lab name after a status change, which returns the row without it', async () => {
    const withLab = feedback({ id: 'lab', message: '재고 화면 제안', lab_id: 'lab-1', source_screen: 'inventory', lab_name: '유기합성 연구실' })
    listFeedbackInbox.mockResolvedValue([withLab])
    await render()
    // The status API's row: same columns, no lab_name key.
    const statusRow = feedback({ id: 'lab', message: '재고 화면 제안', lab_id: 'lab-1', source_screen: 'inventory', status: 'in_progress' })
    expect(statusRow).not.toHaveProperty('lab_name')
    updateFeedbackStatus.mockResolvedValueOnce(statusRow)

    await click(buttonWithText('ops_feedback_action_start'))

    expect(updateFeedbackStatus).toHaveBeenCalledWith('lab', 'in_progress')
    expect(articleWith('재고 화면 제안').textContent).toContain('유기합성 연구실')
    expect(articleWith('재고 화면 제안').textContent).toContain('cmp_feedback_admin_status_in_progress')
  })

  it('still replaces the screen when a status change needs MFA', async () => {
    await render()
    updateFeedbackStatus.mockRejectedValueOnce(new InternalApiError('mfa', 403, 'MFA_REQUIRED'))

    await click(buttonWithText('ops_feedback_action_start'))

    expect(container.textContent).toContain('mfa-settings-marker')
    expect(container.textContent).not.toContain('열린 제안')
  })
})
