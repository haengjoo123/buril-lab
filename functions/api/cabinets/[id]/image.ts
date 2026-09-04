import { internalErrorResponse } from '../../_shared/json'
import { readLimitedJson, readLimitedRequestBytes, RequestBodyError, requestBodyErrorResponse } from '../../_shared/requestBody'
import { isUuid } from '../../_shared/validation'
import {
  CABINET_PHOTO_MAX_BYTES, CABINET_PHOTO_SIGNED_URL_SECONDS, checkedSignedUrl,
  isWebp, photoResponse, runCabinetPhotoRequest, sha256Hex, validPhotoPath, validPhotoPrefix,
  type CabinetPhotoAdmin, type CabinetPhotoContext,
} from '../_shared'

type State = {
  success: true
  imagePath: string | null
  legacyImagePending: boolean
  scopePrefix: string
  referencedCount: number
  warning: boolean
}

function cabinetIdFrom(context: CabinetPhotoContext): string | null {
  const raw = context.params?.id
  return typeof raw === 'string' && isUuid(raw) ? raw.toLowerCase() : null
}

function checkedState(value: unknown, cabinetId: string): State | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join('|') !== 'image_path|legacy_image_pending|referenced_count|scope_prefix|success|warning'
    || row.success !== true || !(row.image_path === null || validPhotoPath(row.image_path, cabinetId))
    || typeof row.legacy_image_pending !== 'boolean'
    || !validPhotoPrefix(row.scope_prefix, cabinetId)
    || !Number.isSafeInteger(row.referenced_count) || (row.referenced_count as number) < 0
    || (row.referenced_count as number) > 50 || row.warning !== ((row.referenced_count as number) >= 40)) return null
  return { success: true, imagePath: row.image_path as string | null,
    legacyImagePending: row.legacy_image_pending as boolean, scopePrefix: row.scope_prefix as string,
    referencedCount: row.referenced_count as number, warning: row.warning as boolean }
}

function checkedSetResult(value: unknown, cabinetId: string): {
  imagePath: string | null; referencedCount: number; warning: boolean
} | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join('|') !== 'image_path|previous_path|referenced_count|success|warning'
    || row.success !== true || !(row.image_path === null || validPhotoPath(row.image_path, cabinetId))
    || !(row.previous_path === null || validPhotoPath(row.previous_path, cabinetId))
    || !Number.isSafeInteger(row.referenced_count) || (row.referenced_count as number) < 0
    || (row.referenced_count as number) > 50 || row.warning !== ((row.referenced_count as number) >= 40)) return null
  return { imagePath: row.image_path as string | null, referencedCount: row.referenced_count as number,
    warning: row.warning as boolean }
}

async function state(admin: CabinetPhotoAdmin, userId: string, cabinetId: string) {
  const { data, error } = await admin.rpc('get_cabinet_image_state_v1', {
    p_user_id: userId, p_cabinet_id: cabinetId,
  })
  if (error) return { error, value: null }
  return { error: null, value: checkedState(data, cabinetId) }
}

async function signedUrl(
  admin: CabinetPhotoAdmin,
  origin: string,
  path: string,
): Promise<string | null> {
  const { data, error } = await admin.storage.from('cabinets')
    .createSignedUrl(path, CABINET_PHOTO_SIGNED_URL_SECONDS)
  return error ? null : checkedSignedUrl(data?.signedUrl, origin, path)
}

