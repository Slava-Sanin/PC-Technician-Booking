import type { LocalizedText, ServiceMode } from './catalog';

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

export const BOOKING_STATUSES = [
  'new',
  'pending_payment',
  'confirmed',
  'assigned',
  'on_the_way',
  'in_progress',
  'waiting_for_parts',
  'waiting_for_customer',
  'completed',
  'cancelled',
  'no_show',
  'payment_expired',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface BookingServiceLine {
  id: string;
  service_id: string | null;
  service_name_snapshot: LocalizedText;
  duration_minutes: number;
  unit_price: number | null;
  price_type_snapshot: string;
  quantity: number;
  total_price: number | null;
  currency: string;
}

export interface Booking {
  id: string;
  booking_number: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  address: string;
  city: string | null;
  operating_system: string;
  service_mode: ServiceMode | null;
  device_type: string | null;
  device_brand: string | null;
  device_model: string | null;
  problem_description: string | null;
  comments: string | null;
  appointment_date: string;
  appointment_start: string | null;
  appointment_end: string | null;
  created_at: string;
  updated_at: string | null;
  completed: boolean;
  status: BookingStatus;
  technician_notes: string | null;
  deleted_at: string | null;
  subtotal: number | null;
  total_amount: number | null;
  currency: string | null;
  payment_status: string | null;
  payment_expires_at: string | null;
  booking_services?: BookingServiceLine[];
}

export type EditableBookingField =
  | 'appointment_date'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'email'
  | 'city'
  | 'address'
  | 'service_mode'
  | 'operating_system'
  | 'device_type'
  | 'device_brand'
  | 'device_model'
  | 'problem_description'
  | 'comments'
  | 'technician_notes'
  | 'payment_status'
  | 'total_amount'
  | 'currency';

export interface BookingUpdate {
  first_name?: string;
  last_name?: string;
  phone?: string;
  email?: string | null;
  address?: string;
  city?: string | null;
  service_mode?: ServiceMode | null;
  operating_system?: string;
  device_type?: string | null;
  device_brand?: string | null;
  device_model?: string | null;
  problem_description?: string | null;
  comments?: string | null;
  technician_notes?: string | null;
  appointment_date?: string;
  payment_status?: PaymentStatus | null;
  subtotal?: number | null;
  total_amount?: number | null;
  currency?: string | null;
  status?: BookingStatus;
  deleted_at?: string | null;
}
