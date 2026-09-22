import { describe, expect, it } from 'vitest';
import type { CreateBookingRequest } from '../types/api';
import { getBookingValidationIssue, normalizePhone, validateBookingInput } from './validation';

const validRequest: CreateBookingRequest = {
  firstName: 'Anna',
  lastName: 'Cohen',
  phone: '050-123-4567',
  email: '',
  address: 'Herzl 1',
  city: 'Haifa',
  serviceMode: 'onsite',
  deviceType: 'laptop',
  operatingSystem: 'windows',
  deviceBrand: '',
  deviceModel: '',
  problemDescription: '',
  comments: '',
  appointmentDate: '2026-09-25',
  appointmentTime: '14:00',
  serviceIds: ['11111111-1111-1111-1111-111111111111'],
  paymentMethodCode: '',
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
    expect(validateBookingInput({ ...validRequest, serviceIds: [] })).toBe(false);
  });

  it('requires address and allows an empty city for any service mode', () => {
    expect(getBookingValidationIssue({ ...validRequest, city: '' })).toBeNull();
    expect(validateBookingInput({ ...validRequest, city: '' })).toBe(true);
    expect(validateBookingInput({ ...validRequest, address: '' })).toBe(false);
    expect(validateBookingInput(
      { ...validRequest, serviceMode: 'remote', address: 'Zoom', city: '' },
      { requiresAddress: true, requiresCity: false, requiresDevice: true, requiresOperatingSystem: true },
    )).toBe(true);
    expect(validateBookingInput(
      { ...validRequest, serviceMode: 'workshop', address: '', city: 'Haifa' },
      { requiresAddress: true, requiresCity: false, requiresDevice: false, requiresOperatingSystem: true },
    )).toBe(false);
  });
});
