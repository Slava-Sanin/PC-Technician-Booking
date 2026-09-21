import { useCallback, useEffect, useState } from 'react';
import { fetchBookings, softDeleteBooking, updateBooking, updateBookingStatus } from '../services/bookingService';
import type { Booking, BookingStatus, BookingUpdate, EditableBookingField } from '../types/booking';

export function useBookings(enabled: boolean) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [statusFilter, setStatusFilter] = useState<BookingStatus | 'all'>('all');

  const refresh = useCallback(async () => {
    if (!enabled) {
      setBookings([]);
      setLoading(false);
      setLoaded(false);
      return;
    }

    setLoading(true);
    try {
      setBookings(await fetchBookings(includeDeleted));
      setError(false);
    } catch (caught) {
      setError(true);
      throw caught;
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [enabled, includeDeleted]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const saveField = useCallback(async (id: string, field: EditableBookingField, value: string) => {
    const patch: BookingUpdate = {};
    if (field === 'city') {
      patch.city = value.trim() ? value.trim() : null;
    } else if (field === 'comments' || field === 'technician_notes') {
      patch[field] = value;
    } else if (field === 'appointment_date') {
      patch.appointment_date = value;
    } else {
      patch[field] = value.trim();
    }

    await updateBooking(id, patch);
    await refresh();
  }, [refresh]);

  const saveStatus = useCallback(async (id: string, status: BookingStatus) => {
    await updateBookingStatus(id, status);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await softDeleteBooking(id);
    await refresh();
  }, [refresh]);

  const visibleBookings = bookings.filter((booking) => statusFilter === 'all' || booking.status === statusFilter);

  return {
    bookings: visibleBookings,
    loading,
    loaded,
    error,
    includeDeleted,
    setIncludeDeleted,
    statusFilter,
    setStatusFilter,
    refresh,
    saveField,
    saveStatus,
    remove,
  };
}
