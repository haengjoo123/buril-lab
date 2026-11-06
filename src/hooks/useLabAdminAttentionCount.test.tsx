// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const loaders = vi.hoisted(() => ({
  centerRequests: vi.fn(),
  wasteContainers: vi.fn(),
  linkRequests: vi.fn(),
}))
const sourceKeys = vi.hoisted(() => ({ value: ['centerRequests', 'linkRequests', 'inventory', 'dangerWarnings', 'members'] }))
vi.mock('../services/labAdminOverviewService', () => ({
  getLabAdminSourceKeys: () => sourceKeys.value,
  labAdminSourceLoaders: loaders,
}))

import { useLabStore } from '../store/useLabStore'
import {
  LAB_ADMIN_ATTENTION_TTL_MS,
  invalidateLabAdminAttention,
  primeLabAdminAttention,
  useLabAdminAttentionStore,
} from '../store/useLabAdminAttentionStore'
import type { AppTab } from './useAppUiState'
import { getLabAdminAttentionSourceKeys, loadLabAdminAttention, useLabAdminAttentionCount } from './useLabAdminAttentionCount'

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const LAB = 'lab-1'
const overdue = (id: string) => ({ id, title: id, center_name: 'Center', status: 'open', due_date: '2020-01-01' })

let container: HTMLDivElement
let root: Root
const seen = {
  get count() {
    return Number(container.textContent)
  },
}

function Probe(props: { labId: string | null; isAdmin: boolean; activeTab: AppTab }) {
  return <output>{useLabAdminAttentionCount(props)}</output>
}

async function render(props: { labId: string | null; isAdmin: boolean; activeTab: AppTab }) {
  await act(async () => {
    root.render(<Probe {...props} />)
  })
  // Let the loads settle and their state updates commit.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

beforeEach(() => {
  vi.useRealTimers()
  loaders.centerRequests.mockReset().mockResolvedValue([overdue('r1'), overdue('r2')])
  loaders.wasteContainers.mockReset().mockResolvedValue([])
  loaders.linkRequests.mockReset().mockResolvedValue([])
  sourceKeys.value = ['centerRequests', 'linkRequests', 'inventory', 'dangerWarnings', 'members']
  useLabAdminAttentionStore.setState({ entries: {}, generation: {} })
  useLabStore.setState({ currentLabId: LAB })
  window.localStorage.clear()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
})

describe('getLabAdminAttentionSourceKeys', () => {
  it('keeps only the sources that can turn red', () => {
    expect(getLabAdminAttentionSourceKeys(['centerRequests', 'linkRequests', 'inventory', 'dangerWarnings', 'wasteContainers', 'members']))
      .toEqual(['centerRequests', 'wasteContainers'])
    expect(getLabAdminAttentionSourceKeys(['centerRequests', 'linkRequests', 'members'])).toEqual(['centerRequests'])
  })
})

describe('loadLabAdminAttention', () => {
  it('counts what loaded and ignores a failed source', async () => {
    loaders.wasteContainers.mockRejectedValue(new Error('down'))
    const outcome = await loadLabAdminAttention(LAB, { sources: ['centerRequests', 'wasteContainers'] })
    expect(outcome).toBe('primed')
    expect(useLabAdminAttentionStore.getState().entries[LAB]?.count).toBe(2)
  })

  it('stores nothing when every source failed', async () => {
    loaders.centerRequests.mockRejectedValue(new Error('down'))
    expect(await loadLabAdminAttention(LAB)).toBe('failed')
    expect(useLabAdminAttentionStore.getState().entries[LAB]).toBeUndefined()
  })

  it('drops a result invalidated while it loaded, or loaded for a lab no longer shown', async () => {
    let resolve: (value: unknown) => void = () => {}
    loaders.centerRequests.mockReturnValue(new Promise((done) => { resolve = done }))
    const pending = loadLabAdminAttention(LAB)
    // A second caller shares the load in flight.
    expect(loadLabAdminAttention(LAB)).toBe(pending)
    invalidateLabAdminAttention(LAB)
    resolve([overdue('r1')])
    expect(await pending).toBe('stale')
    expect(useLabAdminAttentionStore.getState().entries[LAB]).toBeUndefined()

    loaders.centerRequests.mockResolvedValue([overdue('r1')])
    expect(await loadLabAdminAttention(LAB, { getCurrentLabId: () => 'other-lab' })).toBe('dropped')
    expect(useLabAdminAttentionStore.getState().entries[LAB]).toBeUndefined()
  })
})

describe('useLabAdminAttentionCount', () => {
  it('loads nothing and shows nothing for a member who is not an admin, or in personal space', async () => {
    await render({ labId: LAB, isAdmin: false, activeTab: 'search' })
    expect(seen.count).toBe(0)
    await render({ labId: null, isAdmin: true, activeTab: 'logs' })
    expect(seen.count).toBe(0)
    expect(loaders.centerRequests).not.toHaveBeenCalled()
  })

  it('loads once and does not reload on tab changes while the count is fresh', async () => {
    await render({ labId: LAB, isAdmin: true, activeTab: 'search' })
    expect(seen.count).toBe(2)
    await render({ labId: LAB, isAdmin: true, activeTab: 'logs' })
    await render({ labId: LAB, isAdmin: true, activeTab: 'admin' })
    expect(seen.count).toBe(2)
    expect(loaders.centerRequests).toHaveBeenCalledTimes(1)
    // Link requests are always amber and the containers are off in this build: never loaded.
    expect(loaders.linkRequests).not.toHaveBeenCalled()
    expect(loaders.wasteContainers).not.toHaveBeenCalled()
  })

  it('reloads a stale count on the next tab change', async () => {
    primeLabAdminAttention(LAB, 5, Date.now() - LAB_ADMIN_ATTENTION_TTL_MS - 1)
    await render({ labId: LAB, isAdmin: true, activeTab: 'search' })
    expect(seen.count).toBe(2)
    expect(loaders.centerRequests).toHaveBeenCalledTimes(1)
  })

  it('uses a count primed by the overview instead of loading', async () => {
    primeLabAdminAttention(LAB, 1)
    await render({ labId: LAB, isAdmin: true, activeTab: 'admin' })
    expect(seen.count).toBe(1)
    expect(loaders.centerRequests).not.toHaveBeenCalled()
  })

  it('reloads after an invalidation', async () => {
    await render({ labId: LAB, isAdmin: true, activeTab: 'admin' })
    expect(seen.count).toBe(2)
    loaders.centerRequests.mockResolvedValue([overdue('r1')])
    await act(async () => {
      invalidateLabAdminAttention(LAB)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(seen.count).toBe(1)
    expect(loaders.centerRequests).toHaveBeenCalledTimes(2)
  })

  it('looks again when an invalidation lands while a load is in flight', async () => {
    let resolveFirst: (value: unknown) => void = () => {}
    loaders.centerRequests.mockReturnValueOnce(new Promise((done) => { resolveFirst = done }))
    await act(async () => {
      root.render(<Probe labId={LAB} isAdmin activeTab="admin" />)
    })
    loaders.centerRequests.mockResolvedValue([overdue('r1')])
    await act(async () => {
      invalidateLabAdminAttention(LAB)
    })
    await act(async () => {
      resolveFirst([overdue('a'), overdue('b'), overdue('c')])
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(seen.count).toBe(1)
    expect(loaders.centerRequests).toHaveBeenCalledTimes(2)
  })
})
