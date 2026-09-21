import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, Trash2 } from 'lucide-react';
import { BOOKING_STATUSES, type Booking, type BookingStatus, type EditableBookingField } from '../../types/booking';
import { formatAppointmentInZone, parseDisplayDateTime, zonedTimeToUtc } from '../../utils/dateTime';

interface BookingTableProps {
  bookings: Booking[];
  timeZone: string;
  onUpdateField: (id: string, field: EditableBookingField, value: string) => Promise<void>;
  onUpdateStatus: (id: string, status: BookingStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

type SortColumn = 'booking_number' | 'status' | 'appointment_date' | 'first_name' | 'last_name' | 'phone' | 'city' | 'address' | 'operating_system';

const STATUS_CLASS: Record<BookingStatus, string> = {
  new: 'bg-red-50 text-red-700',
  confirmed: 'bg-amber-50 text-amber-800',
  assigned: 'bg-amber-50 text-amber-800',
  on_the_way: 'bg-blue-50 text-blue-700',
  in_progress: 'bg-blue-50 text-blue-700',
  completed: 'bg-green-50 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
  no_show: 'bg-gray-100 text-gray-600',
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
    if (leftValue < rightValue) return sortDirection === 'asc' ? -1 : 1;
    if (leftValue > rightValue) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  const toggleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection('asc');
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

  const header = (column: SortColumn, label: string, className = '') => (
    <th
      scope="col"
      onClick={() => toggleSort(column)}
      className={`px-1 py-1 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 ${className}`}
    >
      <div className="flex items-center justify-center gap-1">
        {label}
        {sortColumn === column ? (
          sortDirection === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-30" />
        )}
      </div>
    </th>
  );

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-1 py-1 text-center text-xs font-semibold text-gray-700">#</th>
              {header('booking_number', t('bookingNumber'))}
              {header('status', t('status'))}
              {header('appointment_date', t('appointmentDate'))}
              {header('first_name', t('firstName'))}
              {header('last_name', t('lastName'))}
              {header('phone', t('phone'), 'w-32')}
              {header('city', t('city'))}
              {header('address', t('address'))}
              {header('operating_system', t('operatingSystem'))}
              <th className="px-1 py-1 text-center text-xs font-semibold text-gray-700">{t('comments')}</th>
              <th className="px-1 py-1 text-center text-xs font-semibold text-gray-700">{t('technicianNotes')}</th>
              <th className="px-1 py-1 text-center text-xs font-semibold text-gray-700">{t('actions')}</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sorted.length === 0 && (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-sm text-gray-500">{t('noBookings')}</td>
              </tr>
            )}
            {sorted.map((booking, index) => (
              <tr key={booking.id} className={`hover:bg-gray-50 ${booking.deleted_at ? 'opacity-60' : ''}`}>
                <td className="px-1 py-1 text-sm text-center text-gray-800 font-semibold">{index + 1}</td>
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
                <td className="px-1 py-1 text-center">
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
