import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  BookOpen,
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Circle,
  Database,
  Headphones,
  Home,
  Laptop,
  Mail,
  Monitor,
  Package,
  Printer,
  Shield,
  Wrench,
  Wifi,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select, Skeleton, Textarea } from '../ui';
import { useAvailability, useMonthAvailability } from '../../hooks/useAvailability';
import { createBooking, fetchPublicBookingConfig, fetchServiceCatalog } from '../../services/publicApi';
import type { AvailabilityQuery, BankInstructions, CreateBookingResponse } from '../../types/api';
import type { DeviceType, PublicCategory, PublicService, ServiceMode } from '../../types/catalog';
import { DEVICE_TYPES, OPERATING_SYSTEMS, localized } from '../../types/catalog';
import type { PublicBookingConfig } from '../../types/bookingSettings';
import { allowedModes, paymentStepMode, sharedPaymentMethods } from '../../utils/catalogRules';
import {
  BUSINESS_TIME_ZONE,
  calendarDateFromISO,
  formatCivilDate,
  formatISODateToDisplay,
  monthKeyFromDate,
  todayISOInTimeZone,
} from '../../utils/dateTime';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { bookingTotal, formatMoney, lineTotal, sumDuration } from '../../utils/pricing';
import { getBookingValidationIssue } from '../../utils/validation';

const ICONS: Record<string, typeof Circle> = {
  activity: Activity,
  laptop: Laptop,
  monitor: Monitor,
  database: Database,
  wifi: Wifi,
  printer: Printer,
  shield: Shield,
  mail: Mail,
  package: Package,
  wrench: Wrench,
  headphones: Headphones,
  'book-open': BookOpen,
  home: Home,
};

const MODE_ICON: Record<ServiceMode, typeof Car> = {
  onsite: Car,
  remote: Monitor,
  workshop: Wrench,
};

function CatalogIcon({ name, className = 'h-5 w-5' }: { name: string | null; className?: string }) {
  const Icon = ICONS[name ?? ''] ?? Circle;
  return <Icon className={className} aria-hidden="true" />;
}

function PriceLabel({ service, locale }: { service: PublicService; locale: string }) {
  const { t } = useTranslation();
  if (service.priceType === 'quote' || service.price == null && service.priceType !== 'hourly') {
    return <>{service.priceType === 'diagnostic' ? t('priceDiagnostic') : t('priceQuote')}</>;
  }
  if (service.price == null) return <>{t('priceQuote')}</>;
  const money = formatMoney(service.price, service.currency, locale);
  if (service.priceType === 'from') return <>{t('priceFrom', { price: money })}</>;
  if (service.priceType === 'hourly') return <>{t('priceHourly', { price: money })}</>;
  return <>{money}</>;
}

