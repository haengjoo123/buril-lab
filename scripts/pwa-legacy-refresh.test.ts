import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const source = readFileSync(new URL('../public/sw-legacy-refresh.js', import.meta.url), 'utf8')
type LifecycleEvent = { waitUntil: (promise: Promise<unknown>) => void }

function worker(isUpdate: boolean, entries = new Map<string, Response>(), urls = ['https://app.test/app']) {
  const listeners = new Map<string, (event: LifecycleEvent) => void>()
  const windows = urls.map(url => ({ url, navigate: vi.fn(async () => null) }))
  const claim = vi.fn(async () => undefined)
  runInNewContext(source, {
    URL, Response,
    caches: { open: async () => ({
      match: async (key: string) => entries.get(key)?.clone(),
      put: async (key: string, value: Response) => { entries.set(key, value.clone()) },
    }) },
    self: {
      registration: { scope: 'https://app.test/', active: isUpdate ? {} : null },
      location: { origin: 'https://app.test' },
      clients: { claim, matchAll: async () => windows },
      addEventListener: (type: string, listener: (event: LifecycleEvent) => void) => listeners.set(type, listener),
    },
  })
  return {
    windows, entries, claim,
    async dispatch(type: string) {
      let completion: Promise<unknown> | undefined
      listeners.get(type)!({ waitUntil: promise => { completion = promise } })
      await completion
    },
  }
}

describe('legacy prompt client migration', () => {
  it('refreshes existing application windows after claiming the new worker', async () => {
    const instance = worker(true, undefined, ['https://app.test/app?tab=settings#security', 'https://app.test/ops/feedback'])
    await instance.dispatch('install')
    await instance.dispatch('activate')
    expect(instance.claim).toHaveBeenCalledOnce()
    for (const client of instance.windows) {
      expect(client.navigate).toHaveBeenCalledExactlyOnceWith(client.url)
      expect(instance.claim.mock.invocationCallOrder[0]).toBeLessThan(client.navigate.mock.invocationCallOrder[0])
    }
  })

  it('does not reload a first installation or later autoUpdate activations', async () => {
    const initial = worker(false)
    await initial.dispatch('install')
    await initial.dispatch('activate')
    const later = worker(true, initial.entries)
    await later.dispatch('install')
    await later.dispatch('activate')
    expect(initial.windows[0].navigate).not.toHaveBeenCalled()
    expect(later.windows[0].navigate).not.toHaveBeenCalled()
  })

  it('survives a worker restart between install and activate without repeating migration', async () => {
    const installer = worker(true)
    await installer.dispatch('install')
    const activated = worker(true, installer.entries)
    await activated.dispatch('activate')
    expect(activated.windows[0].navigate).toHaveBeenCalledOnce()
    const restarted = worker(true, installer.entries)
    await restarted.dispatch('activate')
    expect(restarted.windows[0].navigate).not.toHaveBeenCalled()
  })

  it('leaves operational, Access and other-origin windows untouched', async () => {
    const instance = worker(true, undefined, [
      'https://app.test/api/admin/feedback/list', 'https://app.test/api',
      'https://app.test/cdn-cgi/access/callback', 'https://app.test/release.json?commit=123',
      'https://app.test/sw.js', 'https://other.test/app',
    ])
    await instance.dispatch('install')
    await instance.dispatch('activate')
    for (const client of instance.windows) expect(client.navigate).not.toHaveBeenCalled()
  })

  it('continues when a window closes during navigation', async () => {
    const instance = worker(true, undefined, ['https://app.test/app', 'https://app.test/ops/feedback'])
    instance.windows[0].navigate.mockRejectedValueOnce(new Error('window closed'))
    await instance.dispatch('install')
    await expect(instance.dispatch('activate')).resolves.toBeUndefined()
    expect(instance.windows[1].navigate).toHaveBeenCalledOnce()
  })

  it('finishes activation before waiting for a navigation fetch controlled by that activation', async () => {
    const instance = worker(true)
    instance.windows[0].navigate.mockImplementation(() => new Promise(() => {}))
    await instance.dispatch('install')
    await expect(instance.dispatch('activate')).resolves.toBeUndefined()
    expect(instance.windows[0].navigate).toHaveBeenCalledOnce()
  })
})
