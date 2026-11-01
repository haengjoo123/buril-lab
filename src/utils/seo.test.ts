import { describe, expect, it } from 'vitest';
import { getDocumentMeta } from './seo';

describe('getDocumentMeta', () => {
  it('gives public pages a canonical URL and keeps them indexable', () => {
    expect(getDocumentMeta('/', 'ko', '버릴랩')).toMatchObject({
      canonical: 'https://burillab.com/',
      indexable: true,
    });
    expect(getDocumentMeta('/terms/', 'en', 'Buril Lab')).toMatchObject({
      title: 'Terms of Service | Buril Lab',
      canonical: 'https://burillab.com/terms',
      indexable: true,
    });
  });

  it('marks app screens noindex and keeps the app title', () => {
    for (const pathname of ['/app', '/app/logs', '/login', '/center', '/ops/feedback']) {
      expect(getDocumentMeta(pathname, 'ko', '버릴랩')).toEqual({
        title: '버릴랩',
        description: null,
        canonical: null,
        indexable: false,
      });
    }
  });
});
