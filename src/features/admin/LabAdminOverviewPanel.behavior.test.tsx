// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ko', changeLanguage: vi.fn() },
  }),
}))
vi.mock('../../locales/i18n', () => ({ default: { t: (key: string) => key } }))
const flags = vi.hoisted(() => ({ isWasteContainersEnabled: false, isWasteV2Enabled: true }))
vi.mock('../../config/featureFlags', () => flags)
vi.mock('../../services/supabaseClient', () => {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'gte', 'order']) builder[method] = () => builder
  builder.limit = () => Promise.resolve({ data: [], error: null, count: 0 })
  return { supabase: { from: () => builder } }
})
vi.mock('../../services/safetyCenterService', () => ({
  safetyCenterService: {
    getLabRequests: vi.fn(),
    getLabLinkRequests: vi.fn(),
    respondLabLink: vi.fn(),
    addRequestEvent: vi.fn(),
  },
}))
vi.mock('../../services/inventoryService', () => ({ inventoryService: { getItems: vi.fn() } }))
vi.mock('../../services/labService', () => ({ labService: { getLabMembers: vi.fn() } }))
vi.mock('../../services/wasteContainerService', () => ({
  fetchWasteContainers: vi.fn(async () => []),
  fetchWasteContainerTotals: vi.fn(async () => ({})),
  setWasteContainerStatus: vi.fn(),
  toWasteContainerError: () => ({ code: 'unknown' }),
}))
vi.mock('../../services/cabinetFocusService', () => ({ focusCabinetItem: vi.fn() }))
vi.mock('../../components/LabManagementModal', () => ({ LabManagementModal: () => null }))

import { safetyCenterService } from '../../services/safetyCenterService'
import { inventoryService, type InventoryItem } from '../../services/inventoryService'
import { labService } from '../../services/labService'
import { fetchWasteContainerTotals, fetchWasteContainers, setWasteContainerStatus, type WasteContainer } from '../../services/wasteContainerService'
import { useLabStore } from '../../store/useLabStore'
import type { LabSafetyCenterLinkRequest, LabSafetyCenterRequest } from '../safety-center/types'
import { LabAdminOverviewPanel } from './LabAdminOverviewPanel'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const DAY = 24 * 60 * 60 * 1000
const LAB_ID = 'lab-1'

let container: HTMLDivElement
let root: Root
const probe = { path: '' }

function LocationProbe() {
  const { pathname, search } = useLocation()
  useEffect(() => { probe.path = `${pathname}${search}` }, [pathname, search])
  return null
}

function localDate(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function reagent(id: string, offsetDays: number): InventoryItem {
  return {
    id, lab_id: LAB_ID, user_id: null, name: `Reagent ${id}`, brand: null, product_number: null, cas_number: '67-64-1',
    quantity: 1, capacity: null, storage_type: 'other', cabinet_id: null, storage_location_id: null, product_id: null,
    expiry_date: localDate(offsetDays), manufacturer_date_type: 'expiry', received_date: null, opened_date: null, memo: null,
    remaining_percent: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }
}

function link(status: LabSafetyCenterLinkRequest['link_status']): LabSafetyCenterLinkRequest {
  return {
    link_id: 'link-1', center_id: 'center-1', center_name: 'Campus Safety Center', institution_name: 'Buril University',
    institution_domain: 'buril.ac.kr', center_status: 'approved', link_status: status,
    link_scope: ['summary', 'risk_detail'], requested_at: '2026-11-01T00:00:00Z', responded_at: null,
  }
}

function centerRequest(status: LabSafetyCenterRequest['status']): LabSafetyCenterRequest {
  // Due today on the Seoul calendar: an amber card.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
  return {
    id: 'req-1', center_id: 'center-1', center_name: 'Campus Safety Center', lab_id: LAB_ID, target_type: null, target_id: null,
    title: 'Check the MSDS binder', description: null, priority: 'normal', status, due_date: today,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  }
}

function wasteContainer(status: WasteContainer['status']): WasteContainer {
  return {
    id: 'c-1', labId: LAB_ID, streamCode: 'ORGANIC_NON_HALOGENATED', label: 'Organic-1', location: null,
    capacityMl: 20000, status, startedAt: '2026-10-01T00:00:00Z', sealedAt: status === 'sealed' ? new Date().toISOString() : null,
    collectedAt: null, collectionNote: null, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  }
}

function typeInto(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  act(() => {
    setter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => { await Promise.resolve() })
  }
}

async function render(props: { refreshKey?: number; onStartWasteBatch?: (item: InventoryItem) => Promise<void> } = {}) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/app/admin']}>
        <LabAdminOverviewPanel onOpenNewMembers={vi.fn()} {...props} />
        <LocationProbe />
      </MemoryRouter>,
    )
  })
  await flush()
}

