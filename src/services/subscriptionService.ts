import { supabase } from '../lib/supabase';
import type {
  AdminSubscriptionItem,
  DiscountTier,
  PayoutProfile,
  PayoutProfileInput,
  SubscriptionQuote,
  SubscriptionState,
  TechnicianSubscription,
} from '../types/subscription';
import { BookingApiError, normalizeErrorCode } from '../utils/errors';

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
  const value = (payload as { error?: unknown }).error;
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
  return fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = asNumber(value, Number.NaN);
  return Number.isNaN(parsed) ? null : parsed;
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

async function invokeSubscription<T>(body: Record<string, unknown>): Promise<T> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new BookingApiError('UNAUTHORIZED');

  const { data, error } = await supabase.functions.invoke('technician-subscription', {
    body,
    headers: { Authorization: `Bearer ${token}` },
  });
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

function mapSubscription(raw: unknown): TechnicianSubscription | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  return {
    id: String(row.id),
    userId: String(row.userId),
    months: asNumber(row.months, 1),
    monthlyPrice: asNumber(row.monthlyPrice),
    discountPercent: asNumber(row.discountPercent),
    amountTotal: asNumber(row.amountTotal),
    currency: typeof row.currency === 'string' ? row.currency : 'ILS',
    status: (row.status as TechnicianSubscription['status']) ?? 'failed',
    startsAt: asText(row.startsAt),
    endsAt: asText(row.endsAt),
    cancelledAt: asText(row.cancelledAt),
    paidAt: asText(row.paidAt),
    refundAmount: asNullableNumber(row.refundAmount),
    refundStatus: (row.refundStatus as TechnicianSubscription['refundStatus']) ?? 'none',
    provider: typeof row.provider === 'string' ? row.provider : 'cardcom',
    lowProfileId: asText(row.lowProfileId),
    transactionId: asText(row.transactionId),
    refundTransactionId: asText(row.refundTransactionId),
    cardLast4: asText(row.cardLast4),
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
  };
}

function mapDiscounts(raw: unknown): DiscountTier[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const tier = item as Record<string, unknown>;
      return { minMonths: asNumber(tier.minMonths), discountPercent: asNumber(tier.discountPercent) };
    })
    .filter((tier) => tier.minMonths >= 1)
    .sort((left, right) => left.minMonths - right.minMonths);
}

function mapState(raw: Record<string, unknown>): SubscriptionState {
  const plan = (raw.plan ?? {}) as Record<string, unknown>;
  const refund = raw.refundQuote && typeof raw.refundQuote === 'object' ? raw.refundQuote as Record<string, unknown> : null;
  return {
    role: raw.role === 'admin' ? 'admin' : 'technician',
    active: raw.active === true,
    exempt: raw.exempt === true,
    hasAccess: raw.hasAccess === true,
    paymentAvailable: raw.paymentAvailable === true,
    plan: {
      monthlyPrice: asNumber(plan.monthlyPrice),
      currency: typeof plan.currency === 'string' ? plan.currency : 'ILS',
      enabled: plan.enabled !== false,
    },
    discounts: mapDiscounts(raw.discounts),
    subscription: mapSubscription(raw.subscription),
    refundQuote: refund
      ? {
          refundAmount: asNumber(refund.refundAmount),
          totalDays: asNumber(refund.totalDays),
          remainingDays: asNumber(refund.remainingDays),
        }
      : null,
  };
}

export async function fetchSubscriptionState(): Promise<SubscriptionState> {
  const raw = await invokeSubscription<Record<string, unknown>>({ action: 'state' });
  return mapState(raw);
}

export async function syncSubscription(): Promise<SubscriptionState> {
  const raw = await invokeSubscription<Record<string, unknown>>({ action: 'sync' });
  return mapState(raw);
}

export async function abandonSubscriptionCheckout(): Promise<SubscriptionState> {
  const raw = await invokeSubscription<Record<string, unknown>>({ action: 'abandon' });
  return mapState(raw);
}

export async function quoteSubscription(months: number): Promise<SubscriptionQuote> {
  const raw = await invokeSubscription<Record<string, unknown>>({ action: 'quote', months });
  return {
    months: asNumber(raw.months, months),
    monthlyPrice: asNumber(raw.monthlyPrice),
    discountPercent: asNumber(raw.discountPercent),
    amountTotal: asNumber(raw.amountTotal),
    currency: typeof raw.currency === 'string' ? raw.currency : 'ILS',
    enabled: raw.enabled !== false,
  };
}