export const onRequestPost = async (context: CabinetPhotoContext): Promise<Response> => {
  const cabinetId = cabinetIdFrom(context)
  if (!cabinetId) return photoResponse({ error: 'A valid cabinet ID is required.', code: 'INVALID_CABINET_ID' }, 400)
  const contentType = context.request.headers.get('Content-Type') ?? ''
  const isImage = /^image\/webp$/i.test(contentType)
  const isRemove = /^application\/json(?:\s*;.*)?$/i.test(contentType)
  if (!isImage && !isRemove) {
    return photoResponse({ error: 'A WebP image or remove request is required.', code: 'UNSUPPORTED_MEDIA_TYPE' }, 415)
  }

  let imageBytes: Uint8Array<ArrayBuffer> | null = null
  if (isImage) {
    try { imageBytes = await readLimitedRequestBytes(context.request, CABINET_PHOTO_MAX_BYTES) }
    catch (error) { return error instanceof RequestBodyError ? requestBodyErrorResponse(error) : photoResponse({ error: 'Invalid image.', code: 'INVALID_IMAGE' }, 400) }
    if (!isWebp(imageBytes)) return photoResponse({ error: 'A valid WebP image is required.', code: 'INVALID_IMAGE' }, 400)
  } else {
    try {
      const body = await readLimitedJson(context.request, 1024)
      if (!body || typeof body !== 'object' || Array.isArray(body)
        || Object.keys(body).join('|') !== 'action' || (body as Record<string, unknown>).action !== 'remove') {
        return photoResponse({ error: 'A valid remove request is required.', code: 'INVALID_REMOVE_REQUEST' }, 400)
      }
    } catch (error) {
      return error instanceof RequestBodyError ? requestBodyErrorResponse(error)
        : photoResponse({ error: 'A valid remove request is required.', code: 'INVALID_REMOVE_REQUEST' }, 400)
    }
  }

  return runCabinetPhotoRequest(context, async ({ userId, admin, signal, origin }) => {
    const before = await state(admin, userId, cabinetId)
    if (signal.aborted) throw new Error('CABINET_PHOTO_TIMEOUT')
    if (before.error) {
      if (before.error.code === 'P0002') return photoResponse({ error: 'Cabinet was not found.', code: 'CABINET_NOT_FOUND' }, 404)
      if (before.error.code === '42501') return photoResponse({ error: 'Cabinet access is denied.', code: 'CABINET_ACCESS_DENIED' }, 403)
      return internalErrorResponse('cabinets.photo.state', before.error, 503)
    }
    if (!before.value) return internalErrorResponse('cabinets.photo.state.result', null, 503)
    if (before.value.legacyImagePending) {
      return photoResponse({
        error: 'This cabinet photo is being moved to private storage.',
        code: 'CABINET_IMAGE_MIGRATION_REQUIRED',
      }, 409)
    }

    if (isRemove) {
      if (before.value.imagePath === null) {
        return photoResponse({ success: true, imageUrl: null, referencedCount: before.value.referencedCount,
          warning: before.value.warning })
      }
      const { data, error } = await admin.rpc('set_cabinet_image_path_v1', {
        p_user_id: userId, p_cabinet_id: cabinetId, p_image_path: null,
        p_expected_previous_path: before.value.imagePath, p_sha256: null, p_size_bytes: null,
      })
      if (error) return internalErrorResponse('cabinets.photo.remove', error, 503)
      const result = checkedSetResult(data, cabinetId)
      return result && result.imagePath === null
        ? photoResponse({ success: true, imageUrl: null, referencedCount: result.referencedCount, warning: result.warning })
        : internalErrorResponse('cabinets.photo.remove.result', null, 503)
    }

    if (!imageBytes) return internalErrorResponse('cabinets.photo.bytes', null, 503)
    if (before.value.imagePath === null && before.value.referencedCount >= 50) {
      return photoResponse({ error: 'This photo limit has been reached.', code: 'CABINET_IMAGE_LIMIT' }, 409)
    }
    const fileId = crypto.randomUUID().toLowerCase()
    const imagePath = `${before.value.scopePrefix}/${fileId}.webp`
    if (!validPhotoPath(imagePath, cabinetId)) return internalErrorResponse('cabinets.photo.path', null, 503)
    const sha256 = await sha256Hex(imageBytes)
    const { error: uploadError } = await admin.storage.from('cabinets').upload(imagePath, imageBytes, {
      upsert: false, contentType: 'image/webp', cacheControl: '31536000',
    })
    if (uploadError) return internalErrorResponse('cabinets.photo.upload', uploadError, 503)
    if (signal.aborted) throw new Error('CABINET_PHOTO_TIMEOUT')

    const attached = await admin.rpc('set_cabinet_image_path_v1', {
      p_user_id: userId, p_cabinet_id: cabinetId, p_image_path: imagePath,
      p_expected_previous_path: before.value.imagePath, p_sha256: sha256, p_size_bytes: imageBytes.byteLength,
    })
    let result = attached.error ? null : checkedSetResult(attached.data, cabinetId)
    if (!result || result.imagePath !== imagePath) {
      // The write response may be lost after commit. Re-read once before
      // deciding whether this new object is safe to remove.
      const after = await state(admin, userId, cabinetId)
      if (!after.error && after.value?.imagePath === imagePath) {
        result = { imagePath, referencedCount: after.value.referencedCount, warning: after.value.warning }
      } else if (!after.error && after.value?.imagePath === before.value.imagePath) {
        await admin.storage.from('cabinets').remove([imagePath])
        if (attached.error?.code === 'P0001' && attached.error.message === 'cabinet_image_limit_reached') {
          return photoResponse({ error: 'This photo limit has been reached.', code: 'CABINET_IMAGE_LIMIT' }, 409)
        }
        return internalErrorResponse('cabinets.photo.attach', attached.error, 503)
      } else {
        // Unknown commit state: leave the body for backup quarantine and do not
        // risk deleting a photo that may now be referenced.
        return internalErrorResponse('cabinets.photo.attach.unknown', attached.error, 503)
      }
    }
    const url = await signedUrl(admin, origin, imagePath)
    return photoResponse({ success: true, imageUrl: url, referencedCount: result.referencedCount,
      warning: result.warning, urlUnavailable: url === null })
  })
}
