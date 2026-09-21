import type { CreateBookingRequest } from '../types/api';

const OPERATING_SYSTEMS = new Set(['windows', 'linux', 'macos']);

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

export function validateBookingInput(input: CreateBookingRequest): boolean {
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const address = input.address.trim();
  const city = input.city.trim();
  const comments = input.comments.trim();

  if (firstName.length < 1 || firstName.length > 80) return false;
  if (lastName.length < 1 || lastName.length > 80) return false;
  if (address.length < 1 || address.length > 200) return false;
  if (city.length > 80) return false;
  if (comments.length > 1000) return false;
  if (!OPERATING_SYSTEMS.has(input.operatingSystem.trim().toLowerCase())) return false;
  if (!normalizePhone(input.phone)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.appointmentDate)) return false;
  if (!/^\d{2}:\d{2}$/.test(input.appointmentTime)) return false;
  return true;
}