export async function createSubscriptionCheckout(months: number, language: string): Promise<{ url: string; subscriptionId: string }> {
  const raw = await invokeSubscription<{ url?: string; subscriptionId?: string }>({
    action: 'createCheckout',
    months,
    language: language.startsWith('he') ? 'he' : language.startsWith('ru') ? 'ru' : 'en',
  });
  if (!raw.url || !raw.subscriptionId) throw new BookingApiError('PAYMENT_FAILED');
  return { url: raw.url, subscriptionId: raw.subscriptionId };
}

export interface CancelSubscriptionResult {
  state: SubscriptionState;
  refundAmount: number;
  refundStatus: 'none' | 'refunded' | 'failed';
}

export async function cancelSubscription(): Promise<CancelSubscriptionResult> {
  const raw = await invokeSubscription<Record<string, unknown>>({ action: 'cancel' });
  return {
    state: mapState(raw),
    refundAmount: asNumber(raw.refundAmount),
    refundStatus: raw.refundStatus === 'refunded' || raw.refundStatus === 'failed' ? raw.refundStatus : 'none',
  };
}

// ---------------------------------------------------------------------------
// Direct RPC (RLS/is_admin enforced in PostgreSQL)
// ---------------------------------------------------------------------------

async function rpcJson<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  const payload = data as { ok?: boolean; code?: string } | null;
  if (!payload?.ok) throw new BookingApiError(normalizeErrorCode(payload?.code));
  return payload as T;
}

export async function fetchMySubscriptionState(): Promise<Omit<SubscriptionState, 'paymentAvailable'>> {
  const raw = await rpcJson<Record<string, unknown>>('get_my_subscription');
  const mapped = mapState(raw);
  return mapped;
}

export async function adminListSubscriptions(): Promise<AdminSubscriptionItem[]> {
  const raw = await rpcJson<{ items?: unknown[] }>('admin_list_subscriptions');
  return (raw.items ?? [])
    .map((item) => {
      const base = mapSubscription(item);
      if (!base) return null;
      const row = item as Record<string, unknown>;
      return {
        ...base,
        email: asText(row.email),
        firstName: asText(row.firstName),
        lastName: asText(row.lastName),
        phone: asText(row.phone),
      } satisfies AdminSubscriptionItem;
    })
    .filter((item): item is AdminSubscriptionItem => item !== null);
}

export async function adminSaveSubscriptionPlan(input: { monthlyPrice: number; currency: string; enabled: boolean }): Promise<void> {
  await rpcJson('admin_save_subscription_plan', {
    p_monthly_price: input.monthlyPrice,
    p_currency: input.currency,
    p_enabled: input.enabled,
  });
}

export async function adminSaveSubscriptionDiscounts(tiers: DiscountTier[]): Promise<DiscountTier[]> {
  const raw = await rpcJson<{ discounts?: unknown }>('admin_save_subscription_discounts', { p_tiers: tiers });
  return mapDiscounts(raw.discounts);
}

function mapPayoutProfile(raw: Record<string, unknown>): PayoutProfile {
  return {
    payoutMethod: raw.payoutMethod === 'card' ? 'card' : 'bank',
    bankName: asText(raw.bankName),
    branch: asText(raw.branch),
    accountNumber: asText(raw.accountNumber),
    beneficiary: asText(raw.beneficiary),
    iban: asText(raw.iban),
    swift: asText(raw.swift),
    cardHolder: asText(raw.cardHolder),
    cardLast4: asText(raw.cardLast4),
    cardExpMonth: asNullableNumber(raw.cardExpMonth),
    cardExpYear: asNullableNumber(raw.cardExpYear),
    cardStored: raw.cardStored === true,
    updatedAt: asText(raw.updatedAt),
  };
}

export async function adminGetPayoutProfile(): Promise<PayoutProfile> {
  const raw = await rpcJson<Record<string, unknown>>('admin_get_payout_profile');
  return mapPayoutProfile(raw);
}

export async function adminSavePayoutProfile(input: PayoutProfileInput): Promise<PayoutProfile> {
  const card: Record<string, unknown> = {
    holder: input.card.holder,
    expMonth: input.card.expMonth,
    expYear: input.card.expYear,
  };
  if (input.card.number && input.card.number.trim()) card.number = input.card.number;
  if (input.card.clear) card.clear = true;

  const raw = await rpcJson<Record<string, unknown>>('admin_save_payout_profile', {
    p_payout_method: input.payoutMethod,
    p_bank: input.bank,
    p_card: card,
  });
  return mapPayoutProfile(raw);
}

export async function adminRevealPayoutCard(): Promise<string | null> {
  const raw = await rpcJson<{ cardNumber?: unknown }>('admin_reveal_payout_card');
  return asText(raw.cardNumber);
}
