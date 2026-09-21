import { describe, expect, it } from 'vitest';
import {
  formatAppointmentInZone,
  parseDisplayDate,
  parseDisplayDateTime,
  todayISOInTimeZone,
  zonedTimeToUtc,
} from './dateTime';

describe('Asia/Jerusalem civil time', () => {
  it('converts a winter afternoon to UTC+2', () => {
    expect(zonedTimeToUtc('2026-01-15', '14:00', 'Asia/Jerusalem').toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('converts a summer afternoon to UTC+3', () => {
    expect(zonedTimeToUtc('2026-07-15', '14:00', 'Asia/Jerusalem').toISOString()).toBe('2026-07-15T11:00:00.000Z');
  });

  it('uses Israel standard time on the day before the spring transition', () => {
    expect(zonedTimeToUtc('2026-03-26', '09:00', 'Asia/Jerusalem').toISOString()).toBe('2026-03-26T07:00:00.000Z');
  });

  it('uses Israel daylight time on the day of the spring transition after 02:00', () => {
    expect(zonedTimeToUtc('2026-03-27', '09:00', 'Asia/Jerusalem').toISOString()).toBe('2026-03-27T06:00:00.000Z');
  });

  it('formats a stored UTC timestamp back in Jerusalem time', () => {
    expect(formatAppointmentInZone('2026-07-15T11:00:00.000Z', 'Asia/Jerusalem')).toBe('15/07/2026 14:00');
  });

  it('rejects an impossible calendar date', () => {
    expect(parseDisplayDate('31/02/2026')).toBeNull();
    expect(parseDisplayDateTime('15/07/2026 14:00')).toEqual({ date: '2026-07-15', time: '14:00' });
  });

  it('reads today in the business time zone rather than a fixed offset', () => {
    const today = todayISOInTimeZone('Asia/Jerusalem', new Date('2026-01-15T22:30:00.000Z'));
    expect(today).toBe('2026-01-16');
  });
});
