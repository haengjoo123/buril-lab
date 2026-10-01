import { IMPORT_LIMITS, type ImportSource, type ImportTable } from './types'
import type { ReadImportOptions } from './readers'
import { readPdfTextTable } from './pdfText'

export async function readInWorker(file: File, options?: ReadImportOptions, id: string = crypto.randomUUID()): Promise<{ source: ImportSource; tables: ImportTable[] }> {
  const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
  const bytes = await file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('파일 분석 시간이 초과되었습니다. 표 영역별로 나누어 주세요.')) }, 60_000)
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data) }
    worker.onerror = () => { clearTimeout(timer); worker.terminate(); reject(new Error('파일 분석에 실패했습니다.')) }
    worker.postMessage({ name: file.name, bytes, id, options }, [bytes])
  })
}
function canvasImage(canvas: HTMLCanvasElement): string { return canvas.toDataURL('image/jpeg', 0.92) }
export async function prepareDocument(source: ImportSource, file: Blob): Promise<ImportSource> {
  if (source.kind === 'image') {
    const url = URL.createObjectURL(file)
    try {
      const img = new Image(); img.src = url; await img.decode()
      const scale = Math.min(1, 3500 / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas'); canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      return { ...source, grids: [{ id: 'page-1', label: '사진 1', page: 1, cells: [], needsAnalysis: true, imageData: canvasImage(canvas) }] }
    } finally { URL.revokeObjectURL(url) }
  }
  if (source.kind !== 'pdf') return source
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const assets = `${import.meta.env.BASE_URL}pdfjs/`
  const pdfDocument = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false,
    cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/` }).promise
  try {
    if (pdfDocument.numPages > IMPORT_LIMITS.pages) throw new Error('PDF가 50페이지를 넘습니다. 나누어 가져오세요.')
    const grids: ImportSource['grids'] = []
    for (let pageIndex = 1; pageIndex <= pdfDocument.numPages; pageIndex++) {
      const page = await pdfDocument.getPage(pageIndex)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(2.5, 3500 / Math.max(base.width, base.height)) })
      const canvas = window.document.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
      await page.render({ canvas, viewport }).promise
      const content = await page.getTextContent()
      const text = content.items.filter(item => 'str' in item).map(item => `${item.str} @${item.transform[4]},${item.transform[5]}`).join('\n')
      const cells = base.rotation === 0 ? readPdfTextTable(content.items.filter(item => 'str' in item).map(item => ({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height })), pageIndex, base.width, base.height) : null
      grids.push({ id: `page-${pageIndex}`, label: `페이지 ${pageIndex}`, page: pageIndex, cells: cells || [], text, needsAnalysis: !cells, imageData: canvasImage(canvas) })
      canvas.width = 0; canvas.height = 0; page.cleanup()
    }
    return { ...source, grids }
  } finally { await pdfDocument.destroy() }
}
export async function dataUrlBlob(data: string): Promise<Blob> {
  const response = await fetch(data)
  return response.blob()
}

export async function splitDocumentImage(blob: Blob): Promise<[string, string]> {
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image(); image.src = url; await image.decode()
    const half = Math.ceil(image.naturalHeight / 2)
    return [0, half].map(top => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = Math.min(half, image.naturalHeight - top)
      canvas.getContext('2d')!.drawImage(image, 0, top, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
      return canvasImage(canvas)
    }) as [string, string]
  } finally { URL.revokeObjectURL(url) }
}
