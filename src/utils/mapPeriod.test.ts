import { describe, expect, it } from 'vitest';
import { isCivilDateInRange, resolveMapPeriodRange } from './mapPeriod';

describe('resolveMapPeriodRange', () => {
  it('uses a single day for day preset', () => {
    expect(resolveMapPeriodRange('day', '2026-03-15', '', '')).toEqual({
      start: '2026-03-15',
      end: '2026-03-15',
    });
  });

  it('covers a calendar week starting Sunday', () => {
    expect(resolveMapPeriodRange('week', '2026-03-18', '', '')).toEqual({
      start: '2026-03-15',
      end: '2026-03-21',
    });
  });

  it('normalizes custom ranges', () => {
    expect(resolveMapPeriodRange('custom', '2026-03-01', '2026-02-01', '2026-03-10')).toEqual({
      start: '2026-02-01',
      end: '2026-03-10',
    });
  });
});

describe('isCivilDateInRange', () => {
  it('checks inclusive bounds', () => {
    const range = { start: '2026-03-01', end: '2026-03-07' };
    expect(isCivilDateInRange('2026-02-28', range)).toBe(false);
    expect(isCivilDateInRange('2026-03-01', range)).toBe(true);
    expect(isCivilDateInRange('2026-03-07', range)).toBe(true);
    expect(isCivilDateInRange('2026-03-08', range)).toBe(false);
  });
});
