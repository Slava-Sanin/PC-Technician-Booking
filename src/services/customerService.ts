import { supabase } from '../lib/supabase';
import type { Booking, BookingUpdate } from '../types/booking';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';

export interface CustomerProfile {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  phoneVerified: boolean;
}

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const value = (payload as { error?: unknown }).error;
  return typeof value === 'string' ? value : null;
}

async function invokeCustomer<T>(name: string, body: Record<string, unknown>, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new BookingApiError('UNAUTHORIZED');
    headers.Authorization = `Bearer ${token}`;
  }

  const { data, error } = await supabase.functions.invoke(name, { body, headers });
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

export async function startCustomerRegistration(input: {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  password: string;
  verifyChannel: 'email' | 'sms';
}): Promise<{ challengeId: string; maskedTarget: string; channel: 'email' | 'sms'; linkStaffAuth?: boolean }> {
  return invokeCustomer('customer-auth', { action: 'registerStart', ...input });
}

export async function verifyCustomerRegistration(input: {
  challengeId: string;
  code?: string;
  token?: string;
}): Promise<void> {
  const result = await invokeCustomer<{ session?: { access_token?: string; refresh_token?: string } }>(
    'customer-auth',
    { action: 'registerVerify', ...input },
  );
  if (result.session?.access_token && result.session.refresh_token) {
    await supabase.auth.setSession({
      access_token: result.session.access_token,
      refresh_token: result.session.refresh_token,
    });
  }
}

export async function loginCustomer(identifier: string, password: string): Promise<void> {
  const result = await invokeCustomer<{ session?: { access_token?: string; refresh_token?: string } }>(
    'customer-auth',
    { action: 'login', identifier, password },
  );
  if (!result.session?.access_token || !result.session.refresh_token) {
    throw new BookingApiError('INTERNAL_ERROR');
  }
  const { error } = await supabase.auth.setSession({
    access_token: result.session.access_token,
    refresh_token: result.session.refresh_token,
  });
  if (error) throw new BookingApiError('INTERNAL_ERROR');
}

export async function fetchCustomerProfile(): Promise<CustomerProfile | null> {
  const result = await invokeCustomer<{ customer?: Record<string, unknown> }>('customer-auth', { action: 'me' }, true);
  const customer = result.customer;
  if (!customer || customer.ok !== true) return null;
  return {
    id: String(customer.id),
    email: typeof customer.email === 'string' ? customer.email : null,
    phone: typeof customer.phone === 'string' ? customer.phone : null,
    firstName: String(customer.firstName ?? ''),
    lastName: String(customer.lastName ?? ''),
    emailVerified: Boolean(customer.emailVerified),
    phoneVerified: Boolean(customer.phoneVerified),
  };
}

export async function logoutCustomer(): Promise<void> {
  await supabase.auth.signOut();
}

export async function fetchCustomerBookings(): Promise<Booking[]> {
  const result = await invokeCustomer<{ bookings?: Booking[] }>('customer-bookings', { action: 'list' }, true);
  return result.bookings ?? [];
}

export async function cancelCustomerBooking(bookingId: string): Promise<Booking> {
  const result = await invokeCustomer<{ booking: Booking }>('customer-bookings', { action: 'cancel', bookingId }, true);
  return result.booking;
}

export async function updateCustomerBooking(bookingId: string, patch: BookingUpdate): Promise<Booking> {
  const result = await invokeCustomer<{ booking: Booking }>(
    'customer-bookings',
    { action: 'update', bookingId, ...patch },
    true,
  );
  return result.booking;
}
