import type { ServiceMode } from './catalog';

export interface CreateBookingRequest {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  serviceMode: ServiceMode;
  deviceType: string;
  operatingSystem: string;
  deviceBrand: string;
  deviceModel: string;
  problemDescription: string;
  comments: string;
  appointmentDate: string;
  appointmentTime: string;
  serviceIds: string[];
  paymentMethodCode: string;
  locale: 'ru' | 'he' | 'en';
}

export interface BankInstructions {
  bankName: string | null;
  branch: string | null;
  account: string | null;
  beneficiary: string | null;
  iban: string | null;
  instructions: { ru: string | null; he: string | null; en: string | null };
}

export interface CreateBookingResponse {
  bookingCreated: true;
  bookingNumber: string;
  smsSent: boolean;
  smsSkipped: boolean;
  appointmentDate: string;
  appointmentTime: string;
  durationMinutes?: number;
  status?: string;
  currency?: string;
  totalAmount?: number | null;
  paymentRequired?: boolean;
  paymentStatus?: string | null;
  paymentExpiresAt?: string | null;
  paymentMethodCode?: string | null;
  externalUrl?: string | null;
  bankInstructions?: BankInstructions | null;
}

export interface AvailabilityResponse {
  date: string;
  timezone: string;
  durationMinutes: number;
  availableSlots: string[];
}

export interface MonthAvailabilityResponse {
  month: string;
  timezone: string;
  durationMinutes: number;
  days: Record<string, string[]>;
}

export interface AvailabilityQuery {
  serviceIds: string[];
  serviceMode: ServiceMode;
}
