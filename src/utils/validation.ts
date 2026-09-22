import type { CreateBookingRequest } from '../types/api';
import { OPERATING_SYSTEMS, SERVICE_MODES } from '../types/catalog';

const OPERATING_SYSTEM_SET = new Set<string>(OPERATING_SYSTEMS);
const SERVICE_MODE_SET = new Set<string>(SERVICE_MODES);

export function normalizePhone(input: string): string | null {
  let digits = input.trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('00')) {
    digits = `+${digits.slice(2)}`;
  } else if (/^0\d+$/.test(digits)) {
    digits = `+972${digits.slice(1)}`;
  } else if (/^[1-9]\d+$/.test(digits)) {
    digits = `+${digits}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(digits)) return null;
  return digits;
}

export interface BookingValidationRules {
  requiresAddress: boolean;
  requiresCity: boolean;
  requiresDevice: boolean;
  requiresOperatingSystem: boolean;
}

const DEFAULT_RULES: BookingValidationRules = {
  requiresAddress: true,
  requiresCity: false,
  requiresDevice: false,
  requiresOperatingSystem: true,
};

export function getBookingValidationIssue(
  input: CreateBookingRequest,
  rules: BookingValidationRules = DEFAULT_RULES,
): string | null {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const address = input.address.trim();
  const city = input.city.trim();
  const email = input.email.trim();
  const comments = input.comments.trim();
  const problem = input.problemDescription.trim();
  const operatingSystem = input.operatingSystem.trim().toLowerCase();

  if (firstName.length < 1 || firstName.length > 80) return 'firstName';
  if (lastName.length < 1 || lastName.length > 80) return 'lastName';
  if (address.length > 200 || (rules.requiresAddress && address.length < 1)) return 'address';
  if (city.length > 80 || (rules.requiresCity && city.length < 1)) return 'city';
  if (comments.length > 1000 || problem.length > 2000) return 'comments';
  if (email.length > 120) return 'email';
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'email';
  if (!SERVICE_MODE_SET.has(input.serviceMode)) return 'serviceMode';
  if (!OPERATING_SYSTEM_SET.has(operatingSystem)) return 'operatingSystem';
  if (rules.requiresOperatingSystem && operatingSystem === 'not_applicable') return 'operatingSystem';
  if (rules.requiresDevice && input.deviceType.trim().length < 1) return 'deviceType';
  if (!Array.isArray(input.serviceIds) || input.serviceIds.length < 1 || input.serviceIds.length > 12) return 'serviceIds';
  if (!normalizePhone(input.phone)) return 'phone';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.appointmentDate)) return 'appointmentDate';
  if (!/^\d{2}:\d{2}$/.test(input.appointmentTime)) return 'appointmentTime';
  return null;
}

export function validateBookingInput(
  input: CreateBookingRequest,
  rules: BookingValidationRules = DEFAULT_RULES,
): boolean {
  return getBookingValidationIssue(input, rules) == null;
}
