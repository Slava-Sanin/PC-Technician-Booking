import { describe, expect, it } from 'vitest';
import { bookingFieldPatch } from './bookingFieldPatch';

describe('bookingFieldPatch', () => {
  it('clears email to null', () => {
    expect(bookingFieldPatch('email', '  ')).toEqual({ email: null });
    expect(bookingFieldPatch('email', ' User@Example.com ')).toEqual({ email: 'user@example.com' });
  });

  it('syncs subtotal when total changes', () => {
    expect(bookingFieldPatch('total_amount', '150')).toEqual({ total_amount: 150, subtotal: 150 });
    expect(bookingFieldPatch('total_amount', '')).toEqual({ total_amount: null, subtotal: null });
  });
});
