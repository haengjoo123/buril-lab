export const MAX_CABINET_IMAGE_BYTES = 20 * 1_048_576

export type CabinetImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp'
export type CabinetImageExtension = 'jpg' | 'png' | 'webp'

export interface CabinetImageCandidate {
  name: string
  size: number
  type: string
  slice(start?: number, end?: number): Pick<Blob, 'arrayBuffer'>
}

export interface ValidatedCabinetImage {
  extension: CabinetImageExtension
  mimeType: CabinetImageMimeType
}

const MIME_EXTENSIONS: Readonly<Record<CabinetImageMimeType, CabinetImageExtension>> = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
})

function invalid(code: string): never {
  throw new Error(code)
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 31 || code === 127) return true
  }
  return false
}

function matchesSignature(type: CabinetImageMimeType, header: Uint8Array): boolean {
  if (type === 'image/jpeg') {
    return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
  }
  if (type === 'image/png') {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    return header.length >= png.length && png.every((value, index) => header[index] === value)
  }
  return header.length >= 12
    && String.fromCharCode(...header.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...header.slice(8, 12)) === 'WEBP'
}

export async function validateCabinetImage(
  file: CabinetImageCandidate,
): Promise<ValidatedCabinetImage> {
  if (
    !file
    || typeof file.name !== 'string'
    || file.name.length < 1
    || file.name.length > 255
    || file.name !== file.name.trim()
    || hasControlCharacter(file.name)
    || /[\\/]/.test(file.name)
  ) {
    invalid('cabinet_image_invalid_name')
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1) invalid('cabinet_image_empty')
  if (file.size > MAX_CABINET_IMAGE_BYTES) invalid('cabinet_image_too_large')
  if (!Object.hasOwn(MIME_EXTENSIONS, file.type)) invalid('cabinet_image_invalid_type')
  if (typeof file.slice !== 'function') invalid('cabinet_image_invalid_content')

  let header: Uint8Array
  try {
    const sliced = file.slice(0, 16)
    if (!sliced || typeof sliced.arrayBuffer !== 'function') invalid('cabinet_image_invalid_content')
    header = new Uint8Array(await sliced.arrayBuffer())
  } catch {
    invalid('cabinet_image_invalid_content')
  }

  const mimeType = file.type as CabinetImageMimeType
  if (!matchesSignature(mimeType, header)) invalid('cabinet_image_invalid_content')
  return { mimeType, extension: MIME_EXTENSIONS[mimeType] }
}

export function buildCabinetImagePath(
  cabinetId: string,
  extension: CabinetImageExtension,
  randomId = crypto.randomUUID(),
): string {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  if (!uuidPattern.test(cabinetId) || !uuidPattern.test(randomId)) {
    invalid('cabinet_image_invalid_id')
  }
  return `${cabinetId}-${randomId}.${extension}`
}
