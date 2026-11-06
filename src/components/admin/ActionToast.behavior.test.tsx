// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminAppearance } from './adminAppearance'
import type { ActionToastOptions } from './ActionToast'

const translation = vi.hoisted(() => ({
  t: (key: string) => key,
  i18n: { language: 'ko' },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
}))

import { useActionToast } from './ActionToast'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface HarnessAction {
  label: string
  message: string
  options?: ActionToastOptions
}

function Harness({ actions, appearance }: { actions: HarnessAction[]; appearance?: AdminAppearance }) {
  const { showToast, dismissToast, toastElement } = useActionToast(appearance ? { appearance } : undefined)
  return (
    <div>
      {toastElement}
      {actions.map((action) => (
        <button key={action.label} type="button" onClick={() => showToast(action.message, action.options)}>
          {action.label}
        </button>
      ))}
      <button type="button" onClick={dismissToast}>dismiss</button>
      <span data-testid="has-toast">{toastElement === null ? 'none' : 'shown'}</span>
    </div>
  )
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(actions: HarnessAction[], appearance?: AdminAppearance) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root.render(<Harness actions={actions} appearance={appearance} />)
  })
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((element) => element.textContent?.includes(text))
  if (!found) throw new Error(`button not found: ${text}`)
  return found
}

function click(text: string) {
  act(() => {
    button(text).click()
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function toastPill(): HTMLElement | null {
  return container.querySelector<HTMLElement>('.fixed')
}

function region(politeness: 'polite' | 'assertive'): HTMLElement {
  const found = document.body.querySelector<HTMLElement>(`[data-action-toast-live="${politeness}"]`)
  if (!found) throw new Error(`live region not found: ${politeness}`)
  return found
}

function pointer(type: 'pointerover' | 'pointerout', target: Element, relatedTarget: Element | null) {
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, relatedTarget }))
  })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

