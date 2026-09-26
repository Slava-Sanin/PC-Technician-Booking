import { describe, expect, it } from 'vitest';
import { bookingTotal, formatDurationMinutes, formatMoney, lineTotal, sumDuration } from './pricing';

describe('price and duration', () => {
  it('sums service durations and prices several services independently', () => {
    expect(sumDuration([
      { durationMinutes: 120 },
      { durationMinutes: 90 },
      { durationMinutes: 30 },
    ])).toBe(240);

    const lines = [
      { total: lineTotal('fixed', 180, 60) },
      { total: lineTotal('hourly', 150, 90) },
      { total: lineTotal('from', 250, 60) },
      { total: lineTotal('quote', null, 180) },
    ];
    expect(lines.map((line) => line.total)).toEqual([180, 225, 250, null]);
    expect(bookingTotal(lines)).toBe(655);
    expect(bookingTotal([{ total: null }, { total: null }])).toBeNull();
  });

  it('formats duration in minutes or hours and minutes', () => {
    const units = { minutesShort: 'мин', hoursShort: 'ч' };
    expect(formatDurationMinutes(45, units)).toBe('45 мин');
    expect(formatDurationMinutes(59, units)).toBe('59 мин');
    expect(formatDurationMinutes(60, units)).toBe('1 ч');
    expect(formatDurationMinutes(90, units)).toBe('1 ч 30 мин');
    expect(formatDurationMinutes(125, units)).toBe('2 ч 5 мин');
  });

  it('formats money through the currency code instead of a hardcoded symbol', () => {
    const formatted = formatMoney(180, 'ILS', 'en');
    expect(formatted).toContain('180');
    expect(formatted).not.toMatch(/\$/);
  });
});
