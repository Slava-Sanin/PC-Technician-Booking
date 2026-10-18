import type { BookingPaymentLine, BookingStatus } from '../types/booking';

/** Statuses in which the customer may still change the booking (mirrors customer_update_booking). */
export const CUSTOMER_EDITABLE_STATUSES: readonly BookingStatus[] = ['new', 'pending_payment', 'confirmed', 'assigned'];

/** A customer may change a booking once per this interval (mirrors the SQL rule). */
export const CUSTOMER_EDIT_INTERVAL_MS = 24 * 60 * 60 * 1000;

export type CustomerEditBlockReason = 'status' | 'past' | 'limit';

export interface CustomerEditAvailability {
  allowed: boolean;
  reason: CustomerEditBlockReason | null;
  /** When the next change becomes possible (only set while the daily limit blocks editing). */
  nextEditAt: Date | null;
}

export function nextCustomerEditAt(
  customerEditedAt: string | null | undefined,
  intervalMs = CUSTOMER_EDIT_INTERVAL_MS,
): Date | null {
  if (!customerEditedAt) return null;
  const edited = new Date(customerEditedAt).getTime();
  if (!Number.isFinite(edited)) return null;
  return new Date(edited + intervalMs);
}

export function customerEditAvailability(
  booking: {
    status: string;
    appointment_start: string | null;
    appointment_date: string;
    customer_edited_at?: string | null;
  },
  now: Date | string = new Date(),
): CustomerEditAvailability {
  if (!CUSTOMER_EDITABLE_STATUSES.includes(booking.status as BookingStatus)) {
    return { allowed: false, reason: 'status', nextEditAt: null };
  }

  const current = new Date(now).getTime();
  const start = new Date(booking.appointment_start ?? booking.appointment_date).getTime();
  if (Number.isFinite(start) && start <= current) {
    return { allowed: false, reason: 'past', nextEditAt: null };
  }

  const next = nextCustomerEditAt(booking.customer_edited_at);
  if (next && next.getTime() > current) {
    return { allowed: false, reason: 'limit', nextEditAt: next };
  }

  return { allowed: true, reason: null, nextEditAt: null };
}

function amountOf(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Money actually settled: paid charges minus completed refunds (mirrors the SQL reconciliation). */
export function netPaidAmount(payments: BookingPaymentLine[] | undefined): number {
  if (!payments || payments.length === 0) return 0;
  const sum = payments.reduce((total, payment) => {
    if (payment.kind === 'charge' && payment.status === 'paid') return total + amountOf(payment.amount);
    if (payment.kind === 'refund' && payment.status === 'refunded') return total - amountOf(payment.amount);
    return total;
  }, 0);
  return round2(sum);
}

export interface PendingAdjustments {
  /** Refund recorded but not yet transferred back to the customer. */
  pendingRefund: number;
  /** Top-up requested from the customer but not yet confirmed. */
  pendingExtra: number;
}

export function pendingAdjustments(payments: BookingPaymentLine[] | undefined): PendingAdjustments {
  const result: PendingAdjustments = { pendingRefund: 0, pendingExtra: 0 };
  for (const payment of payments ?? []) {
    if (payment.kind === 'refund' && payment.status === 'pending') {
      result.pendingRefund = round2(result.pendingRefund + amountOf(payment.amount));
    } else if (payment.kind === 'charge' && (payment.status === 'pending' || payment.status === 'awaiting_verification')) {
      result.pendingExtra = round2(result.pendingExtra + amountOf(payment.amount));
    }
  }
  return result;
}

export type PaymentAdjustmentKind = 'none' | 'refund' | 'extra' | 'prepaid';

export interface PaymentAdjustment {
  kind: PaymentAdjustmentKind;
  amount: number;
}

/**
 * What happens to the money when a paid booking changes to `newTotal`.
 * - nothing was paid: no adjustment;
 * - new total unknown (quote): the payment stays as a prepayment;
 * - otherwise the difference is refunded or charged additionally.
 */
export function paymentAdjustment(netPaid: number, newTotal: number | null): PaymentAdjustment {
  if (netPaid <= 0) return { kind: 'none', amount: 0 };
  if (newTotal == null) return { kind: 'prepaid', amount: 0 };
  const delta = round2(newTotal - netPaid);
  if (delta < 0) return { kind: 'refund', amount: -delta };
  if (delta > 0) return { kind: 'extra', amount: delta };
  return { kind: 'none', amount: 0 };
}
