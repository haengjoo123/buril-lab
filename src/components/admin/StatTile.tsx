import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { byAppearance, type AdminAppearance, type AdminTone } from './adminAppearance'

interface StatTileProps {
  label: string
  value: ReactNode
  /** One short line under the value: comparison, denominator, definition hint. */
  caption?: ReactNode
  tone?: AdminTone
  Icon?: LucideIcon
  /** Extra marker next to the label, e.g. a small-sample badge. */
  badge?: ReactNode
  /** Rendered under the caption, e.g. a Sparkline. */
  children?: ReactNode
  appearance?: AdminAppearance
}

const VALUE_TONE: Record<AdminTone, { adaptive: string; light: string }> = {
  neutral: { adaptive: 'text-slate-950 dark:text-white', light: 'text-slate-950' },
  good: { adaptive: 'text-emerald-700 dark:text-emerald-300', light: 'text-emerald-700' },
  attention: { adaptive: 'text-amber-700 dark:text-amber-300', light: 'text-amber-700' },
  danger: { adaptive: 'text-red-700 dark:text-red-300', light: 'text-red-700' },
}

const ICON_TONE: Record<AdminTone, { adaptive: string; light: string }> = {
  neutral: { adaptive: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', light: 'bg-slate-100 text-slate-600' },
  good: { adaptive: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', light: 'bg-emerald-50 text-emerald-700' },
  attention: { adaptive: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', light: 'bg-amber-50 text-amber-700' },
  danger: { adaptive: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300', light: 'bg-red-50 text-red-700' },
}

/** One metric: label, big value, one caption line. Replaces the per-screen MetricCard copies. */
export function StatTile({
  label,
  value,
  caption,
  tone = 'neutral',
  Icon,
  badge,
  children,
  appearance = 'adaptive',
}: StatTileProps) {
  const surface = byAppearance(
    appearance,
    'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900',
    'border-slate-200 bg-white',
  )
  const labelClass = byAppearance(appearance, 'text-slate-600 dark:text-slate-300', 'text-slate-600')
  const captionClass = byAppearance(appearance, 'text-slate-500 dark:text-slate-400', 'text-slate-500')

  return (
    <div className={`min-w-0 rounded-xl border p-4 shadow-sm ${surface}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className={`truncate text-xs font-medium ${labelClass}`}>{label}</p>
          {badge}
        </div>
        {Icon && (
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${ICON_TONE[tone][appearance]}`}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        )}
      </div>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${VALUE_TONE[tone][appearance]}`}>{value}</p>
      {caption && <p className={`mt-1 text-xs leading-5 ${captionClass}`}>{caption}</p>}
      {children && <div className="mt-2">{children}</div>}
    </div>
  )
}
