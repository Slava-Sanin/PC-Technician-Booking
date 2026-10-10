import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Trash2 } from 'lucide-react';
import { useConfirm } from '../ui/ConfirmProvider';
import { AppointmentDateTimeField } from '../schedule/AppointmentDateTimeField';
import { compareSortValues, SortableTableHead, TableHead, toggleSortState } from './sortableTableHead';
import { BOOKING_STATUSES, PAYMENT_STATUSES, type Booking, type BookingStatus, type EditableBookingField } from '../../types/booking';
import type { PublicBookingConfig } from '../../types/bookingSettings';
import { DEVICE_TYPES, localized, OPERATING_SYSTEMS, SERVICE_MODES } from '../../types/catalog';
import { formatAppointmentInZone, parseDisplayDateTime, zonedTimeToUtc } from '../../utils/dateTime';
import { formatMoney } from '../../utils/pricing';

interface BookingTableProps {
  bookings: Booking[];
  timeZone: string;
  scheduleConfig: PublicBookingConfig | null;
  locale: string;
  onUpdateField: (id: string, field: EditableBookingField, value: string) => Promise<void>;
  onUpdateStatus: (id: string, status: BookingStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenBooking: (booking: Booking) => void;
  onShowMap: (booking: Booking) => void;
}

type SortColumn =
  | 'booking_number'
  | 'status'
  | 'appointment_date'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'email'
  | 'city'
  | 'address'
  | 'service_mode'
  | 'operating_system'
  | 'payment_status'
  | 'total_amount'
  | 'comments'
  | 'technician_notes';

const STATUS_CLASS: Record<BookingStatus, string> = {
  new: 'bg-red-50 text-red-700',
  pending_payment: 'bg-amber-50 text-amber-800',
  confirmed: 'bg-amber-50 text-amber-800',
  assigned: 'bg-amber-50 text-amber-800',
  on_the_way: 'bg-highlight text-primary',
  in_progress: 'bg-highlight text-primary',
  waiting_for_parts: 'bg-amber-50 text-amber-800',
  waiting_for_customer: 'bg-amber-50 text-amber-800',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
  no_show: 'bg-gray-100 text-gray-600',
  payment_expired: 'bg-gray-100 text-gray-600',
};

function sortValue(booking: Booking, column: SortColumn): string | number {
  if (column === 'appointment_date') return new Date(booking.appointment_start || booking.appointment_date).getTime();
  if (column === 'total_amount') return Number(booking.total_amount ?? 0);
  if (column === 'email') return (booking.email ?? '').toLowerCase();
  if (column === 'service_mode') return (booking.service_mode ?? '').toLowerCase();
  if (column === 'payment_status') return (booking.payment_status ?? '').toLowerCase();
  const value = booking[column as keyof Booking];
  return (value ?? '').toString().toLowerCase();
}

function serviceSummary(booking: Booking, locale: string): string {
  return (booking.booking_services ?? [])
    .map((line) => localized(line.service_name_snapshot, locale))
    .join(', ');
}

function paymentLabel(t: (key: string) => string, status: string | null): string {
  if (!status) return '—';
  const key = `pay_${status}`;
  const translated = t(key);
  return translated === key ? status : translated;
}

function storedFieldText(booking: Booking, field: EditableBookingField): string {
  if (field === 'total_amount') {
    return booking.total_amount == null ? '' : String(booking.total_amount);
  }
  if (field === 'currency') {
    return booking.currency ?? '';
  }
  if (field === 'payment_status') {
    return booking.payment_status ?? '';
  }
  if (field === 'service_mode') {
    return booking.service_mode ?? 'onsite';
  }
  const value = booking[field as keyof Booking];
  if (value == null) return '';
  return String(value);
}

export function BookingTable({
  bookings,
  timeZone,
  scheduleConfig,
  locale,
  onUpdateField,
  onUpdateStatus,
  onDelete,
  onOpenBooking,
  onShowMap,
}: BookingTableProps) {
  const confirm = useConfirm();
  const { t } = useTranslation();
  const [sortColumn, setSortColumn] = useState<SortColumn>('appointment_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<EditableBookingField, string>>>>({});

  const requestDelete = async (bookingId: string) => {
    const ok = await confirm({
      message: t('confirmDelete'),
      confirmLabel: t('delete'),
      variant: 'danger',
    });
    if (!ok) return;
    await onDelete(bookingId);
  };

  const sorted = [...bookings].sort((left, right) => {
    const leftValue = sortValue(left, sortColumn);
    const rightValue = sortValue(right, sortColumn);
    return compareSortValues(leftValue, rightValue, sortDirection);
  });

  const toggleSort = (column: SortColumn) => {
    const next = toggleSortState(sortColumn, column, sortDirection);
    setSortColumn(next.column);
    setSortDirection(next.direction);
  };

  const fieldValue = (booking: Booking, field: EditableBookingField): string => {
    const draft = drafts[booking.id]?.[field];
    if (draft !== undefined) return draft;
    return storedFieldText(booking, field);
  };

  const setDraft = (id: string, field: EditableBookingField, value: string) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  };

  const clearDraft = (id: string, field: EditableBookingField) => {
    setDrafts((current) => {
      const next = { ...current };
      if (!next[id]) return current;
      const row = { ...next[id] };
      delete row[field];
      next[id] = row;
      return next;
    });
  };

  const saveText = async (booking: Booking, field: EditableBookingField) => {
    const draft = drafts[booking.id]?.[field];
    if (draft === undefined) return;
    if (draft === storedFieldText(booking, field)) {
      clearDraft(booking.id, field);
      return;
    }
    if (field === 'address' && !draft.trim()) {
      clearDraft(booking.id, field);
      return;
    }
    await onUpdateField(booking.id, field, draft);
    clearDraft(booking.id, field);
  };

  const commitAppointment = async (booking: Booking, display: string) => {
    const parsed = parseDisplayDateTime(display);
    if (!parsed) return;

    const iso = zonedTimeToUtc(parsed.date, parsed.time, timeZone).toISOString();
    if (
      formatAppointmentInZone(iso, timeZone)
      === formatAppointmentInZone(booking.appointment_start || booking.appointment_date, timeZone)
    ) {
      return;
    }

    await onUpdateField(booking.id, 'appointment_date', iso);
  };

  const headClass = 'px-2 py-2 text-xs uppercase tracking-wider whitespace-nowrap';
  const cellInputClass = 'form-control min-w-[7rem] py-1 text-sm';
  const columnCount = 20;

  return (
    <div className="overflow-hidden rounded-lg bg-surface shadow">
      <div className="table-scroll-pane">
        <table className="table-cols-center w-max min-w-full text-sm">
          <thead>
            <tr>
              <TableHead label="#" className={headClass} />
              <SortableTableHead column="booking_number" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('bookingNumber')} className={headClass} />
              <SortableTableHead column="status" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('status')} className={headClass} />
              <SortableTableHead column="appointment_date" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('appointmentDate')} className={headClass} />
              <SortableTableHead column="first_name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('firstName')} className={headClass} />
              <SortableTableHead column="last_name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('lastName')} className={headClass} />
              <SortableTableHead column="phone" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('phone')} className={headClass} />
              <SortableTableHead column="email" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('email')} className={headClass} />
              <SortableTableHead column="city" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('city')} className={headClass} />
              <SortableTableHead column="address" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('address')} className={headClass} />
              <SortableTableHead column="service_mode" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('step_mode')} className={headClass} />
              <SortableTableHead column="operating_system" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('operatingSystem')} className={headClass} />
              <TableHead label={t('deviceType')} className={headClass} />
              <TableHead label={t('problemDescription')} className={headClass} />
              <TableHead label={t('nav_services')} className={headClass} />
              <SortableTableHead column="payment_status" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('payment')} className={headClass} />
              <SortableTableHead column="total_amount" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('total')} className={headClass} />
              <SortableTableHead column="comments" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('comments')} className={headClass} />
              <SortableTableHead column="technician_notes" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('technicianNotes')} className={headClass} />
              <TableHead label={t('actions')} className={headClass} />
            </tr>
          </thead>
          <tbody className="bg-surface">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-8 text-center text-sm text-muted">{t('noBookings')}</td>
              </tr>
            )}
            {sorted.map((booking, index) => {
              const location = [booking.city, booking.address].filter(Boolean).join(', ');
              return (
                <tr key={booking.id} className={`hover:bg-highlight/50 ${booking.deleted_at ? 'opacity-60' : ''}`}>
                  <td className="px-2 py-2 font-semibold text-ink">{index + 1}</td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      className="font-medium text-primary hover:underline"
                      onClick={() => onOpenBooking(booking)}
                    >
                      {booking.booking_number}
                    </button>
                  </td>
                  <td className="min-w-[8rem] px-2 py-2">
                    <select
                      value={booking.status}
                      onChange={(event) => void onUpdateStatus(booking.id, event.target.value as BookingStatus)}
                      className={`w-full rounded border px-1 py-1 text-xs font-medium ${STATUS_CLASS[booking.status]}`}
                    >
                      {BOOKING_STATUSES.map((status) => (
                        <option key={status} value={status}>{t(`status_${status}`)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="w-[12rem] min-w-[12rem] max-w-[12rem] px-2 py-2 align-middle">
                    <AppointmentDateTimeField
                      layout="popover"
                      value={formatAppointmentInZone(booking.appointment_start || booking.appointment_date, timeZone)}
                      onChange={(display) => void commitAppointment(booking, display)}
                      booking={booking}
                      scheduleConfig={scheduleConfig}
                      timeZone={timeZone}
                    />
                  </td>
                  {(['first_name', 'last_name', 'phone'] as const).map((field) => (
                    <td key={field} className="px-2 py-2">
                      <input
                        type={field === 'phone' ? 'tel' : 'text'}
                        value={fieldValue(booking, field)}
                        onChange={(event) => setDraft(booking.id, field, event.target.value)}
                        onBlur={() => void saveText(booking, field)}
                        className={cellInputClass}
                      />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <input
                      type="email"
                      value={fieldValue(booking, 'email')}
                      onChange={(event) => setDraft(booking.id, 'email', event.target.value)}
                      onBlur={() => void saveText(booking, 'email')}
                      className={cellInputClass}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <input
                      type="text"
                      dir="auto"
                      value={fieldValue(booking, 'city')}
                      onChange={(event) => setDraft(booking.id, 'city', event.target.value)}
                      onBlur={() => void saveText(booking, 'city')}
                      className={`mx-auto text-center ${cellInputClass}`}
                    />
                  </td>
                  <td className="min-w-[10rem] px-2 py-2 text-center">
                    <div className="mx-auto flex max-w-full items-center justify-center gap-1">
                      <input
                        type="text"
                        dir="auto"
                        value={fieldValue(booking, 'address')}
                        onChange={(event) => setDraft(booking.id, 'address', event.target.value)}
                        onBlur={() => void saveText(booking, 'address')}
                        className={`min-w-[8rem] max-w-[14rem] text-center ${cellInputClass}`}
                      />
                      {location ? (
                        <button
                          type="button"
                          className="inline-flex shrink-0 rounded-lg p-1.5 text-primary hover:bg-highlight"
                          aria-label={t('map_show_booking')}
                          title={t('map_show_booking')}
                          onClick={() => onShowMap(booking)}
                        >
                          <MapPin className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={fieldValue(booking, 'service_mode')}
                      onChange={(event) => void onUpdateField(booking.id, 'service_mode', event.target.value)}
                      className={cellInputClass}
                    >
                      {SERVICE_MODES.map((mode) => (
                        <option key={mode} value={mode}>{t(`mode_${mode}`)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2">
                    <select
                      value={booking.operating_system}
                      onChange={(event) => void onUpdateField(booking.id, 'operating_system', event.target.value)}
                      className={cellInputClass}
                    >
                      {OPERATING_SYSTEMS.map((os) => (
                        <option key={os} value={os}>{t(`os_${os}`)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="max-w-[12rem] px-2 py-2 align-top">
                    <div className="flex min-w-[8rem] flex-col gap-1">
                      <select
                        value={fieldValue(booking, 'device_type')}
                        onChange={(event) => void onUpdateField(booking.id, 'device_type', event.target.value)}
                        className={cellInputClass}
                      >
                        <option value="">—</option>
                        {DEVICE_TYPES.map((device) => (
                          <option key={device} value={device}>{t(`device_${device}`)}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        value={fieldValue(booking, 'device_brand')}
                        onChange={(event) => setDraft(booking.id, 'device_brand', event.target.value)}
                        onBlur={() => void saveText(booking, 'device_brand')}
                        placeholder={t('deviceBrand')}
                        className={cellInputClass}
                      />
                      <input
                        type="text"
                        value={fieldValue(booking, 'device_model')}
                        onChange={(event) => setDraft(booking.id, 'device_model', event.target.value)}
                        onBlur={() => void saveText(booking, 'device_model')}
                        placeholder={t('deviceModel')}
                        className={cellInputClass}
                      />
                    </div>
                  </td>
                  <td className="max-w-[12rem] px-2 py-2 align-top">
                    <textarea
                      value={fieldValue(booking, 'problem_description')}
                      onChange={(event) => setDraft(booking.id, 'problem_description', event.target.value)}
                      onBlur={() => void saveText(booking, 'problem_description')}
                      rows={2}
                      dir="auto"
                      className={`min-w-[8rem] ${cellInputClass}`}
                    />
                  </td>
                  <td className="max-w-[14rem] px-2 py-2 text-xs text-ink">{serviceSummary(booking, locale) || '—'}</td>
                  <td className="px-2 py-2">
                    <select
                      value={fieldValue(booking, 'payment_status')}
                      onChange={(event) => void onUpdateField(booking.id, 'payment_status', event.target.value)}
                      className={cellInputClass}
                    >
                      <option value="">—</option>
                      {PAYMENT_STATUSES.map((status) => (
                        <option key={status} value={status}>{paymentLabel(t, status)}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-2 py-2 align-top">
                    <div className="flex min-w-[7rem] flex-col gap-1">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={fieldValue(booking, 'total_amount')}
                        onChange={(event) => setDraft(booking.id, 'total_amount', event.target.value)}
                        onBlur={() => void saveText(booking, 'total_amount')}
                        className={cellInputClass}
                      />
                      <input
                        type="text"
                        maxLength={3}
                        value={fieldValue(booking, 'currency')}
                        onChange={(event) => setDraft(booking.id, 'currency', event.target.value.toUpperCase())}
                        onBlur={() => void saveText(booking, 'currency')}
                        placeholder="ILS"
                        className={cellInputClass}
                      />
                      {booking.total_amount != null ? (
                        <span className="text-xs text-muted">
                          {formatMoney(Number(booking.total_amount), booking.currency || 'ILS', locale)}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      value={fieldValue(booking, 'comments')}
                      onChange={(event) => setDraft(booking.id, 'comments', event.target.value)}
                      onBlur={() => void saveText(booking, 'comments')}
                      rows={2}
                      className={`min-w-[8rem] ${cellInputClass}`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      value={fieldValue(booking, 'technician_notes')}
                      onChange={(event) => setDraft(booking.id, 'technician_notes', event.target.value)}
                      onBlur={() => void saveText(booking, 'technician_notes')}
                      rows={2}
                      placeholder={t('addNote')}
                      className={`min-w-[8rem] ${cellInputClass}`}
                    />
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => void requestDelete(booking.id)}
                      className="inline-flex items-center justify-center rounded-lg p-1.5 text-danger hover:bg-highlight"
                      title={t('delete')}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
