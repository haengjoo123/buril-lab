import { readImportSource, type ReadImportOptions } from './readers'
import { detectTables } from './tables'

self.onmessage = async (event: MessageEvent<{ name: string; bytes: ArrayBuffer; id: string; options?: ReadImportOptions }>) => {
  try {
    const source = await readImportSource(event.data.name, event.data.bytes, event.data.id, event.data.options)
    self.postMessage({ source, tables: detectTables(source) })
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : '파일을 읽지 못했습니다.' }) }
}
