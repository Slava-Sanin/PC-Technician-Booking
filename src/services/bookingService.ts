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
    technician_notes: row.technician_notes ?? null,
    updated_at: row.updated_at ?? null,
    deleted_at: row.deleted_at ?? null,
  };
}

export async function fetchBookings(includeDeleted: boolean): Promise<Booking[]> {
  let query = supabase.from('bookings').select('*').order('appointment_date', { ascending: true });
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
    .select('*')
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
