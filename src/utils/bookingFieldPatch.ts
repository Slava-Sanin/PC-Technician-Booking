import type { BookingUpdate, EditableBookingField, PaymentStatus } from '../types/booking';
import { PAYMENT_STATUSES } from '../types/booking';
import type { ServiceMode } from '../types/catalog';
import { SERVICE_MODES } from '../types/catalog';

const PAYMENT_STATUS_SET = new Set<string>(PAYMENT_STATUSES);
const SERVICE_MODE_SET = new Set<string>(SERVICE_MODES);

function nullableTrimmed(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function bookingFieldPatch(field: EditableBookingField, value: string): BookingUpdate {
  if (field === 'city') {
    return { city: nullableTrimmed(value) };
  }
  if (field === 'email') {
    const trimmed = value.trim();
    return { email: trimmed ? trimmed.toLowerCase() : null };
  }
  if (field === 'device_type' || field === 'device_brand' || field === 'device_model') {
    return { [field]: nullableTrimmed(value) };
  }
  if (field === 'problem_description') {
    return { problem_description: value.trim() ? value : null };
  }
  if (field === 'comments' || field === 'technician_notes') {
    return { [field]: value };
  }
  if (field === 'appointment_date') {
    return { appointment_date: value };
  }
  if (field === 'service_mode') {
    const mode = value.trim().toLowerCase();
    return { service_mode: SERVICE_MODE_SET.has(mode) ? (mode as ServiceMode) : null };
  }
  if (field === 'payment_status') {
    const status = value.trim();
    return {
      payment_status: status && PAYMENT_STATUS_SET.has(status) ? (status as PaymentStatus) : null,
    };
  }
  if (field === 'total_amount') {
    const trimmed = value.trim();
    if (!trimmed) {
      return { total_amount: null, subtotal: null };
    }
    const amount = Number(trimmed);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('INVALID_AMOUNT');
    }
    return { total_amount: amount, subtotal: amount };
  }
  if (field === 'currency') {
    const code = value.trim().toUpperCase();
    return { currency: code ? code : null };
  }
  return { [field]: value.trim() };
}
