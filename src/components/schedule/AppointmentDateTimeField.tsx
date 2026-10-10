import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

type AppointmentDateTimeLayout = 'inline' | 'popover';

export function AppointmentDateTimeField({
  value,
  onChange,
  booking,
  scheduleConfig,
  timeZone = BUSINESS_TIME_ZONE,
  layout = 'inline',
}: {
  value: string;
  onChange: (display: string) => void;
  booking: Booking;
  scheduleConfig: PublicBookingConfig | null;
  timeZone?: string;
  layout?: AppointmentDateTimeLayout;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);
  const isPopover = layout === 'popover';

  const updateAnchor = useCallback(() => {
    const element = rootRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setAnchor({ left: rect.left, top: rect.top, width: rect.width });
  }, []);

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
    updateAnchor();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onReposition = () => updateAnchor();
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, updateAnchor]);

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

  const triggerButtonClass = isPopover
    ? 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-primary transition hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-50'
    : 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-primary transition hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-50';

  const triggerInputClass = isPopover
    ? 'h-8 min-h-0 min-w-0 flex-1 py-1 text-xs'
    : 'min-w-0 flex-1';

  const pickerPanel = open ? (
    <div
      ref={popoverRef}
      className={`rounded-xl border border-line bg-canvas p-3 shadow-card ${isPopover ? 'w-[min(36rem,calc(100vw-1.5rem))]' : 'mt-2'}`}
      style={
        isPopover && anchor
          ? {
              position: 'fixed',
              left: anchor.left,
              top: anchor.top - 8,
              transform: 'translateY(-100%)',
              zIndex: 60,
            }
          : undefined
      }
    >
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
  ) : null;

  return (
    <div
      ref={rootRef}
      className={
        isPopover
          ? 'mx-auto flex h-8 w-[11rem] max-w-full items-center gap-1'
          : 'relative flex gap-1'
      }
    >
      <button
        type="button"
        className={triggerButtonClass}
        aria-label={t('step_schedule')}
        aria-expanded={open}
        disabled={!pickerReady}
        onClick={() => setOpen((current) => !current)}
      >
        <CalendarDays className={isPopover ? 'h-4 w-4' : 'h-5 w-5'} aria-hidden="true" />
      </button>
      <Input readOnly value={value} className={triggerInputClass} aria-readonly="true" />
      {isPopover && pickerPanel ? createPortal(pickerPanel, document.body) : null}
      {!isPopover ? pickerPanel : null}
    </div>
  );
}