describe('useActionToast', () => {
  it('announces every toast once through live regions that stay mounted', () => {
    render([
      { label: 'save-a', message: 'Saved A' },
      { label: 'save-b', message: 'Saved B' },
      { label: 'fail', message: 'Failed', options: { tone: 'error' } },
    ])

    // The regions exist, empty, before the first toast.
    const polite = region('polite')
    const assertive = region('assertive')
    expect(polite.getAttribute('role')).toBe('status')
    expect(polite.getAttribute('aria-live')).toBe('polite')
    expect(polite.getAttribute('aria-atomic')).toBe('true')
    expect(assertive.getAttribute('aria-live')).toBe('assertive')
    expect(polite.textContent).toBe('')
    expect(container.querySelector('[data-testid="has-toast"]')?.textContent).toBe('none')

    click('save-a')
    advance(100)
    expect(polite.textContent).toBe('Saved A')
    // The visible pill is not a second live region.
    expect(toastPill()?.textContent).toContain('Saved A')
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()

    click('save-b')
    advance(100)
    expect(region('polite')).toBe(polite)
    expect(polite.textContent).toBe('Saved B')
    expect(document.body.querySelectorAll('[role="status"]')).toHaveLength(1)

    // The same message again is emptied first, so it is still a change.
    click('save-b')
    expect(polite.textContent).toBe('')
    advance(100)
    expect(polite.textContent).toBe('Saved B')

    click('fail')
    advance(100)
    expect(region('assertive')).toBe(assertive)
    expect(assertive.textContent).toBe('Failed')
    expect(polite.textContent).toBe('')

    // Once the toast times out the region empties but stays.
    advance(4000)
    expect(toastPill()).toBeNull()
    expect(assertive.isConnected).toBe(true)
    expect(assertive.textContent).toBe('')
  })

  it('keeps the default durations: 4s without undo and 6s with undo', () => {
    render([
      { label: 'plain', message: 'Plain' },
      { label: 'undoable', message: 'Undoable', options: { onUndo: vi.fn() } },
    ])

    click('plain')
    advance(3999)
    expect(toastPill()).not.toBeNull()
    advance(1)
    expect(toastPill()).toBeNull()

    click('undoable')
    advance(5999)
    expect(toastPill()).not.toBeNull()
    advance(1)
    expect(toastPill()).toBeNull()
  })

  it('runs undo once, even on a double tap, then closes the toast', async () => {
    let finishUndo: () => void = () => {}
    const onUndo = vi.fn(() => new Promise<void>((resolve) => { finishUndo = resolve }))
    render([{ label: 'role', message: 'Role changed', options: { onUndo } }])

    click('role')
    const undo = button('admin_action_undo')
    // 44px tap area around the compact chip.
    expect(undo.className).toContain('min-h-11')
    expect(undo.className).toContain('min-w-11')

    act(() => {
      undo.click()
      undo.click()
    })
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(undo.getAttribute('aria-disabled')).toBe('true')
    // The timer does not close the toast while the undo is running.
    advance(10000)
    expect(toastPill()).not.toBeNull()

    await act(async () => {
      finishUndo()
    })
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(toastPill()).toBeNull()
  })

  it('pauses the timer while the pointer is over the toast and resumes with the time left', () => {
    render([{ label: 'save', message: 'Saved' }])

    click('save')
    advance(3000)
    const pill = toastPill() as HTMLElement
    pointer('pointerover', pill.firstElementChild as Element, null)
    advance(10000)
    expect(toastPill()).not.toBeNull()

    pointer('pointerout', pill.firstElementChild as Element, button('save'))
    advance(999)
    expect(toastPill()).not.toBeNull()
    advance(1)
    expect(toastPill()).toBeNull()
  })

  it('does not leave the next toast paused when the pointer was over a removed toast', () => {
    render([{ label: 'save', message: 'Saved' }])

    click('save')
    pointer('pointerover', toastPill() as HTMLElement, null)
    click('dismiss')
    expect(toastPill()).toBeNull()

    click('save')
    advance(4000)
    expect(toastPill()).toBeNull()
  })

  it('pauses while focus is inside, closes on Escape and returns focus', () => {
    render([{ label: 'role', message: 'Role changed', options: { onUndo: vi.fn() } }])

    const trigger = button('role')
    act(() => trigger.focus())
    click('role')
    const undo = button('admin_action_undo')
    act(() => undo.focus())
    advance(20000)
    expect(toastPill()).not.toBeNull()

    act(() => {
      undo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(toastPill()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('resumes the timer once focus leaves the toast', () => {
    render([{ label: 'role', message: 'Role changed', options: { onUndo: vi.fn() } }])

    click('role')
    advance(1000)
    act(() => button('admin_action_undo').focus())
    advance(20000)
    expect(toastPill()).not.toBeNull()

    act(() => button('role').focus())
    advance(4999)
    expect(toastPill()).not.toBeNull()
    advance(1)
    expect(toastPill()).toBeNull()
  })

  it('renders no dark: classes in the light appearance and keeps them in adaptive', () => {
    const actions: HarnessAction[] = [
      { label: 'info', message: 'Info', options: { tone: 'info', onUndo: vi.fn() } },
      { label: 'ok', message: 'Ok', options: { onUndo: vi.fn() } },
      { label: 'fail', message: 'Failed', options: { tone: 'error' } },
    ]
    render(actions, 'light')
    for (const action of actions) {
      click(action.label)
      expect(toastPill()?.outerHTML).not.toContain('dark:')
    }
    act(() => root.unmount())
    container.remove()

    render(actions)
    click('info')
    expect(toastPill()?.outerHTML).toContain('dark:')
    // The dark-theme info pill is near-white, so its undo chip is tinted dark rather than white.
    const chip = button('admin_action_undo').firstElementChild as HTMLElement
    expect(chip.className).toContain('dark:bg-slate-900/10')
    expect(chip.className).toContain('dark:group-hover:bg-slate-900/20')
    click('ok')
    expect((button('admin_action_undo').firstElementChild as HTMLElement).className).not.toContain('dark:')
  })

  it('returns focus to the trigger once undo finishes', async () => {
    const onUndo = vi.fn()
    render([{ label: 'role', message: 'Role changed', options: { onUndo } }])

    const trigger = button('role')
    act(() => trigger.focus())
    click('role')
    act(() => button('admin_action_undo').focus())

    await act(async () => {
      button('admin_action_undo').click()
    })
    expect(onUndo).toHaveBeenCalledTimes(1)
    expect(toastPill()).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('returns focus to the trigger when a new toast replaces the focused one', () => {
    render([{ label: 'role', message: 'Role changed', options: { onUndo: vi.fn() } }])

    const trigger = button('role')
    act(() => trigger.focus())
    click('role')
    act(() => button('admin_action_undo').focus())

    click('role')
    expect(toastPill()).not.toBeNull()
    expect(document.activeElement).toBe(trigger)
    // Focus is no longer inside, so the new toast runs its timer.
    advance(6000)
    expect(toastPill()).toBeNull()
  })
})
