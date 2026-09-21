import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import Calendar from 'react-calendar';
import { toast, Toaster } from 'react-hot-toast';
import { Clock, Globe, WrenchIcon } from 'lucide-react';
import { AdminView } from './components/admin/AdminView';
import { LanguageSwitcher } from './components/LanguageSwitcher';
import { useAvailability, useMonthAvailability } from './hooks/useAvailability';
import { useDocumentDirection } from './hooks/useDocumentDirection';
import { createBooking, fetchPublicBookingConfig } from './services/publicApi';
import type { CreateBookingRequest } from './types/api';
import type { PublicBookingConfig } from './types/bookingSettings';
import {
  BUSINESS_TIME_ZONE,
  calendarDateFromISO,
  formatCivilDate,
  monthKeyFromDate,
  todayISOInTimeZone,
} from './utils/dateTime';
import { BookingApiError, errorI18nKey } from './utils/errors';
import { validateBookingInput } from './utils/validation';
import 'react-calendar/dist/Calendar.css';

const OPERATING_SYSTEMS = ['windows', 'linux', 'macos'] as const;

type BookingFormData = {
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  city: string;
  operatingSystem: string;
  comments: string;
  appointmentDate: string;
  appointmentTime: string;
};

const EMPTY_FORM: BookingFormData = {
  firstName: '',
  lastName: '',
  phone: '',
  address: '',
  city: '',
  operatingSystem: '',
  comments: '',
  appointmentDate: '',
  appointmentTime: '',
};

