import { describe, expect, it } from 'vitest';
import type { BookingPaymentLine } from '../types/booking';
import {
  customerEditAvailability,
  netPaidAmount,
  nextCustomerEditAt,
  paymentAdjustment,
  pendingAdjustments,
} from './customerEdit';

const NOW = '2026-10-18T10:00:00Z';

function booking(overrides: Partial<Parameters<typeof customerEditAvailability>[0]> = {}) {
  return {
    status: 'confirmed',
    appointment_start: '2026-10-25T08:00:00Z',
    appointment_date: '2026-10-25T08:00:00Z',
    customer_edited_at: null,
    ...overrides,
  };
}

function payment(overrides: Partial<BookingPaymentLine>): BookingPaymentLine {
  return {
    id: 'p',
    kind: 'charge',
    amount: 0,
    currency: 'ILS',
    status: 'paid',
    provider: 'bit',
    created_at: NOW,
    paid_at: null,
    refunded_at: null,
    ...overrides,
  };
}

describe('customer edit availability', () => {
  it('allows editing of upcoming bookings that were not changed in the last 24 hours', () => {
    expect(customerEditAvailability(booking(), NOW)).toEqual({ allowed: true, reason: null, nextEditAt: null });
    expect(customerEditAvailability(booking({ customer_edited_at: '2026-10-17T09:59:00Z' }), NOW).allowed).toBe(true);
  });

  it('blocks a second change within 24 hours and tells when the next one is possible', () => {
    const result = customerEditAvailability(booking({ customer_edited_at: '2026-10-18T08:30:00Z' }), NOW);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('limit');
    expect(result.nextEditAt?.toISOString()).toBe('2026-10-19T08:30:00.000Z');
    expect(nextCustomerEditAt('2026-10-18T08:30:00Z')?.toISOString()).toBe('2026-10-19T08:30:00.000Z');
    expect(nextCustomerEditAt(null)).toBeNull();
  });

  it('blocks finished, cancelled, in-progress and past bookings', () => {
    expect(customerEditAvailability(booking({ status: 'cancelled' }), NOW).reason).toBe('status');
    expect(customerEditAvailability(booking({ status: 'in_progress' }), NOW).reason).toBe('status');
    expect(customerEditAvailability(booking({ status: 'completed' }), NOW).reason).toBe('status');
    expect(customerEditAvailability(booking({ appointment_start: '2026-10-18T09:00:00Z' }), NOW).reason).toBe('past');
  });
});

describe('payment reconciliation preview', () => {
  it('nets paid charges against completed refunds and ignores pending rows', () => {
    expect(netPaidAmount(undefined)).toBe(0);
    expect(netPaidAmount([
      payment({ amount: 300 }),
      payment({ amount: '50.5', kind: 'refund', status: 'refunded' }),
      payment({ amount: 20, kind: 'refund', status: 'pending' }),
      payment({ amount: 80, status: 'awaiting_verification' }),
      payment({ amount: 999, status: 'failed' }),
    ])).toBe(249.5);
  });

  it('reports adjustments that still wait for the administrator', () => {
    expect(pendingAdjustments([
      payment({ amount: 20, kind: 'refund', status: 'pending' }),
      payment({ amount: 80, status: 'awaiting_verification' }),
      payment({ amount: 300 }),
    ])).toEqual({ pendingRefund: 20, pendingExtra: 80 });
  });

  it('refunds the difference when the new total is lower and charges when higher', () => {
    expect(paymentAdjustment(300, 180)).toEqual({ kind: 'refund', amount: 120 });
    expect(paymentAdjustment(300, 450.25)).toEqual({ kind: 'extra', amount: 150.25 });
    expect(paymentAdjustment(300, 300)).toEqual({ kind: 'none', amount: 0 });
    expect(paymentAdjustment(300, 0)).toEqual({ kind: 'refund', amount: 300 });
  });

  it('keeps the money as a prepayment when the new price is only known after diagnostics', () => {
    expect(paymentAdjustment(300, null)).toEqual({ kind: 'prepaid', amount: 0 });
    expect(paymentAdjustment(0, 180)).toEqual({ kind: 'none', amount: 0 });
  });
});
