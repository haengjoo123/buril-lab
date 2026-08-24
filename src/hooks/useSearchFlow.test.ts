import { describe, expect, it } from 'vitest';
import { ChemicalSearchError } from '../services/chemicalSearchError';
import { getSearchErrorMessageKey } from '../utils/searchErrorMessage';

describe('getSearchErrorMessageKey', () => {
  it('keeps offline, external-service, and general failures separate', () => {
    expect(getSearchErrorMessageKey(new TypeError('Failed to fetch'), false)).toBe('search_offline_error');
    expect(getSearchErrorMessageKey(
      new ChemicalSearchError('temporary_unavailable', 'upstream unavailable'),
      true,
    )).toBe('search_external_service_error');
    expect(getSearchErrorMessageKey(new Error('unexpected'), true)).toBe('search_error');
  });
});
