export interface WorkingHourDay {
  weekday: number;
  enabled: boolean;
  startTime: string;
  endTime: string;
}

export interface PublicBookingConfig {
  firstDayOfWeek: 0 | 1;
  disabledWeekdays: number[];
  disabledDates: string[];
  workStartTime: string;
  workEndTime: string;
  minIntervalMinutes: number;
  slotStepMinutes: number;
  paymentHoldMinutes: number;
  bufferMinutes: number;
  maxBookingsPerDay: number | null;
  timezone: string;
  workingHours: WorkingHourDay[];
}

export interface BookingSettings extends PublicBookingConfig {
  sendSms: boolean;
}

export interface StaffProfile {
  userId: string;
  role: 'admin' | 'technician';
  active: boolean;
}
