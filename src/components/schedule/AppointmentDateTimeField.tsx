import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAvailability, useMonthAvailability } from '../../hooks/useAvailability';
import type { AvailabilityQuery } from '../../types/api';
import type { Booking } from '../../types/booking';
import type { PublicBookingConfig } from '../../types/bookingSettings';
import type { ServiceMode } from '../../types/catalog';
import {
  BUSINESS_TIME_ZONE,
  calendarDateFromISO,
  formatAppointmentInZone,
  monthKeyFromDate,
  parseDisplayDateTime,
  todayISOInTimeZone,
  zonedTimeToUtc,
} from '../../utils/dateTime';
import { formatDurationMinutes } from '../../utils/pricing';
import { EmptyState, Input, Skeleton } from '../ui';
import { MonthGrid } from './MonthGrid';

function bookingServiceIds(booking: Booking): string[] {
  return (booking.booking_services ?? [])
    .map((line) => line.service_id)
    .filter((id): id is string => Boolean(id));
}

function bookingDurationMinutes(booking: Booking): number {
  return (booking.booking_services ?? []).reduce((sum, line) => sum + line.duration_minutes * line.quantity, 0);
}

export function AppointmentDateTimeField({
  value,
  onChange,
  booking,
  scheduleConfig,
  timeZone = BUSINESS_TIME_ZONE,
}: {
  value: string;
  onChange: (display: string) => void;
  booking: Booking;
  scheduleConfig: PublicBookingConfig | null;
  timeZone?: string;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const serviceIds = useMemo(() => bookingServiceIds(booking), [booking]);
  const serviceMode = (booking.service_mode ?? 'onsite') as ServiceMode;
  const availabilityQuery = useMemo<AvailabilityQuery | null>(
    () => (serviceIds.length > 0 ? { serviceIds, serviceMode } : null),
    [serviceIds, serviceMode],
  );

  const parsedValue = useMemo(() => parseDisplayDateTime(value), [value]);
  const initialDate = parsedValue?.date ?? todayISOInTimeZone(scheduleConfig?.timezone || timeZone);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [visibleMonth, setVisibleMonth] = useState(() => calendarDateFromISO(initialDate));

  useEffect(() => {
    if (!open) return;
    const parsed = parseDisplayDateTime(value);
    const date = parsed?.date ?? todayISOInTimeZone(scheduleConfig?.timezone || timeZone);
    setSelectedDate(date);
    setVisibleMonth(calendarDateFromISO(date));
  }, [open, scheduleConfig?.timezone, timeZone, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const availability = useAvailability(open ? selectedDate : null, open ? availabilityQuery : null);
  const monthAvailability = useMonthAvailability(
    open && availabilityQuery ? monthKeyFromDate(visibleMonth) : null,
    open ? availabilityQuery : null,
  );

  const today = todayISOInTimeZone(scheduleConfig?.timezone || timeZone);
  const dateDisabled = (iso: string) => {
    if (!scheduleConfig) return iso < today;
    if (iso < today) return true;
    const weekday = calendarDateFromISO(iso).getDay();
    if (scheduleConfig.disabledWeekdays.includes(weekday)) return true;
    if (scheduleConfig.disabledDates.includes(iso)) return true;
    const slots = monthAvailability.days[iso];
    return Array.isArray(slots) && slots.length === 0;
  };

  const slots = useMemo(() => {
    const base = availability.slots;
    if (!parsedValue || parsedValue.date !== selectedDate || base.includes(parsedValue.time)) return base;
    return [...base, parsedValue.time].sort();
  }, [availability.slots, parsedValue, selectedDate]);

  const durationMinutes = availability.durationMinutes || bookingDurationMinutes(booking);
  const pickerReady = Boolean(availabilityQuery);

  const pickSlot = (time: string) => {
    const iso = zonedTimeToUtc(selectedDate, time, timeZone).toISOString();
    onChange(formatAppointmentInZone(iso, timeZone));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="flex gap-1">
        <button
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-primary transition hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={t('step_schedule')}
          aria-expanded={open}
          disabled={!pickerReady}
          onClick={() => setOpen((current) => !current)}
        >
          <CalendarDays className="h-5 w-5" aria-hidden="true" />
        </button>
        <Input readOnly value={value} className="min-w-0 flex-1" aria-readonly="true" />
      </div>
      {open ? (
        <div className="mt-2 rounded-xl border border-line bg-canvas p-3">
          {!pickerReady ? (
            <EmptyState title={t('noAvailableSlots')} />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              <MonthGrid
                month={visibleMonth}
                selected={selectedDate}
                disabled={dateDisabled}
                locale={locale}
                onMonth={setVisibleMonth}
                onSelect={(iso) => setSelectedDate(iso)}
              />
              <div>
                <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  {t('duration')}: {formatDurationMinutes(durationMinutes, { minutesShort: t('minutesShort'), hoursShort: t('hoursShort') })}
                </p>
                {availability.loading ? <Skeleton className="h-24" /> : null}
                {!availability.loading && slots.length === 0 ? <EmptyState title={t('noAvailableSlots')} /> : null}
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                  {slots.map((slot) => {
                    const selected = parsedValue?.date === selectedDate && parsedValue.time === slot;
                    return (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => pickSlot(slot)}
                        className={`rounded-md border px-1.5 py-1.5 text-xs font-semibold ${selected ? 'border-primary bg-primary text-white' : 'border-line hover:border-primary/40'}`}
                      >
                        {slot}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
