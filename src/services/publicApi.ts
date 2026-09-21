import { supabase } from '../lib/supabase';
import type {
  AvailabilityResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  MonthAvailabilityResponse,
} from '../types/api';
import type { PublicBookingConfig } from '../types/bookingSettings';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const value = (payload as { error?: unknown }).error;
  return typeof value === 'string' ? value : null;
}

async function invokePublicFunction<T>(name: string, body: Record<string, string>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json();
        const code = readErrorCode(payload);
        if (code) throw new BookingApiError(normalizeErrorCode(code));
      } catch (parseError) {
        if (parseError instanceof BookingApiError) throw parseError;
      }
    }

    const direct = readErrorCode(data);
    if (direct) throw new BookingApiError(normalizeErrorCode(direct));
    throw new BookingApiError('INTERNAL_ERROR');
  }

  return data as T;
}

export function fetchPublicBookingConfig(): Promise<PublicBookingConfig> {
  return invokePublicFunction<PublicBookingConfig>('get-booking-config', {});
}

export function fetchAvailability(date: string): Promise<AvailabilityResponse> {
  return invokePublicFunction<AvailabilityResponse>('get-availability', { date });
}

export function fetchMonthAvailability(month: string): Promise<MonthAvailabilityResponse> {
  return invokePublicFunction<MonthAvailabilityResponse>('get-availability', { month });
}

export function createBooking(request: CreateBookingRequest): Promise<CreateBookingResponse> {
  return invokePublicFunction<CreateBookingResponse>('create-booking', { ...request });
}
