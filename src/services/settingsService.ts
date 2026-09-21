import { supabase } from '../lib/supabase';
import type { BookingSettings } from '../types/bookingSettings';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';
import { normalizeClock } from '../utils/dateTime';

interface SettingsRow {
  first_day_of_week: number;
  disabled_weekdays: number[] | null;
  min_interval_minutes: number;
  work_start_time: string;
  work_end_time: string;
  max_bookings_per_day: number | null;
  send_sms: boolean;
  timezone: string;
}

interface DisabledDateRow {
  disabled_date: string;
}

interface SaveSettingsResponse {
  ok?: boolean;
  code?: string;
  settings?: {
    firstDayOfWeek: number;
    disabledWeekdays: number[];
    disabledDates: string[];
    minIntervalMinutes: number;
    workStartTime: string;
    workEndTime: string;
    maxBookingsPerDay: number | null;
    sendSms: boolean;
    timezone: string;
  };
}

const LEGACY_SETTINGS_KEY = 'bookingSettings';

function mapSettings(row: SettingsRow, disabledDates: string[]): BookingSettings {
  return {
    firstDayOfWeek: row.first_day_of_week === 0 ? 0 : 1,
    disabledWeekdays: row.disabled_weekdays ?? [],
    disabledDates,
    minIntervalMinutes: row.min_interval_minutes,
    workStartTime: normalizeClock(row.work_start_time),
    workEndTime: normalizeClock(row.work_end_time),
    maxBookingsPerDay: row.max_bookings_per_day,
    sendSms: row.send_sms,
    timezone: row.timezone,
  };
}

function mapSavedSettings(settings: NonNullable<SaveSettingsResponse['settings']>): BookingSettings {
  return {
    firstDayOfWeek: settings.firstDayOfWeek === 0 ? 0 : 1,
    disabledWeekdays: settings.disabledWeekdays ?? [],
    disabledDates: settings.disabledDates ?? [],
    minIntervalMinutes: settings.minIntervalMinutes,
    workStartTime: normalizeClock(settings.workStartTime),
    workEndTime: normalizeClock(settings.workEndTime),
    maxBookingsPerDay: settings.maxBookingsPerDay,
    sendSms: settings.sendSms,
    timezone: settings.timezone,
  };
}

export async function fetchBookingSettings(): Promise<BookingSettings> {
  const [{ data, error }, datesResult] = await Promise.all([
    supabase.from('booking_settings').select('*').eq('id', 1).single(),
    supabase.from('booking_disabled_dates').select('disabled_date').order('disabled_date'),
  ]);

  if (error || !data) throw error ?? new Error('SETTINGS_NOT_FOUND');
  if (datesResult.error) throw datesResult.error;

  const dates = ((datesResult.data ?? []) as DisabledDateRow[]).map((row) => row.disabled_date.slice(0, 10));
  return mapSettings(data as SettingsRow, dates);
}

export async function saveBookingSettings(settings: BookingSettings): Promise<BookingSettings> {
  const { data, error } = await supabase.rpc('save_booking_settings', {
    p_first_day_of_week: settings.firstDayOfWeek,
    p_disabled_weekdays: settings.disabledWeekdays,
    p_disabled_dates: settings.disabledDates,
    p_min_interval_minutes: settings.minIntervalMinutes,
    p_work_start_time: settings.workStartTime,
    p_work_end_time: settings.workEndTime,
    p_max_bookings_per_day: settings.maxBookingsPerDay,
    p_send_sms: settings.sendSms,
  });

  if (error) throw error;

  const payload = data as SaveSettingsResponse | null;
  if (!payload?.ok || !payload.settings) {
    throw new BookingApiError(normalizeErrorCode(payload?.code));
  }

  clearLegacyLocalSettings();
  return mapSavedSettings(payload.settings);
}

interface LegacySettings {
  firstDayOfWeek?: number;
  disabledWeekdays?: number[];
  disabledDates?: string[];
  minIntervalHours?: number;
  minIntervalMinutes?: number;
  workStartTime?: string;
  workEndTime?: string;
  maxBookingsPerDay?: number | null;
  sendSMS?: boolean;
  sendSms?: boolean;
}

export function readLegacyLocalSettings(): LegacySettings | null {
  const raw = localStorage.getItem(LEGACY_SETTINGS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LegacySettings;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function legacySettingsToDraft(current: BookingSettings, legacy: LegacySettings): BookingSettings {
  const minutes = legacy.minIntervalMinutes
    ?? (typeof legacy.minIntervalHours === 'number' ? legacy.minIntervalHours * 60 : current.minIntervalMinutes);

  return {
    ...current,
    firstDayOfWeek: legacy.firstDayOfWeek === 0 ? 0 : legacy.firstDayOfWeek === 1 ? 1 : current.firstDayOfWeek,
    disabledWeekdays: legacy.disabledWeekdays ?? current.disabledWeekdays,
    disabledDates: legacy.disabledDates ?? current.disabledDates,
    minIntervalMinutes: minutes,
    workStartTime: legacy.workStartTime ?? current.workStartTime,
    workEndTime: legacy.workEndTime ?? current.workEndTime,
    maxBookingsPerDay: legacy.maxBookingsPerDay === undefined ? current.maxBookingsPerDay : legacy.maxBookingsPerDay,
    sendSms: legacy.sendSms ?? legacy.sendSMS ?? current.sendSms,
    timezone: current.timezone,
  };
}

export function clearLegacyLocalSettings(): void {
  localStorage.removeItem(LEGACY_SETTINGS_KEY);
}