function App() {
  const { t, i18n } = useTranslation();
  useDocumentDirection();
  const [showAdmin, setShowAdmin] = useState(false);
  const [formData, setFormData] = useState<BookingFormData>(EMPTY_FORM);
  const [config, setConfig] = useState<PublicBookingConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => calendarDateFromISO(todayISOInTimeZone(BUSINESS_TIME_ZONE)));

  const timeZone = config?.timezone || BUSINESS_TIME_ZONE;
  const today = todayISOInTimeZone(timeZone);
  const availability = useAvailability(formData.appointmentDate || null);
  const monthAvailability = useMonthAvailability(config ? monthKeyFromDate(visibleMonth) : null);

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(false);
    try {
      const next = await fetchPublicBookingConfig();
      setConfig(next);
      setVisibleMonth(calendarDateFromISO(todayISOInTimeZone(next.timezone)));
    } catch {
      setConfig(null);
      setConfigError(true);
    } finally {
      setConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (formData.appointmentTime && !availability.slots.includes(formData.appointmentTime)) {
      setFormData((current) => ({ ...current, appointmentTime: '' }));
    }
  }, [availability.slots, formData.appointmentTime]);

  const locale = (i18n.resolvedLanguage || i18n.language || 'ru').split('-')[0];
  const calendarLocale = locale === 'ru' || locale === 'he' || locale === 'en' ? locale : 'en';

  const isDateDisabled = ({ date }: { date: Date }) => {
    if (!config) return true;
    const iso = formatCivilDate(date);
    if (iso < todayISOInTimeZone(config.timezone)) return true;
    if (config.disabledWeekdays.includes(date.getDay())) return true;
    if (config.disabledDates.includes(iso)) return true;
    const slots = monthAvailability.days[iso];
    return Array.isArray(slots) && slots.length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!formData.appointmentDate || !formData.appointmentTime) {
      toast.error(t('selectDateTime'));
      return;
    }

    const request: CreateBookingRequest = {
      firstName: formData.firstName,
      lastName: formData.lastName,
      phone: formData.phone,
      address: formData.address,
      city: formData.city,
      operatingSystem: formData.operatingSystem,
      comments: formData.comments,
      appointmentDate: formData.appointmentDate,
      appointmentTime: formData.appointmentTime,
      locale: locale === 'he' || locale === 'en' ? locale : 'ru',
    };

    if (!validateBookingInput(request)) {
      toast.error(t('error_INVALID_INPUT'));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createBooking(request);
      if (!result?.bookingNumber) {
        throw new BookingApiError('INTERNAL_ERROR');
      }
      toast.success(
        <div>
          {t('bookingSuccess')}
          <br />
          {t('bookingNumber')}: <strong>{result.bookingNumber}</strong>
        </div>,
      );
      if (result.smsSent === false && result.smsSkipped === false) {
        toast(t('smsError'), { icon: '⚠️', duration: 8000 });
      }
      setFormData(EMPTY_FORM);
      await Promise.all([availability.refresh(), monthAvailability.refresh()]);
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
      toast.error(t(errorI18nKey(code)));
      if (code === 'SLOT_UNAVAILABLE' || code === 'DAILY_LIMIT_REACHED') {
        await Promise.all([availability.refresh(), monthAvailability.refresh()]);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (showAdmin) {
    return <AdminView onLogout={() => setShowAdmin(false)} />;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />
      <div className="fixed top-4 end-4 flex gap-2">
        <button type="button" onClick={() => setShowAdmin(true)} className="px-3 py-1 rounded bg-white shadow hover:bg-gray-100">
          <WrenchIcon className="w-4 h-4" />
        </button>
        <LanguageSwitcher />
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
          <div className="flex items-center gap-2 mb-6">
            <Globe className="w-6 h-6 text-blue-600" />
            <h1 className="text-2xl font-bold text-gray-800">{t('title')}</h1>
          </div>
          <p className="text-gray-600 mb-8">{t('subtitle')}</p>

          {configLoading && <p className="text-sm text-gray-500 mb-4">{t('loading')}</p>}
          {configError && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>{t('configLoadError')}</p>
              <button type="button" onClick={() => void loadConfig()} className="mt-2 underline">
                {t('retry')}
              </button>
            </div>
          )}

          <form onSubmit={(event) => void handleSubmit(event)} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <label className="block text-sm font-medium text-gray-700">
                {t('firstName')} *
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={formData.firstName}
                  onChange={(event) => setFormData((current) => ({ ...current, firstName: event.target.value }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-sm font-medium text-gray-700">
                {t('lastName')} *
                <input
                  type="text"
                  required
                  maxLength={80}
                  value={formData.lastName}
                  onChange={(event) => setFormData((current) => ({ ...current, lastName: event.target.value }))}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </label>
            </div>

            <label className="block text-sm font-medium text-gray-700">
              {t('phone')} *
              <input
                type="tel"
                required
                value={formData.phone}
                onChange={(event) => setFormData((current) => ({ ...current, phone: event.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm font-medium text-gray-700">
              {t('city')}
              <input
                type="text"
                maxLength={80}
                value={formData.city}
                onChange={(event) => setFormData((current) => ({ ...current, city: event.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm font-medium text-gray-700">
              {t('address')} *
              <input
                type="text"
                required
                maxLength={200}
                value={formData.address}
                onChange={(event) => setFormData((current) => ({ ...current, address: event.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              />
            </label>

            <label className="block text-sm font-medium text-gray-700">
              {t('operatingSystem')} *
              <select
                required
                value={formData.operatingSystem}
                onChange={(event) => setFormData((current) => ({ ...current, operatingSystem: event.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
              >
                <option value="">{t('selectOs')}</option>
                {OPERATING_SYSTEMS.map((os) => (
                  <option key={os} value={os}>{t(os)}</option>
                ))}
              </select>
            </label>

            <label className="block text-sm font-medium text-gray-700">
              {t('comments')}
              <textarea
                maxLength={1000}
                value={formData.comments}
                onChange={(event) => setFormData((current) => ({ ...current, comments: event.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                rows={3}
              />
            </label>

            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <Clock className="w-4 h-4" />
                {t('appointmentDate')} *
              </div>
              <Calendar
                onChange={(date) => {
                  const selected = Array.isArray(date) ? date[0] : date;
                  setFormData((current) => ({
                    ...current,
                    appointmentDate: selected ? formatCivilDate(selected) : '',
                    appointmentTime: '',
                  }));
                }}
                onActiveStartDateChange={({ activeStartDate }) => {
                  if (activeStartDate) setVisibleMonth(activeStartDate);
                }}
                value={formData.appointmentDate ? calendarDateFromISO(formData.appointmentDate) : null}
                activeStartDate={visibleMonth}
                minDate={calendarDateFromISO(today)}
                tileDisabled={isDateDisabled}
                locale={calendarLocale}
                calendarType={config?.firstDayOfWeek === 0 ? 'gregory' : undefined}
                className="w-full border rounded-lg p-4"
              />

              {formData.appointmentDate && (
                <label className="block text-sm font-medium text-gray-700">
                  {t('appointmentTime')} *
                  <select
                    required
                    value={formData.appointmentTime}
                    onChange={(event) => setFormData((current) => ({ ...current, appointmentTime: event.target.value }))}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  >
                    <option value="">{availability.loading ? t('loading') : t('selectTime')}</option>
                    {availability.slots.map((time) => (
                      <option key={time} value={time}>{time}</option>
                    ))}
                  </select>
                  {!availability.loading && availability.slots.length === 0 && (
                    <span className="mt-1 block text-sm text-gray-500">{t('noAvailableSlots')}</span>
                  )}
                </label>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting || configLoading || !config}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? t('submitting') : t('submit')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default App;
