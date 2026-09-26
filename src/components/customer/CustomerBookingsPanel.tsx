import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import {
  cancelCustomerBooking,
  fetchCustomerBookings,
  logoutCustomer,
  updateCustomerBooking,
  type CustomerProfile,
} from '../../services/customerService';
import type { Booking } from '../../types/booking';
import { formatISODateToDisplay } from '../../utils/dateTime';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { Button, Card, Field, Input, Textarea } from '../ui';

export function CustomerBookingsPanel({
  profile,
  onClose,
  onLogout,
}: {
  profile: CustomerProfile;
  onClose: () => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ address: '', comments: '', phone: '' });

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
      comments: booking.comments ?? '',
      phone: booking.phone,
    });
  };

  const saveEdit = async (bookingId: string) => {
    try {
      const updated = await updateCustomerBooking(bookingId, {
        address: draft.address.trim(),
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
    if (!window.confirm(t('customerCancelConfirm'))) return;
    try {
      const updated = await cancelCustomerBooking(bookingId);
      setBookings((current) => current.map((item) => (item.id === bookingId ? { ...item, ...updated } : item)));
      toast.success(t('customerBookingCancelled'));
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
      toast.error(t(errorI18nKey(code)));
    }
  };

  const handleLogout = async () => {
    await logoutCustomer();
    onLogout();
    onClose();
  };

  const canModify = (status: string) => !['completed', 'cancelled', 'no_show', 'payment_expired'].includes(status);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden p-0">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">{t('customerMyBookings')}</h2>
            <p className="text-sm text-muted">{profile.firstName} {profile.lastName}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => void handleLogout()}>{t('logout')}</Button>
            <Button variant="ghost" onClick={onClose}>{t('close')}</Button>
          </div>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? <p className="text-sm text-muted">{t('loading')}</p> : null}
          {!loading && bookings.length === 0 ? <p className="text-sm text-muted">{t('customerNoBookings')}</p> : null}
          <ul className="space-y-3">
            {bookings.map((booking) => (
              <li key={booking.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">#{booking.booking_number}</p>
                    <p className="text-sm text-muted">{formatISODateToDisplay(booking.appointment_date)} · {t(`status_${booking.status}`, { defaultValue: booking.status })}</p>
                  </div>
                  {canModify(booking.status) ? (
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => startEdit(booking)}>{t('edit')}</Button>
                      <Button variant="ghost" onClick={() => void cancelBooking(booking.id)}>{t('customerCancelBooking')}</Button>
                    </div>
                  ) : null}
                </div>
                {editingId === booking.id ? (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    <Field label={t('phone')}><Input value={draft.phone} onChange={(event) => setDraft((value) => ({ ...value, phone: event.target.value }))} /></Field>
                    <Field label={t('address')}><Input value={draft.address} onChange={(event) => setDraft((value) => ({ ...value, address: event.target.value }))} /></Field>
                    <Field label={t('comments')}><Textarea rows={3} value={draft.comments} onChange={(event) => setDraft((value) => ({ ...value, comments: event.target.value }))} /></Field>
                    <div className="flex gap-2">
                      <Button onClick={() => void saveEdit(booking.id)}>{t('save')}</Button>
                      <Button variant="ghost" onClick={() => setEditingId(null)}>{t('cancel')}</Button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 text-sm">{booking.address}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Card>
    </div>
  );
}
