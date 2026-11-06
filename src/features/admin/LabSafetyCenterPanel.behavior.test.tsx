// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A stable t: the panel reloads whenever its load callback (which depends on t) changes.
const translation = vi.hoisted(() => ({
  t: (key: string) => key,
  i18n: { language: 'ko' },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
}))
vi.mock('../../locales/i18n', () => ({ default: { t: (key: string) => key } }))
vi.mock('../../services/safetyCenterService', () => ({
  safetyCenterService: {
    getLabRequests: vi.fn(),
    getLabLinkRequests: vi.fn(),
    respondLabLink: vi.fn(),
    addRequestEvent: vi.fn(),
  },
}))
vi.mock('../../components/LabManagementModal', () => ({ LabManagementModal: () => null }))

import { safetyCenterService } from '../../services/safetyCenterService'
import { useLabStore } from '../../store/useLabStore'
import { primeLabAdminAttention, useLabAdminAttentionStore } from '../../store/useLabAdminAttentionStore'
import type { LabSafetyCenterLinkRequest, LabSafetyCenterRequest } from '../safety-center/types'
import { LabSafetyCenterPanel } from './LabSafetyCenterPanel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LAB_ID = 'lab-1'
let container: HTMLDivElement
let root: Root

function link(linkStatus: LabSafetyCenterLinkRequest['link_status'], centerStatus: LabSafetyCenterLinkRequest['center_status'] = 'approved'): LabSafetyCenterLinkRequest {
  return {
    link_id: 'link-1', center_id: 'center-1', center_name: 'Campus Safety Center', institution_name: 'Buril University',
    institution_domain: 'buril.ac.kr', center_status: centerStatus, link_status: linkStatus,
    link_scope: ['summary'], requested_at: '2026-11-01T00:00:00Z', responded_at: '2026-11-02T00:00:00Z',
  }
}

function request(status: LabSafetyCenterRequest['status']): LabSafetyCenterRequest {
  return {
    id: 'req-1', center_id: 'center-1', center_name: 'Campus Safety Center', lab_id: LAB_ID, target_type: null, target_id: null,
    title: 'Check the MSDS binder', description: null, priority: 'normal', status, due_date: null,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  }
}

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function render() {
  await act(async () => {
    root.render(<LabSafetyCenterPanel />)
  })
  await flush()
}

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
}

function typeInto(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  useLabStore.setState({
    currentLabId: LAB_ID,
    myLabs: [{
      id: 'membership-1', lab_id: LAB_ID, user_id: 'admin-user', role: 'admin', joined_at: '2026-01-01T00:00:00Z',
      lab: { id: LAB_ID, name: 'Lab', created_by: 'admin-user', created_at: '2026-01-01T00:00:00Z', institution_name: 'Buril University' },
    }],
  })
  useLabAdminAttentionStore.setState({ entries: {}, generation: {} })
  vi.mocked(safetyCenterService.addRequestEvent).mockResolvedValue(undefined)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('LabSafetyCenterPanel request flow', () => {
  it('stops at the reply: a submitted request waits for the center, and only a note can be sent', async () => {
    vi.mocked(safetyCenterService.getLabRequests).mockResolvedValue([request('submitted')])
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([link('approved')])
    await render()

    expect(container.textContent).toContain('cmp_lsc_waiting_center')
    expect(container.textContent).not.toContain('cmp_lsc_complete')
    expect(button('cmp_lsc_close_unlinked')).toBeUndefined()
    const send = button('cmp_lsc_send_comment')
    expect(send?.disabled).toBe(true)

    primeLabAdminAttention(LAB_ID, 1)
    typeInto(container.querySelector('textarea')!, '  Photo attached  ')
    expect(send?.disabled).toBe(false)
    await click(send!)
    expect(safetyCenterService.addRequestEvent).toHaveBeenCalledWith('req-1', 'Photo attached', undefined)
    // The admin tab badge reloads after the action.
    expect(useLabAdminAttentionStore.getState().entries[LAB_ID]).toBeUndefined()
  })

  it('moves an open request to in progress, then to submitted', async () => {
    vi.mocked(safetyCenterService.getLabRequests).mockResolvedValue([request('open')])
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([link('approved')])
    await render()
    await click(button('cmp_lsc_start')!)
    expect(safetyCenterService.addRequestEvent).toHaveBeenCalledWith('req-1', undefined, 'in_progress')
  })

  it('lets the lab close a request the center can no longer see', async () => {
    vi.mocked(safetyCenterService.getLabRequests).mockResolvedValue([request('submitted')])
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([link('revoked')])
    await render()

    expect(container.textContent).toContain('cmp_lsc_center_unlinked')
    expect(container.textContent).not.toContain('cmp_lsc_waiting_center')
    typeInto(container.querySelector('textarea')!, 'Center unlinked')
    await click(button('cmp_lsc_close_unlinked')!)
    expect(safetyCenterService.addRequestEvent).toHaveBeenCalledWith('req-1', 'Center unlinked', 'resolved')
  })

  it('also offers closing when the center itself is no longer approved', async () => {
    vi.mocked(safetyCenterService.getLabRequests).mockResolvedValue([request('in_progress')])
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([link('approved', 'rejected')])
    await render()
    expect(button('cmp_lsc_close_unlinked')).toBeDefined()
    expect(button('cmp_lsc_submit_reply')).toBeDefined()
  })

  it('shows no actions on a resolved request', async () => {
    vi.mocked(safetyCenterService.getLabRequests).mockResolvedValue([request('resolved')])
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([link('revoked')])
    await render()
    expect(container.querySelector('textarea')).toBeNull()
    expect(button('cmp_lsc_close_unlinked')).toBeUndefined()
  })
})
