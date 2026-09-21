export interface CreateBookingRequest {
  firstName: string;
  lastName: string;
  phone: string;
  address: string;
  city: string;
  operatingSystem: string;
  comments: string;
  appointmentDate: string;
  appointmentTime: string;
  locale: 'ru' | 'he' | 'en';
}

export interface CreateBookingResponse {
  bookingCreated: true;
  bookingNumber: string;
  smsSent: boolean;
  smsSkipped: boolean;
  appointmentDate: string;
  appointmentTime: string;
}

export interface AvailabilityResponse {
  date: string;
  timezone: string;
  availableSlots: string[];
}

export interface MonthAvailabilityResponse {
  month: string;
  timezone: string;
  days: Record<string, string[]>;
}
