export const API_ERROR_CODES = [
  'INVALID_INPUT',
  'SERVICE_UNAVAILABLE',
  'INVALID_SERVICE_MODE',
  'DATE_IN_PAST',
  'OUTSIDE_WORKING_HOURS',
  'DISABLED_DATE',
  'DISABLED_WEEKDAY',
  'SLOT_UNAVAILABLE',
  'DAILY_LIMIT_REACHED',
  'PAYMENT_REQUIRED',
  'PAYMENT_FAILED',
  'PAYMENT_EXPIRED',
  'RATE_LIMITED',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

const ERROR_CODE_SET = new Set<string>(API_ERROR_CODES);

export class BookingApiError extends Error {
  code: ApiErrorCode;

  constructor(code: ApiErrorCode) {
    super(code);
    this.name = 'BookingApiError';
    this.code = code;
  }
}

export function normalizeErrorCode(value: unknown): ApiErrorCode {
  if (typeof value === 'string' && ERROR_CODE_SET.has(value)) {
    return value as ApiErrorCode;
  }
  return 'INTERNAL_ERROR';
}

export function errorI18nKey(code: ApiErrorCode): string {
  return `error_${code}`;
}
