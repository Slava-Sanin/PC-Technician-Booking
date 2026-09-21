import { describe, expect, it } from 'vitest';
import type { CreateBookingRequest } from '../types/api';
import { normalizePhone, validateBookingInput } from './validation';

const validRequest: CreateBookingRequest = {
  firstName: 'Anna',
  lastName: 'Cohen',
  phone: '050-123-4567',
  address: 'Herzl 1',
  city: 'Haifa',
  operatingSystem: 'windows',
  comments: '',
  appointmentDate: '2026-09-25',
  appointmentTime: '14:00',
  locale: 'en',
};

describe('booking validation', () => {
  it('normalizes an Israeli local mobile number to E.164', () => {
    expect(normalizePhone('050-123-4567')).toBe('+972501234567');
    expect(normalizePhone('+972501234567')).toBe('+972501234567');
  });

  it('rejects empty required fields and unknown systems', () => {
    expect(validateBookingInput(validRequest)).toBe(true);
    expect(validateBookingInput({ ...validRequest, firstName: '   ' })).toBe(false);
    expect(validateBookingInput({ ...validRequest, phone: '123' })).toBe(false);
    expect(validateBookingInput({ ...validRequest, operatingSystem: 'android' })).toBe(false);
    expect(validateBookingInput({ ...validRequest, appointmentTime: '9:00' })).toBe(false);
  });
});
