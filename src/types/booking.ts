import type { LocalizedText, ServiceMode } from './catalog';

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
  | 'city'
  | 'address'
  | 'operating_system'
  | 'comments'
  | 'technician_notes';

export interface BookingUpdate {
  first_name?: string;
  last_name?: string;
  phone?: string;
  address?: string;
  city?: string | null;
  operating_system?: string;
  comments?: string | null;
  technician_notes?: string | null;
  appointment_date?: string;
  status?: BookingStatus;
  deleted_at?: string | null;
}
