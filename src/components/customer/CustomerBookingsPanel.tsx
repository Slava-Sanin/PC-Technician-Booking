import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { cancelCustomerBooking, fetchCustomerBookings } from '../../services/customerService';
import { fetchPublicBookingConfig, fetchServiceCatalog } from '../../services/publicApi';
import type { Booking } from '../../types/booking';
import type { PublicBookingConfig } from '../../types/bookingSettings';
import type { PublicCategory } from '../../types/catalog';
import { localized } from '../../types/catalog';
import { customerEditAvailability, netPaidAmount, pendingAdjustments } from '../../utils/customerEdit';
import { BUSINESS_TIME_ZONE, formatAppointmentInZone } from '../../utils/dateTime';
import { formatBookingLocation } from '../../utils/formatBookingLocation';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { formatMoney } from '../../utils/pricing';
import { useConfirm } from '../ui/ConfirmProvider';
import { Alert, Badge, Button, Card, DotSep } from '../ui';
import { CustomerBookingEditForm } from './CustomerBookingEditForm';

function asAmount(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function CustomerBookingsPanel({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const locale = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [config, setConfig] = useState<PublicBookingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = async () => {
    setLoading(true);
    try {
      const [list, catalog, nextConfig] = await Promise.all([
        fetchCustomerBookings(),
        fetchServiceCatalog(),
        fetchPublicBookingConfig(),
      ]);
      setBookings(list);
      setCategories(catalog.categories);
      setConfig(nextConfig);
      setNow(new Date());
    } catch {
      toast.error(t('fetchError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const timezone = config?.timezone || BUSINESS_TIME_ZONE;
  const whenFormatter = useMemo(() => new Intl.DateTimeFormat(
    locale === 'he' ? 'he-IL' : locale === 'ru' ? 'ru-RU' : 'en-GB',
    { dateStyle: 'short', timeStyle: 'short', timeZone: timezone },
  ), [locale, timezone]);

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

  const canCancel = (status: string) => !['completed', 'cancelled', 'no_show', 'payment_expired'].includes(status);
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

          {editingBooking && config ? (
            <CustomerBookingEditForm
              key={editingBooking.id}
              booking={editingBooking}
              categories={categories}
              config={config}
              onCancel={() => setEditingId(null)}
              onSaved={(updated) => {
                setBookings((current) => current.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)));
                setNow(new Date());
                setEditingId(null);
              }}
            />
          ) : (
            <ul className="space-y-3">
              {bookings.map((booking) => {
                const location = formatBookingLocation(booking.city, booking.address);
                const editability = customerEditAvailability(booking, now);
                const total = asAmount(booking.total_amount);
                const netPaid = netPaidAmount(booking.payments);
                const pending = pendingAdjustments(booking.payments);
                const currency = booking.currency ?? 'ILS';
                const when = booking.appointment_start
                  ? formatAppointmentInZone(booking.appointment_start, timezone)
                  : formatAppointmentInZone(booking.appointment_date, timezone);
                return (
                  <li key={booking.id} className="rounded-xl border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold">#{booking.booking_number}</p>
                        <p className="flex flex-wrap items-center text-sm text-muted">
                          {when}
                          <DotSep />
                          {t(`status_${booking.status}`, { defaultValue: booking.status })}
                          {location ? (
                            <>
                              <DotSep />
                              <span dir="auto">{location}</span>
                            </>
                          ) : null}
                        </p>
                        {booking.booking_services && booking.booking_services.length > 0 ? (
                          <p className="mt-1 text-xs text-muted">
                            {booking.booking_services.map((line) => localized(line.service_name_snapshot, locale)).join(', ')}
                          </p>
                        ) : null}
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-semibold text-ink">
                            {t('total')}: {total == null ? t('priceQuote') : formatMoney(total, currency, locale)}
                          </span>
                          {booking.payment_status ? (
                            <Badge tone={booking.payment_status === 'paid' ? 'success' : 'neutral'}>
                              {t(`pay_${booking.payment_status}`, { defaultValue: booking.payment_status })}
                            </Badge>
                          ) : null}
                          {netPaid > 0 ? <span className="text-muted">{t('customerPaid')}: {formatMoney(netPaid, currency, locale)}</span> : null}
                          {pending.pendingRefund > 0 ? <span className="text-muted">{t('customerPendingRefund', { amount: formatMoney(pending.pendingRefund, currency, locale) })}</span> : null}
                          {pending.pendingExtra > 0 ? <span className="text-muted">{t('customerPendingExtra', { amount: formatMoney(pending.pendingExtra, currency, locale) })}</span> : null}
                        </p>
                      </div>
                      {canCancel(booking.status) ? (
                        <div className="flex gap-2">
                          {editability.allowed || editability.reason === 'limit' ? (
                            <Button
                              variant="primary"
                              disabled={!editability.allowed || !config}
                              onClick={() => setEditingId(booking.id)}
                            >
                              {t('edit')}
                            </Button>
                          ) : null}
                          <Button variant="danger" onClick={() => void cancelBooking(booking.id)}>{t('customerCancelBooking')}</Button>
                        </div>
                      ) : null}
                    </div>
                    {editability.reason === 'limit' && editability.nextEditAt ? (
                      <div className="mt-2">
                        <Alert tone="warning">
                          {t('customerEditNextAvailable', { when: whenFormatter.format(editability.nextEditAt) })}
                        </Alert>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
