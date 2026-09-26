import { supabase } from '../lib/supabase';
import type {
  AvailabilityQuery,
  AvailabilityResponse,
  BookingConfirmationRequestResponse,
  CreateBookingRequest,
  CreateBookingResponse,
  MonthAvailabilityResponse,
} from '../types/api';
import type { CatalogResponse, LocalizedText, PublicCategory, PublicPaymentMethod, PublicService } from '../types/catalog';
import type { PublicBookingConfig } from '../types/bookingSettings';
import { PRICE_TYPES, SERVICE_MODES, type PriceType, type ServiceMode } from '../types/catalog';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const value = (payload as { error?: unknown }).error;
  return typeof value === 'string' ? value : null;
}

async function invokePublicFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
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

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asText(value: unknown): LocalizedText {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    ru: typeof record.ru === 'string' ? record.ru : null,
    he: typeof record.he === 'string' ? record.he : null,
    en: typeof record.en === 'string' ? record.en : null,
  };
}

function asMode(value: unknown): ServiceMode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ServiceMode => typeof item === 'string' && SERVICE_MODES.includes(item as ServiceMode));
}

function asPriceType(value: unknown): PriceType {
  return typeof value === 'string' && PRICE_TYPES.includes(value as PriceType) ? value as PriceType : 'fixed';
}

function normalizeCatalog(payload: CatalogResponse): CatalogResponse {
  const categories = (payload.categories ?? []).map((category): PublicCategory => ({
    id: category.id,
    code: category.code,
    name: asText(category.name),
    description: asText(category.description),
    icon: category.icon ?? null,
    sortOrder: category.sortOrder ?? 0,
    services: (category.services ?? []).map((service): PublicService => ({
      id: service.id,
      code: service.code,
      name: asText(service.name),
      description: asText(service.description),
      durationMinutes: asNumber(service.durationMinutes) ?? 60,
      price: asNumber(service.price),
      priceType: asPriceType(service.priceType),
      currency: service.currency || 'ILS',
      modes: asMode(service.modes),
      requiresDevice: Boolean(service.requiresDevice),
      requiresOperatingSystem: Boolean(service.requiresOperatingSystem),
      paymentPolicy: service.paymentPolicy,
      sortOrder: service.sortOrder ?? 0,
      paymentMethods: (service.paymentMethods ?? []).map((method): PublicPaymentMethod => ({
        code: method.code,
        name: asText(method.name),
        integrationType: method.integrationType,
        instructions: asText(method.instructions),
        externalUrl: method.externalUrl ?? null,
        sortOrder: method.sortOrder ?? 0,
      })),
    })),
  }));

  return { categories };
}

export async function fetchPublicBookingConfig(): Promise<PublicBookingConfig> {
  const config = await invokePublicFunction<PublicBookingConfig>('get-booking-config', {});
  return {
    ...config,
    slotStepMinutes: config.slotStepMinutes ?? 30,
    paymentHoldMinutes: config.paymentHoldMinutes ?? 15,
    bufferMinutes: config.bufferMinutes ?? 0,
    workingHours: config.workingHours ?? [],
    disabledWeekdays: config.disabledWeekdays ?? [],
    disabledDates: config.disabledDates ?? [],
  };
}

export function fetchServiceCatalog(): Promise<CatalogResponse> {
  return invokePublicFunction<CatalogResponse>('get-service-catalog', {}).then(normalizeCatalog);
}

export function fetchAvailability(date: string, query: AvailabilityQuery): Promise<AvailabilityResponse> {
  return invokePublicFunction<AvailabilityResponse>('get-availability', {
    date,
    serviceIds: query.serviceIds,
    serviceMode: query.serviceMode,
  });
}

export function fetchMonthAvailability(month: string, query: AvailabilityQuery): Promise<MonthAvailabilityResponse> {
  return invokePublicFunction<MonthAvailabilityResponse>('get-availability', {
    month,
    serviceIds: query.serviceIds,
    serviceMode: query.serviceMode,
  });
}

async function bookingAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function invokeBookingFunction<T>(body: Record<string, unknown>): Promise<T> {
  const headers = await bookingAuthHeaders();
  const { data, error } = await supabase.functions.invoke('create-booking', { body, headers });
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

export function requestBookingConfirmation(
  request: CreateBookingRequest,
  confirmChannel: 'email' | 'sms',
): Promise<BookingConfirmationRequestResponse> {
  return invokeBookingFunction<BookingConfirmationRequestResponse>({
    phase: 'request',
    confirmChannel,
    ...request,
  });
}

export function confirmBooking(
  confirmationId: string,
  code: string,
): Promise<CreateBookingResponse> {
  return invokeBookingFunction<CreateBookingResponse>({
    phase: 'confirm',
    confirmationId,
    code,
  });
}
