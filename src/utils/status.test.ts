import { describe, expect, it } from 'vitest';
import { completedFromStatus, isBookingStatus, statusFromLegacyCompleted } from './status';

describe('booking status', () => {
  it('maps the legacy completed flag without treating it as the source of truth', () => {
    expect(statusFromLegacyCompleted(true)).toBe('completed');
    expect(statusFromLegacyCompleted(false)).toBe('new');
    expect(completedFromStatus('completed')).toBe(true);
    expect(completedFromStatus('in_progress')).toBe(false);
    expect(isBookingStatus('on_the_way')).toBe(true);
    expect(isBookingStatus('done')).toBe(false);
  });
});