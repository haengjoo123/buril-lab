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
const flags = vi.hoisted(() => ({ isWasteV2Enabled: true }))
vi.mock('../../config/featureFlags', () => flags)
vi.mock('../../components/WastePolicySettingsPanel', () => ({ WastePolicySettingsPanel: () => <p>waste-panel</p> }))
vi.mock('./GlobalAuditLogsView', () => ({ GlobalAuditLogsView: () => <p>activity-panel</p> }))
vi.mock('./LabSafetyCenterPanel', () => ({ LabSafetyCenterPanel: () => <p>center-panel</p> }))
vi.mock('./MemberManagementPanel', () => ({ MemberManagementPanel: () => <p>members-panel</p> }))
vi.mock('./LabAdminOverviewPanel', () => ({
  LabAdminOverviewPanel: ({ onOpenNewMembers, refreshKey }: { onOpenNewMembers: () => void; refreshKey?: number }) => (
    <button type="button" onClick={onOpenNewMembers} data-refresh-key={refreshKey}>overview-panel</button>
  ),
}))

import { useLabStore } from '../../store/useLabStore'
import { LabAdminView } from './LabAdminView'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
const probe = { search: '' }

function LocationProbe() {
  const { search } = useLocation()
  useEffect(() => { probe.search = search }, [search])
  return null
}

async function render(path: string, refreshKey?: number) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <LabAdminView refreshKey={refreshKey} />
        <LocationProbe />
      </MemoryRouter>,
    )
  })
}

function tab(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((element) => element.textContent === label)
  if (!match) throw new Error(`No tab ${label}`)
  return match
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

async function press(key: string, init: KeyboardEventInit = {}) {
  const target = document.activeElement as HTMLElement
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

const tabIndexes = () => [...container.querySelectorAll<HTMLElement>('[role="tab"]')].map((element) => element.tabIndex)

beforeEach(() => {
  flags.isWasteV2Enabled = true
  useLabStore.setState({ currentLabId: 'lab-1' })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('LabAdminView tabs', () => {
  it('opens on the overview with five short tabs', async () => {
    await render('/app/admin')
    expect(container.textContent).toContain('overview-panel')
    expect([...container.querySelectorAll('[role="tab"]')].map((element) => element.textContent)).toEqual([
      'admin_tab_overview', 'admin_tab_members_short', 'admin_tab_center_short', 'admin_tab_activity_short', 'admin_tab_waste_short',
    ])
    expect(tab('admin_tab_overview').getAttribute('aria-selected')).toBe('true')
    expect(probe.search).toBe('')
  })

  it('keeps the open tab in ?tab= and drops tab-only params on switch', async () => {
    await render('/app/admin?tab=members&filter=new')
    expect(container.textContent).toContain('members-panel')
    await click(tab('admin_tab_activity_short'))
    expect(probe.search).toBe('?tab=activity')
    expect(container.textContent).toContain('activity-panel')
    await click(tab('admin_tab_overview'))
    expect(probe.search).toBe('')
  })

  it('opens the new members from the overview', async () => {
    await render('/app/admin')
    await click([...container.querySelectorAll('button')].find((element) => element.textContent === 'overview-panel')!)
    expect(probe.search).toBe('?tab=members&filter=new')
    expect(container.textContent).toContain('members-panel')
  })

  it('falls back to the overview for an unknown tab', async () => {
    await render('/app/admin?tab=nope')
    expect(container.textContent).toContain('overview-panel')
    expect(probe.search).toBe('')
  })

  it('moves between tabs with the arrow, Home and End keys, keeping one tab stop', async () => {
    await render('/app/admin')
    expect(tabIndexes()).toEqual([0, -1, -1, -1, -1])
    tab('admin_tab_overview').focus()

    await press('ArrowRight')
    expect(probe.search).toBe('?tab=members')
    expect(document.activeElement).toBe(tab('admin_tab_members_short'))
    expect(tab('admin_tab_members_short').getAttribute('aria-selected')).toBe('true')
    expect(tabIndexes()).toEqual([-1, 0, -1, -1, -1])
    expect(container.textContent).toContain('members-panel')

    await press('End')
    expect(probe.search).toBe('?tab=waste')
    expect(document.activeElement).toBe(tab('admin_tab_waste_short'))

    // Wraps around at both ends.
    await press('ArrowRight')
    expect(probe.search).toBe('')
    expect(document.activeElement).toBe(tab('admin_tab_overview'))
    await press('ArrowLeft')
    expect(probe.search).toBe('?tab=waste')

    await press('Home')
    expect(probe.search).toBe('')
    expect(document.activeElement).toBe(tab('admin_tab_overview'))
    expect(container.textContent).toContain('overview-panel')

    // Alt+Left is browser back: the tabs leave it alone.
    await press('ArrowLeft', { altKey: true })
    expect(probe.search).toBe('')
    expect(document.activeElement).toBe(tab('admin_tab_overview'))
  })

  it('gives inactive tabs a readable dark-mode color', async () => {
    await render('/app/admin')
    expect(tab('admin_tab_members_short').className).toContain('dark:text-slate-400')
    expect(tab('admin_tab_overview').className).toContain('dark:text-red-400')
  })

  it('passes the disposal refresh key to the overview', async () => {
    await render('/app/admin', 3)
    const overview = [...container.querySelectorAll('button')].find((element) => element.textContent === 'overview-panel')!
    expect(overview.getAttribute('data-refresh-key')).toBe('3')
  })

  it('hides the waste tab when waste v2 is off', async () => {
    flags.isWasteV2Enabled = false
    await render('/app/admin?tab=waste')
    expect(container.textContent).not.toContain('admin_tab_waste_short')
    expect(container.textContent).toContain('overview-panel')
    expect(probe.search).toBe('')
  })
})
