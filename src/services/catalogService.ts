import { supabase } from '../lib/supabase';
import type { PaymentPolicy, PriceType } from '../types/catalog';
import type { BankTransferProfile, PaymentRecord } from '../types/payments';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';

export interface CategoryRow {
  id: string;
  code: string;
  name_ru: string;
  name_he: string;
  name_en: string;
  description_ru: string | null;
  description_he: string | null;
  description_en: string | null;
  icon: string | null;
  active: boolean;
  sort_order: number;
  archived_at: string | null;
}

export interface ServiceRow {
  id: string;
  category_id: string;
  code: string;
  name_ru: string;
  name_he: string;
  name_en: string;
  description_ru: string | null;
  description_he: string | null;
  description_en: string | null;
  default_duration_minutes: number;
  price: number | null;
  price_type: PriceType;
  currency: string;
  onsite_available: boolean;
  remote_available: boolean;
  workshop_available: boolean;
  requires_device: boolean;
  requires_operating_system: boolean;
  payment_policy: PaymentPolicy;
  active: boolean;
  sort_order: number;
  archived_at: string | null;
}

export interface PaymentMethodRow {
  id: string;
  code: string;
  name_ru: string;
  name_he: string;
  name_en: string;
  integration_type: 'automatic' | 'external_link' | 'manual';
  instructions_ru: string | null;
  instructions_he: string | null;
  instructions_en: string | null;
  external_url: string | null;
  active: boolean;
  sort_order: number;
  archived_at: string | null;
}

export interface ServicePaymentLink {
  service_id: string;
  payment_method_id: string;
  enabled: boolean;
}

export interface StaffRow {
  user_id: string;
  role: 'admin' | 'technician';
  active: boolean;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
}

