import { describe, expect, it } from 'vitest';
import { bookingTotal, formatDurationMinutes, formatMoney, lineTotal, subscriptionQuote, subscriptionRefund, sumDuration } from './pricing';

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

describe('technician subscription pricing', () => {
  const tiers = [
    { minMonths: 3, discountPercent: 5 },
    { minMonths: 6, discountPercent: 10 },
    { minMonths: 12, discountPercent: 20 },
  ];

  it('applies the highest tier whose threshold is reached, none below three months', () => {
    expect(subscriptionQuote(1, 99, tiers)).toMatchObject({ discountPercent: 0, amountTotal: 99, fullPrice: 99 });
    expect(subscriptionQuote(2, 99, tiers).discountPercent).toBe(0);
    expect(subscriptionQuote(3, 99, tiers)).toMatchObject({ discountPercent: 5, amountTotal: 282.15 });
    expect(subscriptionQuote(5, 99, tiers).discountPercent).toBe(5);
    expect(subscriptionQuote(6, 100, tiers)).toMatchObject({ discountPercent: 10, amountTotal: 540 });
    expect(subscriptionQuote(24, 100, tiers)).toMatchObject({ discountPercent: 20, amountTotal: 1920, fullPrice: 2400 });
    expect(subscriptionQuote(0, 100, tiers).months).toBe(1);
  });

  it('refunds unused whole days of the paid amount; the started day is used', () => {
    const start = '2026-01-01T10:00:00Z';
    const end = '2026-01-31T10:00:00Z';
    expect(subscriptionRefund(300, start, end, '2026-01-01T10:00:00Z')).toEqual({ refundAmount: 300, totalDays: 30, remainingDays: 30 });
    expect(subscriptionRefund(300, start, end, '2026-01-01T12:00:00Z')).toEqual({ refundAmount: 290, totalDays: 30, remainingDays: 29 });
    expect(subscriptionRefund(300, start, end, '2026-01-11T10:00:00Z')).toEqual({ refundAmount: 200, totalDays: 30, remainingDays: 20 });
    expect(subscriptionRefund(300, start, end, '2026-02-15T00:00:00Z')).toEqual({ refundAmount: 0, totalDays: 30, remainingDays: 0 });
    expect(subscriptionRefund(300, end, start).refundAmount).toBe(0);
  });
});
