import { supabase } from '../lib/supabase';
import type { BookingSettings, WorkingHourDay } from '../types/bookingSettings';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';
import { normalizeClock } from '../utils/dateTime';

interface SettingsRow {
  first_day_of_week: number;
  disabled_weekdays: number[] | null;
  min_interval_minutes: number;
  work_start_time: string;
  work_end_time: string;
  slot_step_minutes?: number | null;
  payment_hold_minutes?: number | null;
  buffer_minutes?: number | null;
  max_bookings_per_day: number | null;
  send_sms: boolean;
  timezone: string;
}

interface WorkingHourRow {
  weekday: number;
  enabled: boolean;
  start_time: string;
  end_time: string;
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
    slotStepMinutes: number;
    paymentHoldMinutes: number;
    bufferMinutes: number;
    maxBookingsPerDay: number | null;
    sendSms: boolean;
    timezone: string;
    workingHours?: WorkingHourDay[];
  };
}

const LEGACY_SETTINGS_KEY = 'bookingSettings';

function mapHours(rows: WorkingHourRow[], fallback: SettingsRow): WorkingHourDay[] {
  if (rows.length === 0) {
    return [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      enabled: !(fallback.disabled_weekdays ?? []).includes(weekday),
      startTime: normalizeClock(fallback.work_start_time),
      endTime: normalizeClock(fallback.work_end_time),
    }));
  }

  return [...rows]
    .sort((left, right) => left.weekday - right.weekday)
    .map((row) => ({
      weekday: row.weekday,
      enabled: row.enabled,
      startTime: normalizeClock(row.start_time),
      endTime: normalizeClock(row.end_time),
    }));
}

function mapSettings(row: SettingsRow, disabledDates: string[], hours: WorkingHourDay[]): BookingSettings {
  return {
    firstDayOfWeek: row.first_day_of_week === 0 ? 0 : 1,
    disabledWeekdays: hours.filter((day) => !day.enabled).map((day) => day.weekday),
    disabledDates,
    minIntervalMinutes: row.min_interval_minutes,
    workStartTime: normalizeClock(row.work_start_time),
    workEndTime: normalizeClock(row.work_end_time),
    slotStepMinutes: row.slot_step_minutes ?? 30,
    paymentHoldMinutes: row.payment_hold_minutes ?? 15,
    bufferMinutes: row.buffer_minutes ?? 0,
    maxBookingsPerDay: row.max_bookings_per_day,
    sendSms: row.send_sms,
    timezone: row.timezone,
    workingHours: hours,
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
    slotStepMinutes: settings.slotStepMinutes ?? 30,
    paymentHoldMinutes: settings.paymentHoldMinutes ?? 15,
    bufferMinutes: settings.bufferMinutes ?? 0,
    maxBookingsPerDay: settings.maxBookingsPerDay,
    sendSms: settings.sendSms,
    timezone: settings.timezone,
    workingHours: settings.workingHours ?? [],
  };
}

export async function fetchBookingSettings(): Promise<BookingSettings> {
  const [{ data, error }, datesResult, hoursResult] = await Promise.all([
    supabase.from('booking_settings').select('*').eq('id', 1).single(),
    supabase.from('booking_disabled_dates').select('disabled_date').order('disabled_date'),
    supabase.from('working_hours').select('weekday, enabled, start_time, end_time').order('weekday'),
  ]);

  if (error || !data) throw error ?? new Error('SETTINGS_NOT_FOUND');
  if (datesResult.error) throw datesResult.error;
  if (hoursResult.error) throw hoursResult.error;

  const dates = ((datesResult.data ?? []) as DisabledDateRow[]).map((row) => row.disabled_date.slice(0, 10));
  const hours = mapHours((hoursResult.data ?? []) as WorkingHourRow[], data as SettingsRow);
  return mapSettings(data as SettingsRow, dates, hours);
}

export async function saveBookingSettings(settings: BookingSettings): Promise<BookingSettings> {
  const { data, error } = await supabase.rpc('save_booking_settings', {
    p_first_day_of_week: settings.firstDayOfWeek,
    p_disabled_dates: settings.disabledDates,
    p_max_bookings_per_day: settings.maxBookingsPerDay,
    p_send_sms: settings.sendSms,
    p_slot_step_minutes: settings.slotStepMinutes,
    p_payment_hold_minutes: settings.paymentHoldMinutes,
    p_buffer_minutes: settings.bufferMinutes,
    p_working_hours: settings.workingHours,
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
