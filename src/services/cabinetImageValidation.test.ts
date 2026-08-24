import { describe, expect, it } from 'vitest'
import {
  buildCabinetImagePath,
  MAX_CABINET_IMAGE_BYTES,
  validateCabinetImage,
  type CabinetImageCandidate,
} from './cabinetImageValidation'

const CABINET_ID = '11111111-1111-4111-8111-111111111111'
const RANDOM_ID = '22222222-2222-4222-8222-222222222222'

function candidate(
  bytes: number[],
  type: string,
  name: string,
  size = bytes.length,
): CabinetImageCandidate {
  const blob = new Blob([new Uint8Array(bytes)])
  return {
    name,
    size,
    type,
    slice: (start, end) => blob.slice(start, end),
  }
}

describe('cabinet image upload boundary', () => {
  it.each([
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0], 'image/jpeg', 'photo.jpg', 'jpg'],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png', 'photo.png', 'png'],
    ['WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 'image/webp', 'photo.webp', 'webp'],
  ] as const)('accepts a signature-matched %s at the 20 MiB boundary', async (
    _label,
    bytes,
    type,
    name,
    extension,
  ) => {
    await expect(validateCabinetImage(candidate(
      [...bytes],
      type,
      name,
      MAX_CABINET_IMAGE_BYTES,
    ))).resolves.toEqual({ mimeType: type, extension })
  })

  it.each([
    ['empty file', candidate([0xff, 0xd8, 0xff], 'image/jpeg', 'photo.jpg', 0), 'cabinet_image_empty'],
    ['oversized file', candidate([0xff, 0xd8, 0xff], 'image/jpeg', 'photo.jpg', MAX_CABINET_IMAGE_BYTES + 1), 'cabinet_image_too_large'],
    ['unapproved MIME', candidate([0x3c, 0x73, 0x76, 0x67], 'image/svg+xml', 'photo.svg'), 'cabinet_image_invalid_type'],
    ['mismatched signature', candidate([0xff, 0xd8, 0xff], 'image/png', 'photo.png'), 'cabinet_image_invalid_content'],
    ['unsafe name', candidate([0xff, 0xd8, 0xff], 'image/jpeg', '../photo.jpg'), 'cabinet_image_invalid_name'],
  ])('rejects an %s before upload', async (_label, file, code) => {
    await expect(validateCabinetImage(file)).rejects.toThrow(code)
  })

  it('builds a canonical non-overwriting path and rejects non-UUID cabinet IDs', () => {
    expect(buildCabinetImagePath(CABINET_ID, 'jpg', RANDOM_ID)).toBe(
      `${CABINET_ID}-${RANDOM_ID}.jpg`,
    )
    expect(() => buildCabinetImagePath('../cabinet', 'jpg', RANDOM_ID)).toThrow(
      'cabinet_image_invalid_id',
    )
  })
})
