import { describe, expect, it } from 'vitest'
import {
  verifyNulSeparatedReleaseArtifactPaths,
  verifyReleaseArtifactPath,
} from './verify-release-artifact-paths.mjs'

describe('release artifact path policy', () => {
  it('allows the shipped model names that contain spaces', () => {
    expect(verifyReleaseArtifactPath('dist/models/reagents/brown bottle.glb'))
      .toBe('dist/models/reagents/brown bottle.glb')
    expect(verifyReleaseArtifactPath('dist/models/reagents/plastic bottle.glb'))
      .toBe('dist/models/reagents/plastic bottle.glb')
    expect(verifyReleaseArtifactPath('dist/models/reagents/square bottle.glb'))
      .toBe('dist/models/reagents/square bottle.glb')
  })

  it.each([
    '/dist/index.html',
    '../dist/index.html',
    'dist/../secret',
    'dist/./index.html',
    'dist//index.html',
    'dist\\index.html',
    'dist/line\nbreak.js',
    'dist/control\u0001.js',
  ])('rejects unsafe path %j', (path) => {
    expect(() => verifyReleaseArtifactPath(path)).toThrow(/relative|unsafe/)
  })

  it('requires one canonical NUL-terminated, duplicate-free UTF-8 list', () => {
    const valid = Buffer.from('dist/index.html\0dist/assets/app.js\0')
    expect(verifyNulSeparatedReleaseArtifactPaths(valid)).toEqual([
      'dist/index.html',
      'dist/assets/app.js',
    ])
    expect(() => verifyNulSeparatedReleaseArtifactPaths(Buffer.from('dist/index.html')))
      .toThrow(/NUL terminated/)
    expect(() => verifyNulSeparatedReleaseArtifactPaths(Buffer.from('dist/index.html\0dist/index.html\0')))
      .toThrow(/duplicates/)
  })
})
