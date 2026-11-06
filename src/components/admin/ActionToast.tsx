import React from 'react'
import { AlertCircle, CheckCircle2, Info, Loader2, Undo2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { byAppearance } from './adminAppearance'
import type { AdminAppearance } from './adminAppearance'

export type ActionToastTone = 'success' | 'error' | 'info'

export interface ActionToastOptions {
  tone?: ActionToastTone
  /** Reverses the action the toast reports. Shows an undo button while the toast is visible. */
  onUndo?: () => void | Promise<void>
  /** How long the toast stays. Defaults to 6s with undo, 4s without. */
  durationMs?: number
}

export interface UseActionToastOptions {
  /** 'adaptive' (default) follows the light/dark theme; 'light' carries no dark: classes, for /ops. */
  appearance?: AdminAppearance
}

interface ActionToastState extends ActionToastOptions {
  id: number
  message: string
}

const TONE_STYLES: Record<ActionToastTone, { adaptive: string; light: string; Icon: LucideIcon }> = {
  success: { adaptive: 'bg-emerald-600 text-white', light: 'bg-emerald-600 text-white', Icon: CheckCircle2 },
  error: { adaptive: 'bg-red-600 text-white', light: 'bg-red-600 text-white', Icon: AlertCircle },
  info: { adaptive: 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900', light: 'bg-slate-900 text-white', Icon: Info },
}

// The undo chip is translucent white over the pill. The dark-theme info pill is near-white, where
// that chip disappears, so it is tinted dark there instead.
const UNDO_CHIP = { idle: 'bg-white/20', hover: 'group-hover:bg-white/30' }
const UNDO_CHIP_DARK_INFO = { idle: 'dark:bg-slate-900/10', hover: 'dark:group-hover:bg-slate-900/20' }

type Politeness = 'polite' | 'assertive'

// Screen readers often skip a live region that is inserted already filled, so every toast on the
// page announces through one pair of regions that stays in <body>: a new message is a text change
// inside a region that already exists. The visible pill is not a live region, so it is read once.
const ANNOUNCE_DELAY_MS = 100
let announcementSequence = 0
let currentAnnouncement = 0
let pendingAnnouncement: ReturnType<typeof setTimeout> | undefined

function liveRegion(politeness: Politeness): HTMLElement {
  const existing = document.body.querySelector<HTMLElement>(`[data-action-toast-live="${politeness}"]`)
  if (existing) return existing
  const region = document.createElement('div')
  region.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status')
  region.setAttribute('aria-live', politeness)
  region.setAttribute('aria-atomic', 'true')
  region.setAttribute('data-action-toast-live', politeness)
  region.className = 'sr-only'
  document.body.appendChild(region)
  return region
}

function ensureLiveRegions() {
  if (typeof document === 'undefined') return
  liveRegion('polite')
  liveRegion('assertive')
}

function announce(message: string, politeness: Politeness): number {
  announcementSequence += 1
  currentAnnouncement = announcementSequence
  clearTimeout(pendingAnnouncement)
  if (typeof document === 'undefined') return currentAnnouncement
  const target = liveRegion(politeness)
  liveRegion(politeness === 'polite' ? 'assertive' : 'polite').textContent = ''
  // Empty first and fill a beat later, so the same message twice in a row is still a change.
  target.textContent = ''
  pendingAnnouncement = setTimeout(() => {
    target.textContent = message
  }, ANNOUNCE_DELAY_MS)
  return currentAnnouncement
}

/** Empties the regions once the toast is gone, unless a newer toast has announced since. */
function clearAnnouncement(id: number) {
  if (id !== currentAnnouncement || typeof document === 'undefined') return
  clearTimeout(pendingAnnouncement)
  liveRegion('polite').textContent = ''
  liveRegion('assertive').textContent = ''
}

/**
 * Result toast for admin actions ("승인됨 · 되돌리기"). A new action replaces the current toast,
 * matching the cabinet toast in FridgeView. Render `toastElement` once near the root of the view;
 * it is null while no toast is shown. The timer pauses while the toast is hovered or focused, and
 * Escape closes it.
 */
export function useActionToast({ appearance = 'adaptive' }: UseActionToastOptions = {}) {
  const { t } = useTranslation()
  const [toast, setToast] = React.useState<ActionToastState | null>(null)
  const [isUndoing, setIsUndoing] = React.useState(false)
  // Ids, not booleans: a toast removed under the pointer or focus must not leave the next one paused.
  const [hoveredId, setHoveredId] = React.useState<number | null>(null)
  const [focusedId, setFocusedId] = React.useState<number | null>(null)
  const sequenceRef = React.useRef(0)
  const undoingRef = React.useRef(false)
  const announcementRef = React.useRef<number | null>(null)
  const remainingRef = React.useRef<{ id: number; ms: number } | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const returnFocusRef = React.useRef<HTMLElement | null>(null)

  React.useEffect(() => {
    ensureLiveRegions()
    return () => {
      if (announcementRef.current !== null) clearAnnouncement(announcementRef.current)
    }
  }, [])

  React.useEffect(() => {
    if (toast || announcementRef.current === null) return
    clearAnnouncement(announcementRef.current)
    announcementRef.current = null
  }, [toast])

  // Closing the toast while focus is inside it would drop focus to <body>; send it back to where it came from.
  const releaseFocus = React.useCallback(() => {
    const container = containerRef.current
    const target = returnFocusRef.current
    returnFocusRef.current = null
    if (container?.contains(document.activeElement) && target?.isConnected) target.focus()
  }, [])

  const showToast = React.useCallback((message: string, options: ActionToastOptions = {}) => {
    releaseFocus()
    sequenceRef.current += 1
    const tone = options.tone ?? 'success'
    setToast({ ...options, id: sequenceRef.current, message, tone })
    announcementRef.current = announce(message, tone === 'error' ? 'assertive' : 'polite')
  }, [releaseFocus])

  const dismissToast = React.useCallback(() => {
    releaseFocus()
    setToast(null)
  }, [releaseFocus])

  const isPaused = toast !== null && (hoveredId === toast.id || focusedId === toast.id)

  React.useEffect(() => {
    if (!toast || isUndoing || isPaused) return
    const remaining = remainingRef.current?.id === toast.id
      ? remainingRef.current.ms
      : toast.durationMs ?? (toast.onUndo ? 6000 : 4000)
    const startedAt = Date.now()
    const timer = setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current))
    }, remaining)
    return () => {
      clearTimeout(timer)
      remainingRef.current = { id: toast.id, ms: Math.max(0, remaining - (Date.now() - startedAt)) }
    }
  }, [toast, isUndoing, isPaused])

  const handleUndo = React.useCallback(async () => {
    if (!toast?.onUndo || undoingRef.current) return
    const toastId = toast.id
    undoingRef.current = true
    setIsUndoing(true)
    try {
      await toast.onUndo()
    } finally {
      undoingRef.current = false
      setIsUndoing(false)
      // A toast shown by onUndo itself replaces this one and has already moved focus.
      if (sequenceRef.current === toastId) releaseFocus()
      setToast((current) => (current?.id === toastId ? null : current))
    }
  }, [toast, releaseFocus])

  const toastElement = toast ? (() => {
    const tone = toast.tone ?? 'success'
    const { Icon, adaptive, light } = TONE_STYLES[tone]
    const darkInfoChip = tone === 'info' && appearance === 'adaptive'
    const chipIdle = darkInfoChip ? `${UNDO_CHIP.idle} ${UNDO_CHIP_DARK_INFO.idle}` : UNDO_CHIP.idle
    const chipHover = darkInfoChip ? `${UNDO_CHIP.hover} ${UNDO_CHIP_DARK_INFO.hover}` : UNDO_CHIP.hover
    const toastId = toast.id
    return (
      <div
        key={toastId}
        ref={containerRef}
        onPointerEnter={() => setHoveredId(toastId)}
        onPointerLeave={() => setHoveredId(null)}
        onFocus={(event) => {
          setFocusedId(toastId)
          const from = event.relatedTarget
          if (from instanceof HTMLElement && !event.currentTarget.contains(from)) returnFocusRef.current = from
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(null)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          event.stopPropagation()
          dismissToast()
        }}
        className="fixed left-1/2 top-20 z-[200] w-max max-w-[90vw] -translate-x-1/2 animate-in fade-in slide-in-from-top-4 duration-300"
      >
        <div className={`${byAppearance(appearance, adaptive, light)} flex min-h-11 items-center gap-2 rounded-full py-2.5 pl-5 ${toast.onUndo ? 'pr-2' : 'pr-5'} text-sm font-medium shadow-lg break-words`}>
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{toast.message}</span>
          {toast.onUndo && (
            // 44px tap area; the negative margin keeps the pill its usual height around the 32px chip.
            <button
              type="button"
              onClick={() => void handleUndo()}
              aria-disabled={isUndoing || undefined}
              className="group -my-2.5 ml-1 flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full"
            >
              <span className={`flex h-8 items-center gap-1 rounded-full ${chipIdle} px-3 text-xs font-semibold transition-colors ${isUndoing ? 'opacity-60' : chipHover}`}>
                {isUndoing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />}
                {t('admin_action_undo')}
              </span>
            </button>
          )}
        </div>
      </div>
    )
  })() : null

  return { showToast, dismissToast, toastElement }
}
