import { readImportSource, type ReadImportOptions } from './readers'
import { detectTables } from './tables'
import i18n from '../../../locales/i18n'

self.onmessage = async (event: MessageEvent<{ name: string; bytes: ArrayBuffer; id: string; options?: ReadImportOptions; lng?: string }>) => {
  try {
    if (event.data.lng && i18n.language !== event.data.lng) await i18n.changeLanguage(event.data.lng)
    const source = await readImportSource(event.data.name, event.data.bytes, event.data.id, event.data.options)
    self.postMessage({ source, tables: detectTables(source) })
  }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : i18n.t('inv_err_file_read') }) }
}
