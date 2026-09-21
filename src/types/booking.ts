export const BOOKING_STATUSES = [
  'new',
  'confirmed',
  'assigned',
  'on_the_way',
  'in_progress',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export interface Booking {
  id: string;
  booking_number: string;
  first_name: string;
  last_name: string;
  phone: string;
  address: string;
  city: string | null;
  operating_system: string;
  comments: string | null;
  appointment_date: string;
  created_at: string;
  updated_at: string | null;
  completed: boolean;
  status: BookingStatus;
  technician_notes: string | null;
  deleted_at: string | null;
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
