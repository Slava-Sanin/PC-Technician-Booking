export type SubscriptionStatus = 'pending_payment' | 'active' | 'expired' | 'cancelled' | 'failed';
export type RefundStatus = 'none' | 'refunded' | 'failed';

export interface SubscriptionPlan {
  monthlyPrice: number;
  currency: string;
  enabled: boolean;
}

export interface DiscountTier {
  minMonths: number;
  discountPercent: number;
}

export interface TechnicianSubscription {
  id: string;
  userId: string;
  months: number;
  monthlyPrice: number;
  discountPercent: number;
  amountTotal: number;
  currency: string;
  status: SubscriptionStatus;
  startsAt: string | null;
  endsAt: string | null;
  cancelledAt: string | null;
  paidAt: string | null;
  refundAmount: number | null;
  refundStatus: RefundStatus;
  provider: string;
  lowProfileId: string | null;
  transactionId: string | null;
  refundTransactionId: string | null;
  cardLast4: string | null;
  createdAt: string;
}

export interface RefundQuote {
  refundAmount: number;
  totalDays: number;
  remainingDays: number;
}

export interface SubscriptionState {
  role: 'admin' | 'technician';
  active: boolean;
  exempt: boolean;
  hasAccess: boolean;
  paymentAvailable: boolean;
  plan: SubscriptionPlan;
  discounts: DiscountTier[];
  subscription: TechnicianSubscription | null;
  refundQuote: RefundQuote | null;
}

export interface SubscriptionQuote {
  months: number;
  monthlyPrice: number;
  discountPercent: number;
  amountTotal: number;
  currency: string;
  enabled: boolean;
}

export interface AdminSubscriptionItem extends TechnicianSubscription {
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

export type PayoutMethod = 'bank' | 'card';

export interface PayoutProfile {
  payoutMethod: PayoutMethod;
  bankName: string | null;
  branch: string | null;
  accountNumber: string | null;
  beneficiary: string | null;
  iban: string | null;
  swift: string | null;
  cardHolder: string | null;
  cardLast4: string | null;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  cardStored: boolean;
  updatedAt: string | null;
}

export interface PayoutProfileInput {
  payoutMethod: PayoutMethod;
  bank: {
    bankName: string;
    branch: string;
    accountNumber: string;
    beneficiary: string;
    iban: string;
    swift: string;
  };
  card: {
    holder: string;
    number?: string;
    expMonth: number | null;
    expYear: number | null;
    clear?: boolean;
  };
}
