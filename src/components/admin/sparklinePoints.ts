/** Builds the polyline points for a series scaled into the box. */
export function sparklinePoints(values: readonly number[], width: number, height: number, padding = 2): string {
  if (values.length === 0) return ''
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const innerHeight = height - padding * 2
  const step = values.length > 1 ? (width - padding * 2) / (values.length - 1) : 0
  return values
    .map((value, index) => {
      const x = padding + (values.length > 1 ? index * step : (width - padding * 2) / 2)
      const y = max === min ? height / 2 : padding + innerHeight - ((value - min) / span) * innerHeight
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}