function MonthGrid({
  month,
  selected,
  disabled,
  onSelect,
  onMonth,
  locale,
}: {
  month: Date;
  selected: string;
  disabled: (iso: string) => boolean;
  onSelect: (iso: string) => void;
  onMonth: (next: Date) => void;
  locale: string;
}) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = start.getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const label = new Intl.DateTimeFormat(locale === 'he' ? 'he-IL' : locale === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'long',
    year: 'numeric',
  }).format(month);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" className="rounded-lg p-2 hover:bg-canvas" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="previous">
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </button>
        <p className="font-semibold capitalize text-ink">{label}</p>
        <button type="button" className="rounded-lg p-2 hover:bg-canvas" onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="next">
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted">
        {Array.from({ length: startOffset }).map((_, index) => <span key={`pad-${index}`} />)}
        {Array.from({ length: days }).map((_, index) => {
          const date = new Date(month.getFullYear(), month.getMonth(), index + 1);
          const iso = formatCivilDate(date);
          const isDisabled = disabled(iso);
          const isSelected = iso === selected;
          return (
            <button
              key={iso}
              type="button"
              disabled={isDisabled}
              onClick={() => onSelect(iso)}
              className={`h-8 rounded-md text-xs font-medium ${isSelected ? 'bg-primary text-white' : 'hover:bg-blue-50'} disabled:cursor-not-allowed disabled:text-slate-300`}
            >
              {index + 1}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function BookingPage({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];
  const [categories, setCategories] = useState<PublicCategory[]>([]);
  const [config, setConfig] = useState<PublicBookingConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<ServiceMode | ''>('');
  const [deviceType, setDeviceType] = useState<DeviceType | ''>('');
  const [operatingSystem, setOperatingSystem] = useState('');
  const [deviceBrand, setDeviceBrand] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [problem, setProblem] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [comments, setComments] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [paymentCode, setPaymentCode] = useState('');
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateBookingResponse | null>(null);
  const [visibleMonth, setVisibleMonth] = useState(() => calendarDateFromISO(todayISOInTimeZone(BUSINESS_TIME_ZONE)));

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [catalog, nextConfig] = await Promise.all([fetchServiceCatalog(), fetchPublicBookingConfig()]);
      setCategories(catalog.categories);
      setConfig(nextConfig);
      setCategoryId(catalog.categories[0]?.id ?? null);
      setVisibleMonth(calendarDateFromISO(todayISOInTimeZone(nextConfig.timezone)));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const services = useMemo(() => categories.flatMap((category) => category.services), [categories]);
  const categoryColumns = useMemo(() => {
    const count = categories.length;
    if (count <= 0) return 1;
    const maxRows = 2;
    return Math.max(1, Math.ceil(count / maxRows));
  }, [categories.length]);
  const selected = useMemo(
    () => selectedIds.map((id) => services.find((service) => service.id === id)).filter((service): service is PublicService => Boolean(service)),
    [selectedIds, services],
  );
  const modes = useMemo(() => allowedModes(selected), [selected]);
  const payMode = paymentStepMode(selected.map((service) => service.paymentPolicy));
  const methods = useMemo(() => sharedPaymentMethods(selected), [selected]);
  const steps = useMemo(() => {
    const base = ['services', 'mode', 'device', 'details', 'schedule'];
    if (payMode !== 'skip') base.push('payment');
    base.push('confirm');
    return base;
  }, [payMode]);
  const current = steps[Math.min(step, steps.length - 1)];
  const activeCategory = categories.find((category) => category.id === categoryId) ?? categories[0];
  const duration = sumDuration(selected);
  const total = bookingTotal(selected.map((service) => ({
    total: lineTotal(service.priceType, service.price, service.durationMinutes),
  })));
  const currency = selected[0]?.currency ?? 'ILS';
  const requiresDevice = selected.some((service) => service.requiresDevice);
  const requiresOs = selected.some((service) => service.requiresOperatingSystem);
  const availabilityQuery = useMemo<AvailabilityQuery | null>(() => (
    mode && selectedIds.length > 0 ? { serviceIds: selectedIds, serviceMode: mode } : null
  ), [mode, selectedIds]);
  const availability = useAvailability(date || null, availabilityQuery);
  const monthAvailability = useMonthAvailability(
    current === 'schedule' && config ? monthKeyFromDate(visibleMonth) : null,
    availabilityQuery,
  );

  useEffect(() => {
    if (mode && !modes.includes(mode)) setMode('');
  }, [mode, modes]);

  useEffect(() => {
    if (!time || availability.loading || availability.slots.length === 0) return;
    if (!availability.slots.includes(time)) setTime('');
  }, [availability.loading, availability.slots, time]);

  const toggleService = (id: string) => {
    setSelectedIds((currentIds) => currentIds.includes(id) ? currentIds.filter((item) => item !== id) : [...currentIds, id]);
    setDate('');
    setTime('');
  };

  const canContinue = () => {
    if (current === 'services') return selected.length > 0;
    if (current === 'mode') return Boolean(mode);
    if (current === 'device') return (!requiresDevice || Boolean(deviceType)) && (!requiresOs || (Boolean(operatingSystem) && operatingSystem !== 'not_applicable'));
    if (current === 'details') return Boolean(firstName.trim() && lastName.trim() && phone.trim() && address.trim());
    if (current === 'schedule') return Boolean(date && time);
    if (current === 'payment') return payMode !== 'required' || Boolean(paymentCode);
    return true;
  };

  const submit = async () => {
    if (!mode) return;
    const bookingLocale: 'ru' | 'he' | 'en' = locale === 'he' ? 'he' : locale === 'en' ? 'en' : 'ru';
    const request = {
      firstName,
      lastName,
      phone,
      email,
      address,
      city,
      serviceMode: mode,
      deviceType,
      operatingSystem: operatingSystem || 'not_applicable',
      deviceBrand,
      deviceModel,
      problemDescription: problem,
      comments,
      appointmentDate: date,
      appointmentTime: time,
      serviceIds: selectedIds,
      paymentMethodCode: payMode === 'skip' ? '' : paymentCode,
      locale: bookingLocale,
    };
    const validationIssue = getBookingValidationIssue(request, {
      requiresAddress: true,
      requiresCity: false,
      requiresDevice,
      requiresOperatingSystem: requiresOs,
    });
    if (validationIssue) {
      console.warn('booking_validation_failed', validationIssue, request);
      toast.error(t('error_INVALID_INPUT'));
      return;
    }
    setSubmitting(true);
    try {
      const created = await createBooking(request);
      if (!created?.bookingNumber) throw new BookingApiError('INTERNAL_ERROR');
      setResult(created);
      if (created.smsSent === false && created.smsSkipped === false) toast(t('smsError'), { icon: '!' });
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
      toast.error(t(errorI18nKey(code)));
      if (code === 'SLOT_UNAVAILABLE' || code === 'DAILY_LIMIT_REACHED') {
        await Promise.all([availability.refresh(), monthAvailability.refresh()]);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const today = todayISOInTimeZone(config?.timezone || BUSINESS_TIME_ZONE);
  const dateDisabled = (iso: string) => {
    if (!config) return true;
    if (iso < today) return true;
    const weekday = calendarDateFromISO(iso).getDay();
    if (config.disabledWeekdays.includes(weekday)) return true;
    if (config.disabledDates.includes(iso)) return true;
    const slots = monthAvailability.days[iso];
    return Array.isArray(slots) && slots.length === 0;
  };

  if (result) {
    return (
      <Shell onOpenAdmin={onOpenAdmin}>
        <Card className="mx-auto max-w-xl p-6">
          <Badge tone="success">{t('bookingConfirmed')}</Badge>
          <h1 className="mt-3 text-2xl font-semibold">{t('bookingSuccess')}</h1>
          <p className="mt-2 text-muted">{t('bookingNumber')}</p>
          <p className="text-3xl font-semibold tracking-tight text-ink">{result.bookingNumber}</p>
          <p className="mt-4 text-sm text-ink">{formatISODateToDisplay(result.appointmentDate)} {result.appointmentTime}</p>
          {result.paymentStatus ? <p className="mt-2 text-sm">{t(`pay_${result.paymentStatus}`, { defaultValue: result.paymentStatus })}</p> : null}
          <BankBlock instructions={result.bankInstructions} locale={locale} />
          {result.externalUrl ? <a className="mt-3 inline-block text-sm font-semibold text-primary" href={result.externalUrl}>{t('openPaymentLink')}</a> : null}
        </Card>
      </Shell>
    );
  }

  return (
    <Shell onOpenAdmin={onOpenAdmin} subtitle={t('subtitle')}>
      {loading ? <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div> : null}
      {loadError ? (
        <Alert tone="danger">
          <p>{t('catalogLoadError')}</p>
          <Button className="mt-3" variant="ghost" onClick={() => void load()}>{t('retry')}</Button>
        </Alert>
      ) : null}

      {!loading && !loadError ? (
        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_min(280px,22vw)] lg:items-stretch">
          <Card className="flex h-full min-h-0 flex-col p-3">
            <ol className="mb-2 flex shrink-0 gap-1.5 overflow-x-auto text-[11px] font-semibold text-muted">
              {steps.map((name, index) => (
                <li key={name} className={`whitespace-nowrap rounded-full px-2.5 py-0.5 ${index === step ? 'bg-primary text-white' : 'bg-canvas'}`}>
                  {index + 1}. {t(`step_${name}`)}
                </li>
              ))}
            </ol>

            <div className={`min-h-0 flex-1 overscroll-contain ${current === 'services' ? 'overflow-y-auto lg:flex lg:flex-col lg:overflow-hidden' : 'overflow-y-auto'}`}>
            {current === 'services' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                <section
                  aria-labelledby="booking-categories-heading"
                  className="shrink-0 rounded-xl border border-line bg-surface p-3"
                >
                  <h3 id="booking-categories-heading" className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    {t('nav_categories')}
                  </h3>
                  <div
                    className="grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${categoryColumns}, minmax(0, 1fr))` }}
                  >
                    {categories.map((category) => {
                      const active = category.id === activeCategory?.id;
                      return (
                        <button
                          key={category.id}
                          type="button"
                          onClick={() => setCategoryId(category.id)}
                          className={`rounded-2xl border p-4 text-start transition ${active ? 'border-primary bg-blue-50' : 'border-line hover:border-primary/40'}`}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-primary">
                            <CatalogIcon name={category.icon} />
                          </span>
                          <span className="mt-3 block font-semibold text-ink">{localized(category.name, locale)}</span>
                          <span className="mt-1 block text-sm text-muted">{localized(category.description, locale)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                <section
                  aria-labelledby="booking-services-heading"
                  className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-canvas"
                >
                  <h3
                    id="booking-services-heading"
                    className="shrink-0 border-b border-blue-100 bg-blue-50 px-3 py-2 text-sm font-semibold text-primary"
                  >
                    {activeCategory
                      ? t('servicesOfCategory', { name: localized(activeCategory.name, locale) })
                      : t('step_services')}
                  </h3>
                  <div className="grid min-h-0 flex-1 gap-1.5 overflow-y-auto overscroll-contain p-3 content-start">
                  {(activeCategory?.services ?? []).map((service) => {
                    const checked = selectedIds.includes(service.id);
                    return (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => toggleService(service.id)}
                        aria-pressed={checked}
                        className={`flex items-center justify-between gap-2 rounded-xl border px-2.5 py-2 text-start ${checked ? 'border-primary bg-blue-50' : 'border-line hover:border-primary/40'}`}
                      >
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold leading-tight">{localized(service.name, locale)}</span>
                          <span className="text-xs text-muted">{service.durationMinutes} {t('minutesShort')}</span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold text-ink"><PriceLabel service={service} locale={locale} /></span>
                      </button>
                    );
                  })}
                  </div>
                </section>
              </div>
            ) : null}

            {current === 'mode' ? (
              <div className="grid gap-2 sm:grid-cols-3">
                {modes.length === 0 ? <EmptyState title={t('noCommonMode')} /> : null}
                {modes.map((item) => {
                  const Icon = MODE_ICON[item];
                  return (
                    <button key={item} type="button" onClick={() => { setMode(item); setDate(''); setTime(''); }} className={`flex items-center gap-2 rounded-xl border p-2.5 text-start ${mode === item ? 'border-primary bg-blue-50' : 'border-line'}`}>
                      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                      <span className="text-sm font-semibold">{t(`mode_${item}`)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {current === 'device' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={t('deviceType')} required={requiresDevice}>
                  <Select required={requiresDevice} value={deviceType} onChange={(event) => setDeviceType(event.target.value as DeviceType | '')}>
                    <option value="">{t('selectPlaceholder')}</option>
                    {DEVICE_TYPES.map((item) => <option key={item} value={item}>{t(`device_${item}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t('operatingSystem')} required={requiresOs}>
                  <Select required={requiresOs} value={operatingSystem} onChange={(event) => setOperatingSystem(event.target.value)}>
                    <option value="">{t('selectPlaceholder')}</option>
                    {OPERATING_SYSTEMS.map((item) => <option key={item} value={item}>{t(`os_${item}`)}</option>)}
                  </Select>
                </Field>
                <Field label={t('deviceBrand')}><Input value={deviceBrand} maxLength={80} onChange={(event) => setDeviceBrand(event.target.value)} /></Field>
                <Field label={t('deviceModel')}><Input value={deviceModel} maxLength={80} onChange={(event) => setDeviceModel(event.target.value)} /></Field>
                <div className="sm:col-span-2">
                  <Field label={t('problemDescription')}><Textarea rows={2} className="min-h-[4.5rem]" value={problem} maxLength={2000} onChange={(event) => setProblem(event.target.value)} /></Field>
                </div>
              </div>
            ) : null}

            {current === 'details' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label={t('firstName')} required><Input required value={firstName} maxLength={80} onChange={(event) => setFirstName(event.target.value)} /></Field>
                <Field label={t('lastName')} required><Input required value={lastName} maxLength={80} onChange={(event) => setLastName(event.target.value)} /></Field>
                <Field label={t('phone')} required><Input required value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
                <Field label={t('email')}><Input type="email" value={email} maxLength={120} onChange={(event) => setEmail(event.target.value)} /></Field>
                <Field label={t('city')}><Input value={city} maxLength={80} onChange={(event) => setCity(event.target.value)} /></Field>
                <Field label={t('address')} required><Input required value={address} maxLength={200} onChange={(event) => setAddress(event.target.value)} /></Field>
                <div className="sm:col-span-2">
                  <Field label={t('comments')}><Textarea rows={2} className="min-h-[4.5rem]" value={comments} maxLength={1000} onChange={(event) => setComments(event.target.value)} /></Field>
                </div>
              </div>
            ) : null}

            {current === 'schedule' ? (
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
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4" aria-hidden="true" />{t('durationMinutes')}: {availability.durationMinutes || duration}</p>
                  {availability.loading ? <Skeleton className="h-24" /> : null}
                  {!availability.loading && availability.slots.length === 0 ? <EmptyState title={t('noAvailableSlots')} /> : null}
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                    {availability.slots.map((slot) => (
                      <button key={slot} type="button" onClick={() => setTime(slot)} className={`rounded-md border px-1.5 py-1.5 text-xs font-semibold ${time === slot ? 'border-primary bg-primary text-white' : 'border-line'}`}>
                        {slot}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {current === 'payment' ? (
              <div className="space-y-2">
                <p className="text-xs text-muted">{payMode === 'required' ? t('paymentRequiredHint') : t('paymentOptionalHint')}</p>
                {methods.length === 0 ? <Alert tone="warning">{t('noPaymentMethods')}</Alert> : null}
                {methods.map((method) => (
                  <button key={method.code} type="button" onClick={() => setPaymentCode(method.code)} className={`block w-full rounded-xl border p-2.5 text-start ${paymentCode === method.code ? 'border-primary bg-blue-50' : 'border-line'}`}>
                    <span className="text-sm font-semibold">{localized(method.name, locale)}</span>
                    <span className="mt-0.5 block text-xs text-muted">{localized(method.instructions, locale)}</span>
                  </button>
                ))}
                {payMode === 'optional' ? <Button variant="ghost" onClick={() => { setPaymentCode(''); setStep((value) => value + 1); }}>{t('skipPayment')}</Button> : null}
              </div>
            ) : null}

            {current === 'confirm' ? (
              <div className="space-y-2 text-sm">
                {selected.map((service) => <p key={service.id}>{localized(service.name, locale)}</p>)}
                <p>{mode ? t(`mode_${mode}`) : ''}</p>
                <p>{date ? `${formatISODateToDisplay(date)} ${time}` : ''}</p>
              </div>
            ) : null}
            </div>

            <div className="mt-2 hidden shrink-0 items-center justify-between gap-2 border-t border-line pt-2 sm:flex">
              <Button variant="ghost" className="py-2" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>{t('back')}</Button>
              {current === 'confirm'
                ? <Button className="py-2" onClick={() => void submit()} disabled={submitting}>{submitting ? t('submitting') : t('submit')}</Button>
                : <Button className="py-2" disabled={!canContinue()} onClick={() => setStep((value) => Math.min(steps.length - 1, value + 1))}>{t('next')}</Button>}
            </div>
          </Card>

          <Card className="hidden h-full min-h-0 flex-col overflow-y-auto p-3 lg:flex">
            <Summary selected={selected} locale={locale} mode={mode} duration={duration} date={date} time={time} total={total} currency={currency} paymentCode={paymentCode} />
          </Card>
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-3 sm:hidden">
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1" disabled={step === 0} onClick={() => setStep((value) => Math.max(0, value - 1))}>{t('back')}</Button>
          {current === 'confirm'
            ? <Button className="flex-1" onClick={() => void submit()} disabled={submitting}>{t('submit')}</Button>
            : <Button className="flex-1" disabled={!canContinue()} onClick={() => setStep((value) => value + 1)}>{t('next')}</Button>}
        </div>
      </div>
    </Shell>
  );
}

function Summary({
  selected,
  locale,
  mode,
  duration,
  date,
  time,
  total,
  currency,
  paymentCode,
}: {
  selected: PublicService[];
  locale: string;
  mode: string;
  duration: number;
  date: string;
  time: string;
  total: number | null;
  currency: string;
  paymentCode: string;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">{t('summary')}</h2>
      <ul className="mt-2 space-y-1 text-xs">
        {selected.length === 0 ? <li className="text-muted">{t('noneSelected')}</li> : null}
        {selected.map((service) => <li key={service.id} className="flex justify-between gap-2"><span className="min-w-0 truncate">{localized(service.name, locale)}</span><span className="shrink-0"><PriceLabel service={service} locale={locale} /></span></li>)}
      </ul>
      <dl className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
        <Row label={t('serviceMode')} value={mode ? t(`mode_${mode}`) : '—'} />
        <Row label={t('duration')} value={`${duration} ${t('minutesShort')}`} />
        <Row label={t('appointmentDate')} value={date ? formatISODateToDisplay(date) : '—'} />
        <Row label={t('appointmentTime')} value={time || '—'} />
        <Row highlight label={t('total')} value={total == null ? t('priceQuote') : formatMoney(total, currency, locale)} />
        <Row label={t('payment')} value={paymentCode || '—'} />
      </dl>
    </div>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  if (highlight) {
    return (
      <div className="-mx-0.5 my-1 flex items-center justify-between gap-3 rounded-lg border border-blue-100 bg-blue-50 px-2 py-1.5">
        <dt className="text-sm font-bold text-ink">{label}</dt>
        <dd className="text-sm font-bold text-primary">{value}</dd>
      </div>
    );
  }
  return <div className="flex justify-between gap-3"><dt className="text-muted">{label}</dt><dd className="font-medium text-ink">{value}</dd></div>;
}

function BankBlock({ instructions, locale }: { instructions?: BankInstructions | null; locale: string }) {
  const { t } = useTranslation();
  if (!instructions) return null;
  return (
    <div className="mt-4 rounded-xl bg-canvas p-4 text-sm">
      <p className="font-semibold">{t('bankDetails')}</p>
      <p>{instructions.bankName}</p>
      <p>{t('branch')}: {instructions.branch}</p>
      <p>{t('accountNumber')}: {instructions.account}</p>
      <p>{t('beneficiary')}: {instructions.beneficiary}</p>
      {instructions.iban ? <p>IBAN: {instructions.iban}</p> : null}
      <p className="mt-2 text-muted">{localized(instructions.instructions, locale)}</p>
    </div>
  );
}

function Shell({ children, onOpenAdmin, subtitle }: { children: ReactNode; onOpenAdmin: () => void; subtitle?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col overflow-hidden bg-canvas pb-14 lg:pb-0">
      <header className="shrink-0 border-b border-line bg-surface">
        <div className="flex w-full items-center justify-between gap-3 px-3 py-2 sm:px-5 xl:px-8">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-secondary">{t('brandKicker')}</p>
            <h1 className="truncate text-base font-semibold leading-tight text-ink sm:text-lg">{t('title')}</h1>
            {subtitle ? <p className="hidden truncate text-xs text-muted sm:block">{subtitle}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={onOpenAdmin} className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium hover:bg-canvas sm:text-sm">{t('admin')}</button>
            <LanguageSwitcher />
          </div>
        </div>
      </header>
      <main className="flex min-h-0 w-full flex-1 flex-col overflow-hidden px-3 py-2 sm:px-5 xl:px-8">{children}</main>
    </div>
  );
}
