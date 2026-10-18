import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useAvailability, useMonthAvailability } from '../../hooks/useAvailability';
import { updateCustomerBooking } from '../../services/customerService';
import type { AvailabilityQuery } from '../../types/api';
import type { Booking, CustomerBookingEditRequest, CustomerBookingEditResult } from '../../types/booking';
import type { PublicBookingConfig } from '../../types/bookingSettings';
import type { DeviceType, PublicCategory, PublicService, ServiceMode } from '../../types/catalog';
import { DEVICE_TYPES, OPERATING_SYSTEMS, localized } from '../../types/catalog';
import { allowedModes, paymentStepMode } from '../../utils/catalogRules';
import { netPaidAmount, paymentAdjustment, pendingAdjustments } from '../../utils/customerEdit';
import {
  BUSINESS_TIME_ZONE,
  calendarDateFromISO,
  formatISODateToDisplay,
  getZonedParts,
  monthKeyFromDate,
  todayISOInTimeZone,
} from '../../utils/dateTime';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { bookingTotal, formatDurationMinutes, formatMoney, lineTotal, sumDuration } from '../../utils/pricing';
import { getBookingValidationIssue } from '../../utils/validation';
import { MonthGrid } from '../schedule/MonthGrid';
import { Alert, Button, EmptyState, Field, Input, Select, Skeleton, Textarea } from '../ui';
import { useConfirm } from '../ui/ConfirmProvider';

function ServicePrice({ service, locale }: { service: PublicService; locale: string }) {
  const { t } = useTranslation();
  if (service.priceType === 'quote') return <>{t('priceQuote')}</>;
  if (service.priceType === 'diagnostic') return <>{t('priceDiagnostic')}</>;
  if (service.price == null) return <>{t('priceQuote')}</>;
  const money = formatMoney(service.price, service.currency, locale);
  if (service.priceType === 'from') return <>{t('priceFrom', { price: money })}</>;
  if (service.priceType === 'hourly') return <>{t('priceHourly', { price: money })}</>;
  return <>{money}</>;
}

function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sorted = [...right].sort();
  return [...left].sort().every((id, index) => id === sorted[index]);
}

