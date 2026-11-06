import { beforeEach, describe, expect, it } from 'vitest';
import {
  LAB_ADMIN_ATTENTION_TTL_MS,
  getLabAdminAttentionGeneration,
  invalidateLabAdminAttention,
  isLabAdminAttentionFresh,
  primeLabAdminAttention,
  useLabAdminAttentionStore,
} from './useLabAdminAttentionStore';

const NOW = Date.UTC(2026, 10, 6, 3);

describe('lab admin attention cache', () => {
  beforeEach(() => {
    useLabAdminAttentionStore.setState({ entries: {}, generation: {} });
  });

  it('keeps a count fresh for five minutes', () => {
    expect(LAB_ADMIN_ATTENTION_TTL_MS).toBe(5 * 60 * 1000);
    expect(isLabAdminAttentionFresh(undefined, NOW)).toBe(false);
    expect(isLabAdminAttentionFresh({ count: 2, loadedAt: NOW }, NOW)).toBe(true);
    expect(isLabAdminAttentionFresh({ count: 2, loadedAt: NOW }, NOW + LAB_ADMIN_ATTENTION_TTL_MS - 1)).toBe(true);
    expect(isLabAdminAttentionFresh({ count: 2, loadedAt: NOW }, NOW + LAB_ADMIN_ATTENTION_TTL_MS)).toBe(false);
  });

  it('stores a count per lab', () => {
    primeLabAdminAttention('lab-a', 2, NOW);
    primeLabAdminAttention('lab-b', 0, NOW + 1);
    expect(useLabAdminAttentionStore.getState().entries).toEqual({
      'lab-a': { count: 2, loadedAt: NOW },
      'lab-b': { count: 0, loadedAt: NOW + 1 },
    });
  });

  it('drops one lab and bumps its generation on invalidation', () => {
    primeLabAdminAttention('lab-a', 2, NOW);
    primeLabAdminAttention('lab-b', 1, NOW);
    invalidateLabAdminAttention('lab-a');
    expect(useLabAdminAttentionStore.getState().entries).toEqual({ 'lab-b': { count: 1, loadedAt: NOW } });
    expect(getLabAdminAttentionGeneration('lab-a')).toBe(1);
    expect(getLabAdminAttentionGeneration('lab-b')).toBe(0);
    invalidateLabAdminAttention('lab-a');
    expect(getLabAdminAttentionGeneration('lab-a')).toBe(2);
  });

  it('drops every lab without an id', () => {
    primeLabAdminAttention('lab-a', 2, NOW);
    primeLabAdminAttention('lab-b', 1, NOW);
    invalidateLabAdminAttention('lab-a');
    invalidateLabAdminAttention();
    expect(useLabAdminAttentionStore.getState().entries).toEqual({});
    expect(getLabAdminAttentionGeneration('lab-a')).toBe(2);
    expect(getLabAdminAttentionGeneration('lab-b')).toBe(1);
  });
});
