import { internalErrorResponse } from '../_shared/json'
import { readLimitedJson, RequestBodyError, requestBodyErrorResponse } from '../_shared/requestBody'
import { isUuid } from '../_shared/validation'
import {
  CABINET_PHOTO_SIGNED_URL_SECONDS, checkedSignedUrl, photoResponse,
  runCabinetPhotoRequest, validPhotoPath, type CabinetPhotoContext,
} from './_shared'

function checkedIds(value: unknown): string[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const body = value as Record<string, unknown>
  if (Object.keys(body).join('|') !== 'cabinetIds' || !Array.isArray(body.cabinetIds)
    || body.cabinetIds.length < 1 || body.cabinetIds.length > 50) return null
  const ids = body.cabinetIds.map((id) => typeof id === 'string' ? id.toLowerCase() : '')
  return ids.every(isUuid) && new Set(ids).size === ids.length ? ids : null
}

function checkedRows(value: unknown, ids: string[]): Array<{ cabinetId: string; imagePath: string | null }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (Object.keys(result).sort().join('|') !== 'images|success' || result.success !== true
    || !Array.isArray(result.images) || result.images.length !== ids.length) return null
  const expected = new Set(ids)
  const rows: Array<{ cabinetId: string; imagePath: string | null }> = []
  for (const raw of result.images) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const row = raw as Record<string, unknown>
    if (Object.keys(row).sort().join('|') !== 'cabinet_id|image_path'
      || typeof row.cabinet_id !== 'string' || !expected.delete(row.cabinet_id.toLowerCase())
      || !(row.image_path === null || validPhotoPath(row.image_path, row.cabinet_id))) return null
    rows.push({ cabinetId: row.cabinet_id.toLowerCase(), imagePath: row.image_path as string | null })
  }
  return expected.size === 0 ? rows : null
}

export const onRequestPost = async (context: CabinetPhotoContext): Promise<Response> => {
  if (!/^application\/json(?:\s*;.*)?$/i.test(context.request.headers.get('Content-Type') ?? '')) {
    return photoResponse({ error: 'A JSON request is required.', code: 'UNSUPPORTED_MEDIA_TYPE' }, 415)
  }
  let cabinetIds: string[] | null
  try { cabinetIds = checkedIds(await readLimitedJson(context.request, 8 * 1024)) }
  catch (error) { return error instanceof RequestBodyError ? requestBodyErrorResponse(error) : photoResponse({ error: 'Invalid cabinet IDs.', code: 'INVALID_CABINET_IDS' }, 400) }
  if (!cabinetIds) return photoResponse({ error: 'One to fifty unique cabinet IDs are required.', code: 'INVALID_CABINET_IDS' }, 400)

  return runCabinetPhotoRequest(context, async ({ userId, admin, origin }) => {
    const { data, error } = await admin.rpc('get_cabinet_image_paths_v1', {
      p_user_id: userId, p_cabinet_ids: cabinetIds,
    })
    if (error) {
      if (error.code === '42501') return photoResponse({ error: 'Cabinet access is denied.', code: 'CABINET_ACCESS_DENIED' }, 403)
      return internalErrorResponse('cabinets.photo.urls.lookup', error, 503)
    }
    const rows = checkedRows(data, cabinetIds)
    if (!rows) return internalErrorResponse('cabinets.photo.urls.result', null, 503)
    const paths = rows.flatMap((row) => row.imagePath ? [row.imagePath] : [])
    const urls: Record<string, string | null> = Object.fromEntries(rows.map((row) => [row.cabinetId, null]))
    if (paths.length === 0) return photoResponse({ success: true, urls })

    const signed = await admin.storage.from('cabinets').createSignedUrls(paths, CABINET_PHOTO_SIGNED_URL_SECONDS)
    if (signed.error || !Array.isArray(signed.data) || signed.data.length !== paths.length) {
      return internalErrorResponse('cabinets.photo.urls.sign', signed.error, 503)
    }
    const byPath = new Map<string, string>()
    for (const entry of signed.data) {
      const path = typeof entry?.path === 'string' ? entry.path : ''
      const url = checkedSignedUrl(entry?.signedUrl, origin, path)
      if (!paths.includes(path) || byPath.has(path) || !url || entry?.error) {
        return internalErrorResponse('cabinets.photo.urls.sign.result', null, 503)
      }
      byPath.set(path, url)
    }
    if (byPath.size !== paths.length) return internalErrorResponse('cabinets.photo.urls.sign.result', null, 503)
    for (const row of rows) if (row.imagePath) urls[row.cabinetId] = byPath.get(row.imagePath) ?? null
    return photoResponse({ success: true, urls })
  })
}