function asAmount(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function CustomerBookingEditForm({
  booking,
  categories,
  config,
  onSaved,
  onCancel,
}: {
  booking: Booking;
  categories: PublicCategory[];
  config: PublicBookingConfig;
  onSaved: (booking: Booking, result: CustomerBookingEditResult) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const locale = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];
  const timezone = config.timezone || BUSINESS_TIME_ZONE;

  const initialServiceIds = useMemo(
    () => (booking.booking_services ?? []).map((line) => line.service_id).filter((id): id is string => Boolean(id)),
    [booking.booking_services],
  );
  const initialSchedule = useMemo(() => {
    const parts = getZonedParts(new Date(booking.appointment_start ?? booking.appointment_date), timezone);
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
  }, [booking.appointment_start, booking.appointment_date, timezone]);

  const [selectedIds, setSelectedIds] = useState<string[]>(initialServiceIds);
  const [mode, setMode] = useState<ServiceMode | ''>(booking.service_mode ?? '');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>((booking.device_type as DeviceType | null) ?? '');
  const [operatingSystem, setOperatingSystem] = useState(booking.operating_system ?? '');
  const [deviceBrand, setDeviceBrand] = useState(booking.device_brand ?? '');
  const [deviceModel, setDeviceModel] = useState(booking.device_model ?? '');
  const [problem, setProblem] = useState(booking.problem_description ?? '');
  const [firstName, setFirstName] = useState(booking.first_name);
  const [lastName, setLastName] = useState(booking.last_name);
  const [phone, setPhone] = useState(booking.phone);
  const [email, setEmail] = useState(booking.email ?? '');
  const [city, setCity] = useState(booking.city ?? '');
  const [address, setAddress] = useState(booking.address);
  const [comments, setComments] = useState(booking.comments ?? '');
  const [date, setDate] = useState(initialSchedule.date);
  const [time, setTime] = useState(initialSchedule.time);
  const [visibleMonth, setVisibleMonth] = useState(() => calendarDateFromISO(initialSchedule.date));
  const [saving, setSaving] = useState(false);

  const services = useMemo(() => categories.flatMap((category) => category.services), [categories]);
  const selected = useMemo(
    () => selectedIds
      .map((id) => services.find((service) => service.id === id))
      .filter((service): service is PublicService => Boolean(service)),
    [selectedIds, services],
  );
  const modes = useMemo(() => allowedModes(selected), [selected]);
  const requiresDevice = selected.some((service) => service.requiresDevice);
  const requiresOs = selected.some((service) => service.requiresOperatingSystem);
  const servicesChanged = !sameIdSet(selectedIds, initialServiceIds);
  const duration = servicesChanged
    ? sumDuration(selected)
    : sumDuration((booking.booking_services ?? []).map((line) => ({ durationMinutes: line.duration_minutes })));
  const oldTotal = asAmount(booking.total_amount);
  const catalogTotal = bookingTotal(selected.map((service) => ({
    total: lineTotal(service.priceType, service.price, service.durationMinutes),
  })));
  // Same services keep the agreed price; a changed set is re-priced from the catalog (as the server does).
  const newTotal = servicesChanged ? catalogTotal : oldTotal;
  const currency = selected[0]?.currency ?? booking.currency ?? 'ILS';
  const netPaid = netPaidAmount(booking.payments);
  const pending = pendingAdjustments(booking.payments);
  const adjustment = servicesChanged && newTotal !== oldTotal
    ? paymentAdjustment(netPaid, newTotal)
    : { kind: 'none' as const, amount: 0 };
  const holdAmountChanges = booking.status === 'pending_payment' && servicesChanged && newTotal !== oldTotal;
  const needsPrepaymentBlocked = servicesChanged
    && paymentStepMode(selected.map((service) => service.paymentPolicy)) === 'required'
    && netPaid <= 0
    && booking.status !== 'pending_payment';

  const availabilityQuery = useMemo<AvailabilityQuery | null>(() => (
    mode && selectedIds.length > 0
      ? { serviceIds: selectedIds, serviceMode: mode, excludeBookingId: booking.id }
      : null
  ), [booking.id, mode, selectedIds]);
  const availability = useAvailability(date || null, availabilityQuery);
  const monthAvailability = useMonthAvailability(monthKeyFromDate(visibleMonth), availabilityQuery);

  useEffect(() => {
    if (mode && modes.length > 0 && !modes.includes(mode)) setMode('');
  }, [mode, modes]);

  useEffect(() => {
    if (!time || availability.loading || availability.slots.length === 0) return;
    if (!availability.slots.includes(time)) setTime('');
  }, [availability.loading, availability.slots, time]);

  const today = todayISOInTimeZone(timezone);
  const dateDisabled = (iso: string) => {
    if (iso < today) return true;
    const weekday = calendarDateFromISO(iso).getDay();
    if (config.disabledWeekdays.includes(weekday)) return true;
    if (config.disabledDates.includes(iso)) return true;
    const slots = monthAvailability.days[iso];
    return Array.isArray(slots) && slots.length === 0;
  };

  const toggleService = (id: string) => {
    setSelectedIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
    setTime('');
  };

  const money = (amount: number) => formatMoney(amount, currency, locale);
  const durationLabel = formatDurationMinutes(availability.durationMinutes || duration, {
    minutesShort: t('minutesShort'),
    hoursShort: t('hoursShort'),
  });

  const buildRequest = (): CustomerBookingEditRequest | null => {
    if (!mode) return null;
    return {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone: phone.trim(),
      email: email.trim(),
      address: address.trim(),
      city: city.trim(),
      serviceMode: mode,
      deviceType,
      operatingSystem: operatingSystem || 'not_applicable',
      deviceBrand: deviceBrand.trim(),
      deviceModel: deviceModel.trim(),
      problemDescription: problem.trim(),
      comments: comments.trim(),
      appointmentDate: date,
      appointmentTime: time,
      serviceIds: selectedIds,
    };
  };

  const canSave = Boolean(
    selected.length > 0
    && mode
    && (!requiresDevice || deviceType)
    && (!requiresOs || (operatingSystem && operatingSystem !== 'not_applicable'))
    && firstName.trim() && lastName.trim() && phone.trim() && address.trim()
    && date && time
    && !needsPrepaymentBlocked
    && !saving,
  );

  const save = async () => {
    const request = buildRequest();
    if (!request) return;
    const issue = getBookingValidationIssue(
      { ...request, paymentMethodCode: '', locale: locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ru' },
      { requiresAddress: true, requiresCity: false, requiresDevice, requiresOperatingSystem: requiresOs },
    );
    if (issue) {
      toast.error(t('error_INVALID_INPUT'));
      return;
    }

    const lines = [t('customerEditConfirmMessage')];
    if (holdAmountChanges) {
      lines.push(t('customerEditConfirmHoldAmount', { amount: newTotal == null ? t('priceQuote') : money(newTotal) }));
    } else if (adjustment.kind === 'refund') {
      lines.push(t('customerEditConfirmRefund', { amount: money(adjustment.amount) }));
    } else if (adjustment.kind === 'extra') {
      lines.push(t('customerEditConfirmExtra', { amount: money(adjustment.amount) }));
    } else if (adjustment.kind === 'prepaid') {
      lines.push(t('customerEditConfirmPrepaid', { amount: money(netPaid) }));
    }

    const ok = await confirm({
      title: t('customerEditConfirmTitle'),
      message: lines.join(' '),
      confirmLabel: t('save'),
    });
    if (!ok) return;

    setSaving(true);
    try {
      const { booking: updated, result } = await updateCustomerBooking(booking.id, request);
      if (!result.changed) {
        toast(t('customerEditNoChanges'));
      } else {
        const refund = asAmount(result.refundAmount) ?? 0;
        const extra = asAmount(result.extraAmount) ?? 0;
        const resultCurrency = result.currency ?? currency;
        if (refund > 0) {
          toast.success(t('customerEditSavedRefund', { amount: formatMoney(refund, resultCurrency, locale) }));
        } else if (extra > 0) {
          toast.success(t('customerEditSavedExtra', { amount: formatMoney(extra, resultCurrency, locale) }));
        } else {
          toast.success(t('customerEditSaved'));
        }
      }
      onSaved(updated, result);
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
      if (code === 'PAYMENT_REQUIRED') {
        toast.error(t('customerEditPrepaidRequiredHint'));
      } else {
        toast.error(t(errorI18nKey(code)));
      }
      if (code === 'SLOT_UNAVAILABLE' || code === 'DAILY_LIMIT_REACHED') {
        await Promise.all([availability.refresh(), monthAvailability.refresh()]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Alert tone="warning">{t('customerEditOncePerDayHint')}</Alert>

      <Section title={t('step_services')}>
        <div className="space-y-3">
          {categories.map((category) => (
            <div key={category.id} className="rounded-xl border border-line">
              <p className="border-b border-highlightLine bg-highlight px-3 py-1.5 text-xs font-semibold text-ink">
                {localized(category.name, locale)}
              </p>
              <div className="grid gap-1.5 p-2">
                {category.services.map((service) => {
                  const checked = selectedIds.includes(service.id);
                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => toggleService(service.id)}
                      aria-pressed={checked}
                      className={`flex min-w-0 items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-start ${checked ? 'border-primary bg-highlight' : 'border-line hover:border-primary/40'}`}
                    >
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-semibold leading-tight">{localized(service.name, locale)}</span>
                        <span className="text-xs text-muted">
                          {formatDurationMinutes(service.durationMinutes, { minutesShort: t('minutesShort'), hoursShort: t('hoursShort') })}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-ink"><ServicePrice service={service} locale={locale} /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {selected.length === 0 ? <p className="text-sm text-danger">{t('noneSelected')}</p> : null}
          {needsPrepaymentBlocked ? <Alert tone="danger">{t('customerEditPrepaidRequiredHint')}</Alert> : null}
        </div>
      </Section>

      <Section title={t('step_mode')}>
        {modes.length === 0 ? <EmptyState title={t('noCommonMode')} /> : (
          <div className="grid gap-2 sm:grid-cols-3">
            {modes.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => { setMode(item); setTime(''); }}
                className={`rounded-xl border p-2.5 text-start text-sm font-semibold ${mode === item ? 'border-primary bg-highlight' : 'border-line'}`}
              >
                {t(`mode_${item}`)}
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title={t('step_device')}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t('deviceType')} required={requiresDevice}>
            <Select value={deviceType} onChange={(event) => setDeviceType(event.target.value as DeviceType | '')}>
              <option value="">{t('selectPlaceholder')}</option>
              {DEVICE_TYPES.map((item) => <option key={item} value={item}>{t(`device_${item}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('operatingSystem')} required={requiresOs}>
            <Select value={operatingSystem} onChange={(event) => setOperatingSystem(event.target.value)}>
              <option value="">{t('selectPlaceholder')}</option>
              {OPERATING_SYSTEMS.map((item) => <option key={item} value={item}>{t(`os_${item}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('deviceBrand')}><Input value={deviceBrand} maxLength={80} onChange={(event) => setDeviceBrand(event.target.value)} /></Field>
          <Field label={t('deviceModel')}><Input value={deviceModel} maxLength={80} onChange={(event) => setDeviceModel(event.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label={t('problemDescription')}>
              <Textarea rows={3} className="min-h-20" value={problem} maxLength={2000} onChange={(event) => setProblem(event.target.value)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title={t('step_details')}>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label={t('firstName')} required><Input value={firstName} maxLength={80} onChange={(event) => setFirstName(event.target.value)} /></Field>
          <Field label={t('lastName')} required><Input value={lastName} maxLength={80} onChange={(event) => setLastName(event.target.value)} /></Field>
          <Field label={t('phone')} required><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
          <Field label={t('email')}><Input type="email" value={email} maxLength={120} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field label={t('city')}><Input value={city} maxLength={80} onChange={(event) => setCity(event.target.value)} /></Field>
          <Field label={t('address')} required><Input value={address} maxLength={200} onChange={(event) => setAddress(event.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label={t('comments')}>
              <Textarea rows={3} className="min-h-20" value={comments} maxLength={1000} onChange={(event) => setComments(event.target.value)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title={t('step_schedule')}>
        <div className="grid gap-3 md:grid-cols-2">
          <MonthGrid
            month={visibleMonth}
            selected={date}
            disabled={dateDisabled}
            locale={locale}
            onMonth={setVisibleMonth}
            onSelect={(iso) => { setDate(iso); setTime(''); }}
          />
          <div>
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              {t('duration')}: {durationLabel}
            </p>
            {!availabilityQuery ? <p className="text-sm text-muted">{t('noneSelected')}</p> : null}
            {availability.loading ? <Skeleton className="h-24" /> : null}
            {availabilityQuery && !availability.loading && availability.slots.length === 0 ? <EmptyState title={t('noAvailableSlots')} /> : null}
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
              {availability.slots.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  onClick={() => setTime(slot)}
                  className={`rounded-md border px-1.5 py-1.5 text-xs font-semibold ${time === slot ? 'border-primary bg-primary text-white' : 'border-line'}`}
                >
                  {slot}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {date ? formatISODateToDisplay(date) : '—'} {time || ''}
            </p>
          </div>
        </div>
      </Section>

      <Section title={t('total')}>
        <dl className="space-y-1 text-sm">
          <Row label={t('customerEditPriceOld')} value={oldTotal == null ? t('priceQuote') : formatMoney(oldTotal, booking.currency ?? currency, locale)} />
          <Row
            label={t('customerEditPriceNew')}
            value={newTotal == null ? t('priceQuote') : money(newTotal)}
            highlight
          />
          {netPaid > 0 ? <Row label={t('customerPaid')} value={money(netPaid)} /> : null}
          {pending.pendingRefund > 0 ? <Row label={t('customerPendingRefund', { amount: money(pending.pendingRefund) })} value="" /> : null}
          {pending.pendingExtra > 0 ? <Row label={t('customerPendingExtra', { amount: money(pending.pendingExtra) })} value="" /> : null}
        </dl>
        {holdAmountChanges ? (
          <Alert>{t('customerEditConfirmHoldAmount', { amount: newTotal == null ? t('priceQuote') : money(newTotal) })}</Alert>
        ) : null}
        {adjustment.kind === 'refund' ? <Alert>{t('customerEditConfirmRefund', { amount: money(adjustment.amount) })}</Alert> : null}
        {adjustment.kind === 'extra' ? <Alert tone="warning">{t('customerEditConfirmExtra', { amount: money(adjustment.amount) })}</Alert> : null}
        {adjustment.kind === 'prepaid' ? <Alert>{t('customerEditConfirmPrepaid', { amount: money(netPaid) })}</Alert> : null}
      </Section>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap justify-center gap-2 border-t border-line bg-surface px-4 py-3">
        <Button variant="primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? t('saving') : t('save')}
        </Button>
        <Button variant="ghost" disabled={saving} onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 ${highlight ? 'rounded-lg border border-highlightLine bg-highlight px-2 py-1.5 font-semibold' : ''}`}>
      <dt className={highlight ? 'text-ink' : 'text-muted'}>{label}</dt>
      <dd className={`text-end ${highlight ? 'text-primary' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}
