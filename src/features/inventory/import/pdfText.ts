import { matchImportHeader } from './normalize'
import type { ImportGrid } from './types'

export interface PdfTextItem { str: string; x: number; y: number; width: number; height: number }
/** Only use the deterministic path for text with a recognizable, aligned header. */
export function readPdfTextTable(items: PdfTextItem[], page: number, width: number, height: number): ImportGrid['cells'] | null {
  const lines: PdfTextItem[][] = []
  for (const item of [...items].filter(item => item.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find(line => Math.abs(line[0].y - item.y) <= Math.max(2, item.height * 0.3))
    if (line) line.push(item); else lines.push([item])
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x)
  const headerIndex = lines.findIndex(line => {
    const fields = line.map(item => matchImportHeader(item.str))
    return fields.includes('name') && fields.filter(Boolean).length >= 2
  })
  if (headerIndex < 0) return null
  const header = lines[headerIndex]
  const starts = header.map(item => item.x - 4)
  // Unaligned multi-column notes and wrapped headers should go through visual review.
  if (starts.length < 2 || starts.some((x, i) => i > 0 && x - starts[i - 1] < 12)) return null
  const cells = lines.slice(headerIndex).map((line, r) => starts.map((start, c) => {
    const selected = line.filter(item => item.x >= start && (c === starts.length - 1 || item.x < starts[c + 1]))
    const text = selected.map(item => item.str).join(' ').trim()
    const left = selected.length ? Math.min(...selected.map(i => i.x)) / width : 0
    const right = selected.length ? Math.max(...selected.map(i => i.x + i.width)) / width : 0
    const top = selected.length ? 1 - Math.max(...selected.map(i => i.y + i.height)) / height : 0
    const bottom = selected.length ? 1 - Math.min(...selected.map(i => i.y)) / height : 0
    return { address: `p${page}:r${r}:c${c}`, raw: text, text, bounds: [Math.max(0, left), Math.max(0, top), Math.min(1, right), Math.min(1, bottom)] as [number, number, number, number] }
  }))
  return cells.length > 1 ? cells : null
}
