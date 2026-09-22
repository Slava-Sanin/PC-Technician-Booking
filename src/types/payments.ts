export const PAYMENT_STATUSES = [
  'pending',
  'awaiting_verification',
  'paid',
  'failed',
  'expired',
  'cancelled',
  'refunded',
  'partially_refunded',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export interface PaymentRecord {
  id: string;
  booking_id: string;
  payment_method_id: string | null;
  provider: string | null;
  provider_payment_id: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  expires_at: string | null;
  refunded_at: string | null;
}

export interface BankTransferProfile {
  id: number;
  bank_name: string | null;
  branch: string | null;
  account_number: string | null;
  beneficiary: string | null;
  iban: string | null;
  instructions_ru: string | null;
  instructions_he: string | null;
  instructions_en: string | null;
}
