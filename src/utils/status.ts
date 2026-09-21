import { BOOKING_STATUSES, type BookingStatus } from '../types/booking';

const STATUS_SET = new Set<string>(BOOKING_STATUSES);

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && STATUS_SET.has(value);
}

export function statusFromLegacyCompleted(completed: boolean): BookingStatus {
  return completed ? 'completed' : 'new';
}

export function completedFromStatus(status: BookingStatus): boolean {
  return status === 'completed';
}
