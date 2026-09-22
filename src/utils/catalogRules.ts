import type { PaymentPolicy, PublicPaymentMethod, PublicService, ServiceMode } from '../types/catalog';

export type PaymentStepMode = 'required' | 'optional' | 'skip';

const UPFRONT: PaymentPolicy[] = ['required_before_booking', 'deposit'];

export function paymentStepMode(policies: PaymentPolicy[]): PaymentStepMode {
  if (policies.some((policy) => UPFRONT.includes(policy))) return 'required';
  if (policies.some((policy) => policy === 'optional')) return 'optional';
  return 'skip';
}

export function allowedModes(services: PublicService[]): ServiceMode[] {
  const modes: ServiceMode[] = ['onsite', 'remote', 'workshop'];
  return modes.filter((mode) => services.length > 0 && services.every((service) => service.modes.includes(mode)));
}

export function sharedPaymentMethods(services: PublicService[]): PublicPaymentMethod[] {
  if (services.length === 0) return [];
  const [first, ...rest] = services;
  return first.paymentMethods.filter((method) =>
    rest.every((service) => service.paymentMethods.some((candidate) => candidate.code === method.code)),
  );
}

export interface CatalogVisibility {
  active: boolean;
  archivedAt: string | null;
}

export function isPublicCategory(category: CatalogVisibility): boolean {
  return category.active && category.archivedAt == null;
}

export function isPublicService(service: CatalogVisibility, category: CatalogVisibility): boolean {
  return service.active && service.archivedAt == null && isPublicCategory(category);
}

export function enabledPaymentMethod<T extends { active: boolean; archivedAt?: string | null }>(
  method: T,
  linkEnabled: boolean,
): boolean {
  return method.active && method.archivedAt == null && linkEnabled;
}