const heading = () => document.getElementById('lab-admin-tasks-heading')

function buttons(label: string, scope: ParentNode = container): HTMLButtonElement[] {
  return [...scope.querySelectorAll('button')].filter((element) => element.textContent?.trim() === label)
}

async function click(element: HTMLElement) {
  // Keyboard-like: the control has focus when it is activated.
  element.focus()
  await act(async () => { element.click() })
  await flush()
}

beforeEach(() => {
  vi.clearAllMocks()
  flags.isWasteContainersEnabled = false
  localStorage.clear()
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub
  useLabStore.setState({
    currentLabId: LAB_ID,
    myLabs: [{
      id: 'membership-1', lab_id: LAB_ID, user_id: 'admin-user', role: 'admin', joined_at: '2026-01-01T00:00:00Z',
      lab: { id: LAB_ID, name: 'Lab', created_by: 'admin-user', created_at: '2026-01-01T00:00:00Z', join_password_needs_change: false },
    }],
  })
  vi.mocked(safetyCenterService.getLabRequests).mockResolvedValue([])
  vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([])
  vi.mocked(inventoryService.getItems).mockResolvedValue([])
  vi.mocked(labService.getLabMembers).mockResolvedValue([
    { user_id: 'admin-user', role: 'admin', joined_at: '2026-01-01T00:00:00Z', email: 'admin@example.com' },
  ])
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('LabAdminOverviewPanel', () => {
  it('shows one quiet line when every source loaded and nothing needs attention', async () => {
    await render()
    expect(container.textContent).toContain('admin_overview_quiet')
    expect(container.querySelectorAll('li').length).toBe(0)
    // Every source was asked once, for this lab.
    expect(safetyCenterService.getLabRequests).toHaveBeenCalledWith(LAB_ID)
    expect(labService.getLabMembers).toHaveBeenCalledWith(LAB_ID)
  })

  it('shows a failed source inline with a retry instead of the quiet line', async () => {
    vi.mocked(inventoryService.getItems).mockRejectedValueOnce(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await render()
    expect(container.textContent).not.toContain('admin_overview_quiet')
    expect(container.textContent).toContain('admin_overview_source_error')

    await click(buttons('search_retry')[0])
    expect(inventoryService.getItems).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('admin_overview_quiet')
  })

  it('hides a task for the week and brings it back from the hidden list', async () => {
    vi.mocked(labService.getLabMembers).mockResolvedValue([
      { user_id: 'admin-user', role: 'admin', joined_at: '2026-01-01T00:00:00Z', email: 'admin@example.com' },
      { user_id: 'new-user', role: 'student', joined_at: new Date(Date.now() - DAY).toISOString(), email: 'new@example.com' },
    ])
    await render()
    expect(container.textContent).toContain('admin_overview_task_new_members')
    expect(container.textContent).not.toContain('admin_overview_quiet')

    await click(buttons('lab_admin_snooze_week')[0])
    expect(container.textContent).not.toContain('admin_overview_task_new_members')
    expect(container.textContent).toContain('admin_overview_quiet')
    expect(container.textContent).toContain('admin_overview_snoozed_count')
    // Keyed by the newest member: someone joining later this week shows the card again.
    expect(Object.keys(JSON.parse(localStorage.getItem(`buril.labAdmin.snooze.${LAB_ID}`) ?? '{}'))).toEqual(['new_members:new-user'])
    // The focused button left with its card: focus lands on the list heading, not <body>.
    expect(document.activeElement).toBe(heading())

    await click(buttons('admin_overview_snoozed_count')[0])
    await click(buttons('admin_overview_unsnooze')[0])
    expect(container.textContent).toContain('admin_overview_task_new_members')
    expect(container.textContent).not.toContain('admin_overview_snoozed_count')
    expect(localStorage.getItem(`buril.labAdmin.snooze.${LAB_ID}`)).toBeNull()
    // Nothing else was hidden: focus follows the card back into the list.
    expect(document.activeElement).toBe(buttons('admin_overview_check_roles')[0])
  })

  it('moves focus to the next card when one is hidden or shown again', async () => {
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([link('requested')])
    vi.mocked(labService.getLabMembers).mockResolvedValue([
      { user_id: 'admin-user', role: 'admin', joined_at: '2026-01-01T00:00:00Z', email: 'admin@example.com' },
      { user_id: 'new-user', role: 'student', joined_at: new Date(Date.now() - DAY).toISOString(), email: 'new@example.com' },
    ])
    await render()
    // Amber link request first, then the slate new-member card.
    await click(buttons('lab_admin_snooze_week')[0])
    expect(container.textContent).not.toContain('cmp_lsc_center_link_requests')
    expect(document.activeElement).toBe(buttons('admin_overview_check_roles')[0])

    await click(buttons('lab_admin_snooze_week')[0])
    expect(document.activeElement).toBe(heading())

    // Showing a hidden card again moves on to the next hidden one.
    await click(buttons('admin_overview_snoozed_count')[0])
    await click(buttons('admin_overview_unsnooze')[0])
    expect(buttons('admin_overview_unsnooze')).toHaveLength(1)
    expect(document.activeElement).toBe(buttons('admin_overview_unsnooze')[0])
  })

  it('brings focus back to the card when hiding it is undone from the toast', async () => {
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([link('requested')])
    vi.mocked(labService.getLabMembers).mockResolvedValue([
      { user_id: 'admin-user', role: 'admin', joined_at: '2026-01-01T00:00:00Z', email: 'admin@example.com' },
      { user_id: 'new-user', role: 'student', joined_at: new Date(Date.now() - DAY).toISOString(), email: 'new@example.com' },
    ])
    await render()
    await click(buttons('lab_admin_snooze_week')[0])
    expect(container.textContent).not.toContain('cmp_lsc_center_link_requests')

    // The undo button leaves with the toast: focus lands on the card that came back.
    await click(buttons('admin_action_undo')[0])
    expect(container.textContent).toContain('cmp_lsc_center_link_requests')
    expect(buttons('admin_action_undo')).toHaveLength(0)
    expect(document.activeElement).toBe(buttons('cmp_lsc_approve')[0])
  })

  it('reloads reagents and containers in place when a disposal is recorded, not on mount', async () => {
    flags.isWasteContainersEnabled = true
    vi.mocked(fetchWasteContainers).mockResolvedValue([])
    vi.mocked(inventoryService.getItems)
      .mockResolvedValueOnce([reagent('expired', -2)])
      .mockResolvedValue([])
    const onStartWasteBatch = vi.fn(async () => {})
    await render({ refreshKey: 0, onStartWasteBatch })
    expect(inventoryService.getItems).toHaveBeenCalledTimes(1)
    expect(fetchWasteContainers).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('admin_overview_task_expiry')

    await click(buttons('inventory_start_waste_batch')[0])
    expect(onStartWasteBatch).toHaveBeenCalledWith(expect.objectContaining({ id: 'expired' }))
    expect(container.textContent).toContain('admin_overview_disposal_started')
    expect(inventoryService.getItems).toHaveBeenCalledTimes(1)

    // CartView recorded the disposal: App bumps the key.
    await render({ refreshKey: 1, onStartWasteBatch })
    expect(inventoryService.getItems).toHaveBeenCalledTimes(2)
    // Container fill can change with a deposit: containers reload too.
    expect(fetchWasteContainers).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('admin_overview_task_expiry')
    expect(container.textContent).toContain('admin_overview_quiet')
    // The result toast stays: the panel was not remounted.
    expect(container.textContent).toContain('admin_overview_disposal_started')
    // Only reagents (and containers, when on) reload; the other sources keep their data.
    expect(safetyCenterService.getLabRequests).toHaveBeenCalledTimes(1)
  })

  it('opens one inventory list holding both expired and expiring reagents', async () => {
    vi.mocked(inventoryService.getItems).mockResolvedValue([reagent('expired', -1), reagent('soon', 3), reagent('later', 20)])
    await render()
    expect(container.textContent).toContain('admin_overview_expiry_within7')
    expect(container.textContent).toContain('admin_overview_expiry_within30')
    await click(buttons('admin_overview_open_list')[0])
    expect(probe.path).toBe('/app/inventory?filter=attention')
  })

  it('leaves out the 30-day count when it adds nothing past 7 days', async () => {
    vi.mocked(inventoryService.getItems).mockResolvedValue([reagent('soon', 3), reagent('sooner', 2)])
    await render()
    expect(container.textContent).toContain('admin_overview_expiry_within7')
    expect(container.textContent).not.toContain('admin_overview_expiry_within30')
    await click(buttons('admin_overview_open_list')[0])
    expect(probe.path).toBe('/app/inventory?filter=expiring')
  })

  it('approves a center link only after a dialog that explains what the center will see', async () => {
    vi.mocked(safetyCenterService.getLabLinkRequests)
      .mockResolvedValueOnce([link('requested')])
      .mockResolvedValue([link('approved')])
    vi.mocked(safetyCenterService.respondLabLink).mockResolvedValue(undefined)
    await render()
    expect(container.textContent).toContain('cmp_lsc_center_link_requests')

    await click(buttons('cmp_lsc_approve')[0])
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('admin_overview_link_approve_title')
    expect(dialog?.textContent).toContain('admin_overview_link_approve_body')
    expect(safetyCenterService.respondLabLink).not.toHaveBeenCalled()

    await click(buttons('cmp_lsc_approve', dialog!)[0])
    expect(safetyCenterService.respondLabLink).toHaveBeenCalledWith('link-1', 'approved')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    // The row (and its 승인 button the dialog would refocus) is gone: the heading takes focus.
    expect(document.activeElement).toBe(heading())
    expect(container.textContent).toContain('admin_overview_link_approved')
    // The link list was reloaded: the request is gone and the center now counts as linked.
    expect(safetyCenterService.getLabLinkRequests).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('cmp_lsc_center_link_requests')
    expect(container.textContent).toContain('Campus Safety Center')
  })

  it('answers a center request from a sheet that starts in the text box', async () => {
    vi.mocked(safetyCenterService.getLabRequests)
      .mockResolvedValueOnce([centerRequest('open')])
      .mockResolvedValue([centerRequest('submitted')])
    vi.mocked(safetyCenterService.addRequestEvent).mockResolvedValue(undefined)
    await render()
    expect(container.textContent).toContain('cmp_lsc_center_check_requests')

    await click(buttons('admin_overview_reply_write')[0])
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const textarea = dialog.querySelector('textarea')!
    expect(document.activeElement).toBe(textarea)
    const submit = buttons('cmp_lsc_submit_reply', dialog)[0]
    expect(submit.disabled).toBe(true)

    typeInto(textarea, 'Binder is in place.')
    await click(submit)
    expect(safetyCenterService.addRequestEvent).toHaveBeenCalledWith('req-1', 'Binder is in place.', 'submitted')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain('admin_overview_reply_sent')
    // Reloaded: the submitted request now waits on the center, so the card is gone.
    expect(safetyCenterService.getLabRequests).toHaveBeenCalledTimes(2)
    expect(container.textContent).not.toContain('cmp_lsc_center_check_requests')
  })

  it('seals a nearly full container and undoes it from the toast', async () => {
    flags.isWasteContainersEnabled = true
    vi.mocked(fetchWasteContainers)
      .mockResolvedValueOnce([wasteContainer('active')])
      .mockResolvedValueOnce([wasteContainer('sealed')])
      .mockResolvedValue([wasteContainer('active')])
    vi.mocked(fetchWasteContainerTotals).mockResolvedValue({ 'c-1': { depositCount: 3, totalMl: 17000, hasUnknownAmounts: false } })
    vi.mocked(setWasteContainerStatus).mockResolvedValue(wasteContainer('sealed'))
    await render()
    expect(container.textContent).toContain('admin_overview_task_container_full')

    await click(buttons('봉인')[0])
    expect(setWasteContainerStatus).toHaveBeenCalledWith('c-1', 'sealed')
    expect(container.textContent).toContain('admin_overview_container_sealed_toast')
    expect(container.textContent).not.toContain('admin_overview_task_container_full')
    expect(document.activeElement).toBe(heading())

    await click(buttons('admin_action_undo')[0])
    expect(setWasteContainerStatus).toHaveBeenLastCalledWith('c-1', 'active')
    expect(container.textContent).toContain('admin_overview_container_reopened_toast')
    expect(fetchWasteContainers).toHaveBeenCalledTimes(3)
    expect(container.textContent).toContain('admin_overview_task_container_full')
  })

  it('keeps the link request when the dialog is cancelled', async () => {
    vi.mocked(safetyCenterService.getLabLinkRequests).mockResolvedValue([link('requested')])
    await render()
    await click(buttons('cmp_lsc_reject')[0])
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog?.textContent).toContain('admin_overview_link_reject_title')
    await click(buttons('btn_cancel', dialog!)[0])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(safetyCenterService.respondLabLink).not.toHaveBeenCalled()
    expect(container.textContent).toContain('cmp_lsc_center_link_requests')
  })
})
