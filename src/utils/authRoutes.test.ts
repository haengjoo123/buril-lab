import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from './authRoutes';

describe('sanitizeReturnTo', () => {
  it.each([
    '/app',
    '/app/logs?record=33333333-3333-4333-8333-333333333333',
    '/center#risks',
  ])('keeps an internal destination: %s', (value) => {
    expect(sanitizeReturnTo(value)).toBe(value);
  });

  it.each([
    null,
    '',
    'https://evil.example',
    '//evil.example/path',
    '/https://evil.example',
    '/\\evil.example/path',
    '/%5cevil.example/path',
    '/%255cevil.example/path',
    '/%2f%2fevil.example/path',
    '/%252f%252fevil.example/path',
    '/app\n/ops',
    '/app%0d%0a/ops',
    '/app%2500/ops',
    '/app/%',
  ])('rejects an unsafe destination: %s', (value) => {
    expect(sanitizeReturnTo(value)).toBeNull();
  });
});