export interface StaffProfileInput {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface ServiceDraft {
  nameRu: string;
  nameHe: string;
  nameEn: string;
  descriptionRu?: string;
  descriptionHe?: string;
  descriptionEn?: string;
  durationMinutes: number;
  price: number | null;
  priceType: PriceType;
  currency: string;
  onsiteAvailable: boolean;
  remoteAvailable: boolean;
  workshopAvailable: boolean;
  requiresDevice: boolean;
  requiresOperatingSystem: boolean;
  paymentPolicy: PaymentPolicy;
  active: boolean;
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function normalizeService(row: ServiceRow): ServiceRow {
  return { ...row, price: asNumber(row.price) };
}

async function expectOk(data: unknown, error: { message?: string } | null): Promise<void> {
  if (error) throw error;
  const payload = data as { ok?: boolean; code?: string } | null;
  if (!payload?.ok) throw new BookingApiError(normalizeErrorCode(payload?.code));
}

export async function fetchAdminCatalog(): Promise<{
  categories: CategoryRow[];
  services: ServiceRow[];
  methods: PaymentMethodRow[];
  links: ServicePaymentLink[];
}> {
  const [categories, services, methods, links] = await Promise.all([
    supabase.from('service_categories').select('*').order('sort_order'),
    supabase.from('services').select('*').order('sort_order'),
    supabase.from('payment_methods').select('*').order('sort_order'),
    supabase.from('service_payment_methods').select('*'),
  ]);
  if (categories.error) throw categories.error;
  if (services.error) throw services.error;
  if (methods.error) throw methods.error;
  if (links.error) throw links.error;
  return {
    categories: (categories.data ?? []) as CategoryRow[],
    services: ((services.data ?? []) as ServiceRow[]).map(normalizeService),
    methods: (methods.data ?? []) as PaymentMethodRow[],
    links: (links.data ?? []) as ServicePaymentLink[],
  };
}

export async function createCategoryWithServices(input: {
  nameRu: string;
  nameHe: string;
  nameEn: string;
  descriptionRu: string;
  descriptionHe: string;
  descriptionEn: string;
  icon: string;
  active: boolean;
  services: ServiceDraft[];
}): Promise<void> {
  const { data, error } = await supabase.rpc('admin_create_category', {
    p_payload: {
      nameRu: input.nameRu,
      nameHe: input.nameHe,
      nameEn: input.nameEn,
      descriptionRu: input.descriptionRu,
      descriptionHe: input.descriptionHe,
      descriptionEn: input.descriptionEn,
      icon: input.icon,
      active: input.active,
      services: input.services,
    },
  });
  await expectOk(data, error);
}

export async function updateCategory(id: string, patch: Partial<CategoryRow>): Promise<void> {
  const { error } = await supabase.from('service_categories').update(patch).eq('id', id);
  if (error) throw error;
}

export async function insertService(row: {
  category_id: string;
  code: string;
  name_ru: string;
  name_he: string;
  name_en: string;
  description_ru: string | null;
  description_he: string | null;
  description_en: string | null;
  default_duration_minutes: number;
  price: number | null;
  price_type: PriceType;
  currency: string;
  onsite_available: boolean;
  remote_available: boolean;
  workshop_available: boolean;
  requires_device: boolean;
  requires_operating_system: boolean;
  payment_policy: PaymentPolicy;
  active: boolean;
  sort_order: number;
}): Promise<void> {
  const { data, error } = await supabase.from('services').insert(row).select('id').single();
  if (error || !data) throw error ?? new Error('INSERT_FAILED');
  const serviceId = (data as { id: string }).id;
  const methods = await supabase.from('payment_methods').select('id');
  if (methods.error) throw methods.error;
  const links = ((methods.data ?? []) as Array<{ id: string }>).map((method) => ({
    service_id: serviceId,
    payment_method_id: method.id,
    enabled: true,
  }));
  if (links.length > 0) {
    const linked = await supabase.from('service_payment_methods').insert(links);
    if (linked.error) throw linked.error;
  }
}

export async function updateService(id: string, patch: Partial<ServiceRow>): Promise<void> {
  const { error } = await supabase.from('services').update(patch).eq('id', id);
  if (error) throw error;
}

export async function setServicePaymentMethod(serviceId: string, methodId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('service_payment_methods').upsert({
    service_id: serviceId,
    payment_method_id: methodId,
    enabled,
  });
  if (error) throw error;
}

export async function updatePaymentMethod(id: string, patch: Partial<PaymentMethodRow>): Promise<void> {
  const { error } = await supabase.from('payment_methods').update(patch).eq('id', id);
  if (error) throw error;
}

export async function fetchBankProfile(): Promise<BankTransferProfile | null> {
  const { data, error } = await supabase.from('bank_transfer_profiles').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return (data as BankTransferProfile | null) ?? null;
}

export async function saveBankProfile(profile: Omit<BankTransferProfile, 'id'>): Promise<void> {
  const { error } = await supabase.from('bank_transfer_profiles').update(profile).eq('id', 1);
  if (error) throw error;
}

export interface PaymentListItem extends PaymentRecord {
  bookings: { booking_number: string; first_name: string; last_name: string; phone: string } | null;
  payment_methods: { code: string; name_ru: string; name_he: string; name_en: string } | null;
}

export async function fetchPayments(): Promise<PaymentListItem[]> {
  const { data, error } = await supabase
    .from('payments')
    .select('*, bookings(booking_number, first_name, last_name, phone), payment_methods(code, name_ru, name_he, name_en)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PaymentListItem[]).map((row) => ({ ...row, amount: asNumber(row.amount) ?? 0 }));
}

export async function reviewPayment(paymentId: string, decision: 'paid' | 'failed'): Promise<void> {
  const { data, error } = await supabase.rpc('review_manual_payment', {
    p_payment_id: paymentId,
    p_decision: decision,
  });
  await expectOk(data, error);
}

export async function fetchStaff(): Promise<StaffRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, role, active, email, first_name, last_name, phone, address')
    .order('created_at');
  if (error) throw error;
  return (data ?? []) as StaffRow[];
}

function readFunctionErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const value = (payload as { error?: unknown }).error;
  return typeof value === 'string' ? value : null;
}

async function invokeStaffFunction(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('admin-set-staff', { body });
  if (error) {
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === 'function') {
      try {
        const payload = await context.json();
        const code = readFunctionErrorCode(payload);
        if (code) throw new BookingApiError(normalizeErrorCode(code));
      } catch (parseError) {
        if (parseError instanceof BookingApiError) throw parseError;
      }
    }

    const direct = readFunctionErrorCode(data);
    if (direct) throw new BookingApiError(normalizeErrorCode(direct));
    throw new BookingApiError('INTERNAL_ERROR');
  }

  const payload = data as { ok?: boolean; code?: string } | null;
  if (payload?.ok !== true) {
    throw new BookingApiError(normalizeErrorCode(payload?.code));
  }
}

export async function setStaff(
  email: string,
  role: 'admin' | 'technician',
  active: boolean,
  password?: string,
  profile?: StaffProfileInput,
): Promise<void> {
  const body: Record<string, unknown> = {
    email,
    role,
    active,
    firstName: profile?.firstName ?? null,
    lastName: profile?.lastName ?? null,
    phone: profile?.phone ?? null,
    address: profile?.address ?? null,
  };
  if (password?.trim()) body.password = password.trim();
  await invokeStaffFunction(body);
}

export function slugCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}
