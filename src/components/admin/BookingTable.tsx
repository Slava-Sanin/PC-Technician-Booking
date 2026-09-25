import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2 } from 'lucide-react';
import { compareSortValues, SortableTableHead, TableHead, toggleSortState } from './sortableTableHead';
import { BOOKING_STATUSES, type Booking, type BookingStatus, type EditableBookingField } from '../../types/booking';
import { formatAppointmentInZone, parseDisplayDateTime, zonedTimeToUtc } from '../../utils/dateTime';

interface BookingTableProps {
  bookings: Booking[];
  timeZone: string;
  onUpdateField: (id: string, field: EditableBookingField, value: string) => Promise<void>;
  onUpdateStatus: (id: string, status: BookingStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type SortColumn =
  | 'booking_number'
  | 'status'
  | 'appointment_date'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'city'
  | 'address'
  | 'operating_system'
  | 'comments'
  | 'technician_notes';

const STATUS_CLASS: Record<BookingStatus, string> = {
  new: 'bg-red-50 text-red-700',
  pending_payment: 'bg-amber-50 text-amber-800',
  confirmed: 'bg-amber-50 text-amber-800',
  assigned: 'bg-amber-50 text-amber-800',
  on_the_way: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-blue-50 text-blue-700',
  waiting_for_parts: 'bg-amber-50 text-amber-800',
  waiting_for_customer: 'bg-amber-50 text-amber-800',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
  no_show: 'bg-gray-100 text-gray-600',
  payment_expired: 'bg-gray-100 text-gray-600',
};

function sortValue(booking: Booking, column: SortColumn): string | number {
  if (column === 'appointment_date') return new Date(booking.appointment_date).getTime();
  const value = booking[column];
  return (value ?? '').toString().toLowerCase();
}

export function BookingTable({ bookings, timeZone, onUpdateField, onUpdateStatus, onDelete }: BookingTableProps) {
  const { t } = useTranslation();
  const [sortColumn, setSortColumn] = useState<SortColumn>('appointment_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<EditableBookingField, string>>>>({});
  const [appointmentDrafts, setAppointmentDrafts] = useState<Record<string, string>>({});

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
    const value = booking[field];
    return value ?? '';
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
    const original = booking[field] ?? '';
    if (draft === original || (field === 'city' && draft === '' && booking.city === null)) {
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

  const saveAppointment = async (booking: Booking) => {
    const draft = appointmentDrafts[booking.id];
    if (draft === undefined) return;
    const parsed = parseDisplayDateTime(draft);
    if (!parsed) {
      setAppointmentDrafts((current) => {
        const next = { ...current };
        delete next[booking.id];
        return next;
      });
      return;
    }

    const iso = zonedTimeToUtc(parsed.date, parsed.time, timeZone).toISOString();
    if (formatAppointmentInZone(iso, timeZone) === formatAppointmentInZone(booking.appointment_date, timeZone)) {
      setAppointmentDrafts((current) => {
        const next = { ...current };
        delete next[booking.id];
        return next;
      });
      return;
    }

    await onUpdateField(booking.id, 'appointment_date', iso);
    setAppointmentDrafts((current) => {
      const next = { ...current };
      delete next[booking.id];
      return next;
    });
  };

  const headClass = 'px-1 py-1 text-xs uppercase tracking-wider hover:bg-slate-200/60';

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table-cols-center w-full">
          <thead>
            <tr>
              <TableHead label="#" className={headClass} />
              <SortableTableHead column="booking_number" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('bookingNumber')} className={headClass} />
              <SortableTableHead column="status" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('status')} className={headClass} />
              <SortableTableHead column="appointment_date" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('appointmentDate')} className={headClass} />
              <SortableTableHead column="first_name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('firstName')} className={headClass} />
              <SortableTableHead column="last_name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('lastName')} className={headClass} />
              <SortableTableHead column="phone" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('phone')} className={`${headClass} w-32`} />
              <SortableTableHead column="city" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('city')} className={headClass} />
              <SortableTableHead column="address" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('address')} className={headClass} />
              <SortableTableHead column="operating_system" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('operatingSystem')} className={headClass} />
              <SortableTableHead column="comments" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('comments')} className={headClass} />
              <SortableTableHead column="technician_notes" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('technicianNotes')} className={headClass} />
              <TableHead label={t('actions')} className={headClass} />
            </tr>
          </thead>
          <tbody className="bg-white">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-sm text-gray-500">{t('noBookings')}</td>
              </tr>
            )}
            {sorted.map((booking, index) => (
              <tr key={booking.id} className={`hover:bg-gray-50 ${booking.deleted_at ? 'opacity-60' : ''}`}>
                <td className="px-1 py-1 text-sm text-gray-800 font-semibold">{index + 1}</td>
                <td className="px-1 py-1 text-sm text-gray-800 font-medium">{booking.booking_number}</td>
                <td className="px-1 py-1">
                  <select
                    value={booking.status}
                    onChange={(event) => void onUpdateStatus(booking.id, event.target.value as BookingStatus)}
                    className={`text-xs font-medium border rounded px-1 py-1 w-full ${STATUS_CLASS[booking.status]}`}
                  >
                    {BOOKING_STATUSES.map((status) => (
                      <option key={status} value={status}>{t(`status_${status}`)}</option>
                    ))}
                  </select>
                </td>
                <td className="px-1 py-1">
                  <input
                    type="text"
                    value={appointmentDrafts[booking.id] ?? formatAppointmentInZone(booking.appointment_date, timeZone)}
                    onChange={(event) => setAppointmentDrafts((current) => ({ ...current, [booking.id]: event.target.value }))}
                    onBlur={() => void saveAppointment(booking)}
                    placeholder="dd/mm/yyyy HH:mm"
                    className="text-sm border rounded px-1 py-1 w-full text-gray-800"
                  />
                </td>
                {(['first_name', 'last_name', 'phone', 'city', 'address'] as const).map((field) => (
                  <td key={field} className="px-1 py-1">
                    <input
                      type={field === 'phone' ? 'tel' : 'text'}
                      value={fieldValue(booking, field)}
                      onChange={(event) => setDraft(booking.id, field, event.target.value)}
                      onBlur={() => void saveText(booking, field)}
                      className="text-sm border rounded px-1 py-1 w-full text-gray-800"
                    />
                  </td>
                ))}
                <td className="px-1 py-1">
                  <select
                    value={booking.operating_system}
                    onChange={(event) => void onUpdateField(booking.id, 'operating_system', event.target.value)}
                    className="text-sm border rounded px-1 py-1 w-full text-gray-800"
                  >
                    <option value="windows">{t('windows')}</option>
                    <option value="linux">{t('linux')}</option>
                    <option value="macos">{t('macos')}</option>
                  </select>
                </td>
                <td className="px-1 py-1">
                  <textarea
                    value={fieldValue(booking, 'comments')}
                    onChange={(event) => setDraft(booking.id, 'comments', event.target.value)}
                    onBlur={() => void saveText(booking, 'comments')}
                    rows={2}
                    className="text-sm border rounded px-1 py-1 w-full text-gray-800"
                  />
                </td>
                <td className="px-1 py-1">
                  <textarea
                    value={fieldValue(booking, 'technician_notes')}
                    onChange={(event) => setDraft(booking.id, 'technician_notes', event.target.value)}
                    onBlur={() => void saveText(booking, 'technician_notes')}
                    rows={2}
                    placeholder={t('addNote')}
                    className="text-sm border rounded px-1 py-1 w-full text-gray-800"
                  />
                </td>
                <td className="px-1 py-1">
                  <button
                    type="button"
                    onClick={() => void onDelete(booking.id)}
                    className="inline-flex items-center justify-center px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
                    title={t('delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
