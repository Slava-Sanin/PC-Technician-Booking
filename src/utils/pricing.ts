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

export interface SubscriptionQuoteResult {
  months: number;
  monthlyPrice: number;
  discountPercent: number;
  amountTotal: number;
  fullPrice: number;
}

/** Mirrors public.quote_subscription: the tier with the largest minMonths <= months wins. */
export function subscriptionQuote(
  months: number,
  monthlyPrice: number,
  tiers: Array<{ minMonths: number; discountPercent: number }>,
): SubscriptionQuoteResult {
  const safeMonths = Number.isInteger(months) && months >= 1 ? months : 1;
  const tier = [...tiers]
    .filter((item) => item.minMonths <= safeMonths)
    .sort((left, right) => right.minMonths - left.minMonths)[0];
  const discountPercent = tier ? tier.discountPercent : 0;
  const fullPrice = Math.round(safeMonths * monthlyPrice * 100) / 100;
  const amountTotal = Math.round(safeMonths * monthlyPrice * (1 - discountPercent / 100) * 100) / 100;
  return { months: safeMonths, monthlyPrice, discountPercent, amountTotal, fullPrice };
}

export interface SubscriptionRefundResult {
  refundAmount: number;
  totalDays: number;
  remainingDays: number;
}

const DAY_MS = 86_400_000;

/** Mirrors public.subscription_refund_amount: whole days, the started day counts as used. */
export function subscriptionRefund(
  amountTotal: number,
  startsAt: Date | string,
  endsAt: Date | string,
  now: Date | string = new Date(),
): SubscriptionRefundResult {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const current = new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(current) || end <= start) {
    return { refundAmount: 0, totalDays: 0, remainingDays: 0 };
  }
  const totalDays = Math.max(Math.ceil((end - start) / DAY_MS), 1);
  const usedDays = Math.max(Math.ceil((current - start) / DAY_MS), 0);
  const remainingDays = Math.max(totalDays - usedDays, 0);
  const refundAmount = Math.round((amountTotal * remainingDays / totalDays) * 100) / 100;
  return { refundAmount, totalDays, remainingDays };
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  const language = locale.startsWith('he') ? 'he-IL' : locale.startsWith('ru') ? 'ru-RU' : 'en-IL';
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}
