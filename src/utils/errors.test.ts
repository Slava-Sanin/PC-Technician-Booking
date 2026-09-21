import { describe, expect, it } from 'vitest';
import { errorI18nKey, normalizeErrorCode } from './errors';

describe('error mapping', () => {
  it('keeps known server codes and hides unknown technical failures', () => {
    expect(normalizeErrorCode('SLOT_UNAVAILABLE')).toBe('SLOT_UNAVAILABLE');
    expect(normalizeErrorCode('duplicate key value')).toBe('INTERNAL_ERROR');
    expect(errorI18nKey('RATE_LIMITED')).toBe('error_RATE_LIMITED');
  });
});
