import { sparklinePoints } from './sparklinePoints'

interface SparklineProps {
  values: readonly number[]
  /** Accessible summary, e.g. "최근 8주 23곳 → 26곳". The SVG itself is decorative. */
  label: string
  width?: number
  height?: number
  /** Tailwind text color class; the line uses currentColor. */
  className?: string
}

/** Tiny trend line without a chart library. */
export function Sparkline({ values, label, width = 96, height = 28, className = 'text-blue-600' }: SparklineProps) {
  const points = sparklinePoints(values, width, height)
  return (
    <span role="img" aria-label={label} className={`inline-flex ${className}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" focusable="false">
        {points && (
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  )
}
