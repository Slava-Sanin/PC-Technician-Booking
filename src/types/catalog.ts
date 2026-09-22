export const PRICE_TYPES = ['fixed', 'from', 'hourly', 'quote', 'diagnostic'] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

export const PAYMENT_POLICIES = [
  'none',
  'optional',
  'required_before_booking',
  'deposit',
  'required_before_service',
  'after_service',
] as const;
export type PaymentPolicy = (typeof PAYMENT_POLICIES)[number];

export const SERVICE_MODES = ['onsite', 'remote', 'workshop'] as const;
export type ServiceMode = (typeof SERVICE_MODES)[number];

export const DEVICE_TYPES = [
  'desktop',
  'laptop',
  'mac',
  'server',
  'printer',
  'router',
  'nas',
  'smart_home',
  'smartphone',
  'other',
] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export const OPERATING_SYSTEMS = [
  'windows',
  'macos',
  'linux',
  'chromeos',
  'other',
  'unknown',
  'not_applicable',
] as const;
export type OperatingSystem = (typeof OPERATING_SYSTEMS)[number];

export const INTEGRATION_TYPES = ['automatic', 'external_link', 'manual'] as const;
export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

export interface LocalizedText {
  ru: string | null;
  he: string | null;
  en: string | null;
}

export interface PublicPaymentMethod {
  code: string;
  name: LocalizedText;
  integrationType: IntegrationType;
  instructions: LocalizedText;
  externalUrl: string | null;
  sortOrder: number;
}

export interface PublicService {
  id: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  durationMinutes: number;
  price: number | null;
  priceType: PriceType;
  currency: string;
  modes: ServiceMode[];
  requiresDevice: boolean;
  requiresOperatingSystem: boolean;
  paymentPolicy: PaymentPolicy;
  sortOrder: number;
  paymentMethods: PublicPaymentMethod[];
}

export interface PublicCategory {
  id: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: string | null;
  sortOrder: number;
  services: PublicService[];
}

export interface CatalogResponse {
  categories: PublicCategory[];
}

export function localized(text: LocalizedText | null | undefined, locale: string): string {
  if (!text) return '';
  const language = locale.split('-')[0];
  if (language === 'he') return text.he || text.en || text.ru || '';
  if (language === 'en') return text.en || text.ru || text.he || '';
  return text.ru || text.en || text.he || '';
}
