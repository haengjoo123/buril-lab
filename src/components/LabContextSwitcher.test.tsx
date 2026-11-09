import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabMember } from '../store/useLabStore'

const labStoreState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('../store/useLabStore', () => ({
  useLabStore: () => labStoreState.current,
}))

vi.mock('../services/labService', () => ({
  LAB_MEMBERSHIP_LIMIT: 3,
  labService: { getMyLabs: vi.fn(() => Promise.resolve([])) },
}))

vi.mock('./LabManagementModal', () => ({ LabManagementModal: () => null }))

import { LabContextSwitcher } from './LabContextSwitcher'
import { resolveLabSegmentAction } from './labContextSegment'

const member = (labId: string, name: string): LabMember => ({
  id: `member-${labId}`,
  lab_id: labId,
  user_id: 'user-1',
  role: 'graduate',
  joined_at: '2026-01-01T00:00:00.000Z',
  lab: { id: labId, name, created_by: 'user-0', created_at: '2026-01-01T00:00:00.000Z' },
})

const labs = [member('lab-a', 'Kim Lab'), member('lab-b', 'Shared Instruments')]

describe('resolveLabSegmentAction', () => {
  it('returns to the last used lab from personal space', () => {
    expect(resolveLabSegmentAction({ currentLabId: null, lastLabId: 'lab-b', myLabs: labs, labsReady: true }))
      .toEqual({ type: 'switch', labId: 'lab-b' })
  })

  it('falls back to the first lab when the last lab is unknown or was left', () => {
    expect(resolveLabSegmentAction({ currentLabId: null, lastLabId: 'lab-gone', myLabs: labs, labsReady: true }))
      .toEqual({ type: 'switch', labId: 'lab-a' })
    expect(resolveLabSegmentAction({ currentLabId: null, lastLabId: null, myLabs: labs, labsReady: true }))
      .toEqual({ type: 'switch', labId: 'lab-a' })
  })

  it('opens lab management when the user has no labs', () => {
    expect(resolveLabSegmentAction({ currentLabId: null, lastLabId: null, myLabs: [], labsReady: true }))
      .toEqual({ type: 'open-manage' })
  })

  it('toggles the lab list when already in a lab or while labs are loading', () => {
    expect(resolveLabSegmentAction({ currentLabId: 'lab-a', lastLabId: 'lab-a', myLabs: labs, labsReady: true }))
      .toEqual({ type: 'toggle-menu' })
    expect(resolveLabSegmentAction({ currentLabId: null, lastLabId: null, myLabs: [], labsReady: false }))
      .toEqual({ type: 'toggle-menu' })
  })
})

describe('LabContextSwitcher segments', () => {
  beforeEach(() => {
    labStoreState.current = {
      currentLabId: null,
      lastLabId: null,
      myLabs: labs,
      setCurrentLabId: vi.fn(),
      setMyLabs: vi.fn(),
    }
  })

  it('marks personal space as the pressed segment by default', () => {
    const html = renderToStaticMarkup(<LabContextSwitcher />)

    expect(html).toContain('role="group" aria-label="lab_switcher_title"')
    expect(html).toMatch(/aria-pressed="true" aria-label="lab_personal_space"/)
    expect(html).toContain('lab_segment_personal')
    expect(html).toContain('lab_segment_lab')
  })

  it('shows the current lab name in the selected segment that opens the lab list', () => {
    labStoreState.current = { ...labStoreState.current, currentLabId: 'lab-b' }
    const html = renderToStaticMarkup(<LabContextSwitcher />)

    expect(html).toContain('Shared Instruments')
    expect(html).not.toContain('lab_segment_lab')
    expect(html).toMatch(/data-testid="lab-context-lab-segment"[^>]*aria-pressed="true"[^>]*aria-haspopup="menu"/)
  })
})

describe('useLabStore lastLabId', () => {
  it('remembers the lab the user left for personal space', async () => {
    const { useLabStore } = await vi.importActual<typeof import('../store/useLabStore')>('../store/useLabStore')
    // Node has no localStorage, so the persist middleware warns on every write.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useLabStore.setState({ currentLabId: 'lab-a', lastLabId: null })

    useLabStore.getState().setCurrentLabId(null)
    expect(useLabStore.getState()).toMatchObject({ currentLabId: null, lastLabId: 'lab-a' })

    useLabStore.getState().setCurrentLabId('lab-b')
    expect(useLabStore.getState()).toMatchObject({ currentLabId: 'lab-b', lastLabId: 'lab-b' })

    useLabStore.getState().clearLabState()
    expect(useLabStore.getState()).toMatchObject({ currentLabId: null, lastLabId: null })
    warn.mockRestore()
  })

  it('persists memberships so the first render already knows the role, and tracks loading', async () => {
    const items = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => { items.set(key, value) },
      removeItem: (key: string) => { items.delete(key) },
    })
    vi.resetModules()
    const { useLabStore } = await vi.importActual<typeof import('../store/useLabStore')>('../store/useLabStore')
    expect(useLabStore.getState().labsLoaded).toBe(false)

    const admin = { ...member('lab-a', 'Kim Lab'), role: 'admin' as const }
    useLabStore.getState().setCurrentLabId('lab-a')
    useLabStore.getState().setMyLabs([admin])
    expect(useLabStore.getState().labsLoaded).toBe(true)

    const persisted = JSON.parse(items.get('lab-storage') ?? '{}').state
    expect(persisted).toMatchObject({ currentLabId: 'lab-a', myLabs: [admin] })
    expect(persisted).not.toHaveProperty('labsLoaded')

    useLabStore.getState().clearLabState()
    expect(useLabStore.getState()).toMatchObject({ myLabs: [], labsLoaded: false })
    expect(JSON.parse(items.get('lab-storage') ?? '{}').state.myLabs).toEqual([])
    vi.unstubAllGlobals()
  })
})
