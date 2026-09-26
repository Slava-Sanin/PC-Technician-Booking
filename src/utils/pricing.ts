import type { PriceType } from '../types/catalog';

export function lineTotal(
  priceType: PriceType,
  unitPrice: number | null,
  durationMinutes: number,
  quantity = 1,
): number | null {
  if (priceType === 'quote' || priceType === 'diagnostic' || unitPrice == null) return null;
  const raw = priceType === 'hourly'
    ? unitPrice * (durationMinutes / 60) * quantity
    : unitPrice * quantity;
  return Math.round(raw * 100) / 100;
}

export function sumDuration(items: Array<{ durationMinutes: number }>): number {
  return items.reduce((total, item) => total + item.durationMinutes, 0);
}

export interface DurationUnitLabels {
  minutesShort: string;
  hoursShort: string;
}

export function formatDurationMinutes(totalMinutes: number, units: DurationUnitLabels): string {
  if (totalMinutes <= 59) {
    return `${totalMinutes} ${units.minutesShort}`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours} ${units.hoursShort}`;
  }
  return `${hours} ${units.hoursShort} ${minutes} ${units.minutesShort}`;
}

export function bookingTotal(lines: Array<{ total: number | null }>): number | null {
  if (lines.length === 0 || lines.every((line) => line.total == null)) return null;
  const sum = lines.reduce((total, line) => total + (line.total ?? 0), 0);
  return Math.round(sum * 100) / 100;
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  const language = locale.startsWith('he') ? 'he-IL' : locale.startsWith('ru') ? 'ru-RU' : 'en-IL';
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
