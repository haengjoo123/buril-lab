import type { ReactNode } from 'react'
import { ChevronRight, CircleCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { byAppearance, type AdminAppearance } from './adminAppearance'

/** red = act now (overdue, danger), amber = act soon, slate = for information. */
export type InboxSeverity = 'red' | 'amber' | 'slate'

const DOT: Record<InboxSeverity, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  slate: 'bg-slate-400',
}

const SEVERITY_LABEL_KEY: Record<InboxSeverity, string> = {
  red: 'admin_inbox_severity_red',
  amber: 'admin_inbox_severity_amber',
  slate: 'admin_inbox_severity_slate',
}

interface InboxRowProps {
  severity: InboxSeverity
  title: ReactNode
  /** Short facts after the title: count, oldest age, D-day. */
  meta?: ReactNode
  /** Extra line under the title (e.g. the request title or reagent names). */
  detail?: ReactNode
  /** In-place actions (approve, seal, submit). Shown under the text on narrow widths. */
  actions?: ReactNode
  /** Opens the screen that holds the items. Renders a trailing "열기 →" style link button. */
  onOpen?: () => void
  openLabel?: string
  appearance?: AdminAppearance
}

/** One line of a "things to handle" inbox: severity dot, what, how many/how old, act in place. */
export function InboxRow({
  severity,
  title,
  meta,
  detail,
  actions,
  onOpen,
  openLabel,
  appearance = 'adaptive',
}: InboxRowProps) {
  const { t } = useTranslation()
  const titleClass = byAppearance(appearance, 'text-slate-900 dark:text-white', 'text-slate-900')
  const metaClass = byAppearance(appearance, 'text-slate-500 dark:text-slate-400', 'text-slate-500')
  const detailClass = byAppearance(appearance, 'text-slate-600 dark:text-slate-300', 'text-slate-600')
  const openClass = byAppearance(
    appearance,
    'text-blue-700 hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-950/40',
    'text-blue-700 hover:bg-blue-50',
  )

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[severity]}`} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold leading-6 ${titleClass}`}>
            <span className="sr-only">{t(SEVERITY_LABEL_KEY[severity])}: </span>
            {title}
            {meta && <span className={`ml-1.5 text-xs font-normal ${metaClass}`}>{meta}</span>}
          </p>
          {detail && <div className={`mt-0.5 text-sm leading-6 ${detailClass}`}>{detail}</div>}
        </div>
      </div>
      {(actions || onOpen) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 pl-5 sm:pl-0">
          {actions}
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className={`inline-flex min-h-11 items-center gap-1 rounded-lg px-3 text-sm font-medium ${openClass}`}
            >
              {openLabel ?? t('admin_inbox_open')}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </li>
  )
}

interface InboxQuietStateProps {
  message?: string
  /** "HH:mm" or similar, shown as "마지막 확인 …". */
  lastCheckedLabel?: string
  appearance?: AdminAppearance
}

/** What an inbox shows when there is nothing to do: one calm line, no zero-filled cards. */
export function InboxQuietState({ message, lastCheckedLabel, appearance = 'adaptive' }: InboxQuietStateProps) {
  const { t } = useTranslation()
  const textClass = byAppearance(appearance, 'text-slate-600 dark:text-slate-300', 'text-slate-600')
  const subClass = byAppearance(appearance, 'text-slate-500 dark:text-slate-400', 'text-slate-500')
  return (
    <div role="status" className="flex items-center gap-2 py-3">
      <CircleCheck className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
      <p className={`text-sm ${textClass}`}>
        {message ?? t('admin_inbox_quiet')}
        {lastCheckedLabel && (
          <span className={`ml-1.5 text-xs ${subClass}`}>· {t('admin_inbox_last_checked', { time: lastCheckedLabel })}</span>
        )}
      </p>
    </div>
  )
}
