import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import {
  cancelCustomerBooking,
  fetchCustomerBookings,
  updateCustomerBooking,
} from '../../services/customerService';
import type { Booking } from '../../types/booking';
import { formatISODateToDisplay } from '../../utils/dateTime';
import { formatBookingLocation } from '../../utils/formatBookingLocation';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { useConfirm } from '../ui/ConfirmProvider';
import { Button, Card, DotSep, Field, Input, Textarea } from '../ui';

export function CustomerBookingsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ address: '', city: '', comments: '', phone: '' });

  const load = async () => {
    setLoading(true);
    try {
      setBookings(await fetchCustomerBookings());
    } catch {
      toast.error(t('fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startEdit = (booking: Booking) => {
    setEditingId(booking.id);
    setDraft({
      address: booking.address,
      city: booking.city ?? '',
      comments: booking.comments ?? '',
      phone: booking.phone,
    });
  };

  const saveEdit = async (bookingId: string) => {
    try {
      const updated = await updateCustomerBooking(bookingId, {
        address: draft.address.trim(),
        city: draft.city.trim(),
        comments: draft.comments.trim() || null,
        phone: draft.phone.trim(),
      });
      setBookings((current) => current.map((item) => (item.id === bookingId ? { ...item, ...updated } : item)));
      setEditingId(null);
      toast.success(t('fieldUpdated'));
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
      toast.error(t(errorI18nKey(code)));
    }
  };

  const cancelBooking = async (bookingId: string) => {
    const ok = await confirm({
      message: t('customerCancelConfirm'),
      confirmLabel: t('customerCancelBooking'),
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const updated = await cancelCustomerBooking(bookingId);
      setBookings((current) => current.map((item) => (item.id === bookingId ? { ...item, ...updated } : item)));
      toast.success(t('customerBookingCancelled'));
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
      toast.error(t(errorI18nKey(code)));
    }
  };

  const canModify = (status: string) => !['completed', 'cancelled', 'no_show', 'payment_expired'].includes(status);
  const editingBooking = editingId ? bookings.find((booking) => booking.id === editingId) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4">
      <Card className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden p-0">
        <div className="relative flex items-center border-b border-line px-4 py-3">
          <div className="flex-1 text-center">
            <h2 className="text-lg font-semibold">
              {editingBooking ? t('customerEditBookingTitle') : t('customerMyBookings')}
            </h2>
            {editingBooking ? (
              <p className="text-sm text-muted">#{editingBooking.booking_number}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="absolute end-4 inline-flex h-11 w-11 shrink-0 items-center justify-center text-3xl font-bold leading-none text-muted transition hover:text-ink"
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? <p className="text-sm text-muted">{t('loading')}</p> : null}
          {!loading && bookings.length === 0 ? <p className="text-sm text-muted">{t('customerNoBookings')}</p> : null}
          <ul className="space-y-3">
            {bookings.map((booking) => {
              const location = formatBookingLocation(booking.city, booking.address);
              return (
              <li key={booking.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">#{booking.booking_number}</p>
                    <p className="flex flex-wrap items-center text-sm text-muted">
                      {formatISODateToDisplay(booking.appointment_date)}
                      <DotSep />
                      {t(`status_${booking.status}`, { defaultValue: booking.status })}
                      {editingId !== booking.id && location ? (
                        <>
                          <DotSep />
                          <span dir="auto">{location}</span>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {canModify(booking.status) ? (
                    <div className="flex gap-2">
                      {editingId !== booking.id ? (
                        <Button variant="primary" onClick={() => startEdit(booking)}>{t('edit')}</Button>
                      ) : null}
                      <Button variant="danger" onClick={() => void cancelBooking(booking.id)}>{t('customerCancelBooking')}</Button>
                    </div>
                  ) : null}
                </div>
                {editingId === booking.id ? (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <Field label={t('phone')}><Input value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} /></Field>
                    <Field label={t('city')}><Input value={draft.city} maxLength={80} onChange={(event) => setDraft((value) => ({ ...value, city: event.target.value }))} /></Field>
                    <Field label={t('address')}><Input value={draft.address} maxLength={200} onChange={(event) => setDraft((value) => ({ ...value, address: event.target.value }))} /></Field>
                    <Field label={t('comments')}><Textarea rows={3} value={draft.comments} onChange={(event) => setDraft((value) => ({ ...value, comments: event.target.value }))} /></Field>
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button variant="primary" onClick={() => void saveEdit(booking.id)}>{t('save')}</Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>{t('cancel')}</Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
            })}
          </ul>
        </div>
      </Card>
    </div>
  );
}
