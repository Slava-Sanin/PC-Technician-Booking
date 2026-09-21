export interface PublicBookingConfig {
  firstDayOfWeek: 0 | 1;
  disabledWeekdays: number[];
  disabledDates: string[];
  workStartTime: string;
  workEndTime: string;
  minIntervalMinutes: number;
  maxBookingsPerDay: number | null;
  timezone: string;
}

export interface BookingSettings extends PublicBookingConfig {
  sendSms: boolean;
}

export interface StaffProfile {
  userId: string;
  role: 'admin' | 'technician';
  active: boolean;
}
