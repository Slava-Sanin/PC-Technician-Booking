import { supabase } from '../lib/supabase';
import type { Booking, BookingStatus, BookingUpdate } from '../types/booking';
import { isBookingStatus, statusFromLegacyCompleted } from '../utils/status';

interface BookingRow extends Omit<Booking, 'status' | 'completed'> {
  status?: string | null;
  completed?: boolean | null;
}

function normalizeBooking(row: BookingRow): Booking {
  const status = isBookingStatus(row.status)
    ? row.status
    : statusFromLegacyCompleted(Boolean(row.completed));

  return {
    ...row,
    status,
    completed: status === 'completed',
    comments: row.comments ?? null,
    city: row.city ?? null,
    email: row.email ?? null,
    service_mode: row.service_mode ?? null,
    device_type: row.device_type ?? null,
    device_brand: row.device_brand ?? null,
    device_model: row.device_model ?? null,
    problem_description: row.problem_description ?? null,
    appointment_start: row.appointment_start ?? null,
    appointment_end: row.appointment_end ?? null,
    subtotal: row.subtotal ?? null,
    total_amount: row.total_amount ?? null,
    currency: row.currency ?? null,
    payment_status: row.payment_status ?? null,
    payment_expires_at: row.payment_expires_at ?? null,
    technician_notes: row.technician_notes ?? null,
    updated_at: row.updated_at ?? null,
    deleted_at: row.deleted_at ?? null,
    booking_services: row.booking_services ?? [],
  };
}

export async function fetchBookings(includeDeleted: boolean): Promise<Booking[]> {
  let query = supabase.from('bookings').select('*, booking_services(*)').order('appointment_date', { ascending: true });
  query = includeDeleted ? query.not('deleted_at', 'is', null) : query.is('deleted_at', null);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => normalizeBooking(row as BookingRow));
}

export async function updateBooking(id: string, patch: BookingUpdate): Promise<Booking> {
  const { data, error } = await supabase
    .from('bookings')
    .update(patch)
    .eq('id', id)
    .select('*, booking_services(*)')
    .maybeSingle();

  if (error || !data) {
    throw error ?? new Error('UPDATE_FAILED');
  }

  return normalizeBooking(data as BookingRow);
}

export function updateBookingStatus(id: string, status: BookingStatus): Promise<Booking> {
  return updateBooking(id, { status });
}

export function softDeleteBooking(id: string): Promise<Booking> {
  return updateBooking(id, { deleted_at: new Date().toISOString() });
}
