import { describe, expect, it } from 'vitest';
import type { PublicService } from '../types/catalog';
import {
  allowedModes,
  enabledPaymentMethod,
  isPublicService,
  paymentStepMode,
  sharedPaymentMethods,
} from './catalogRules';

function service(patch: Partial<PublicService>): PublicService {
  return {
    id: 'svc',
    code: 'wifi',
    name: { ru: 'Wi-Fi', he: 'Wi-Fi', en: 'Wi-Fi' },
    description: { ru: null, he: null, en: null },
    durationMinutes: 60,
    price: 180,
    priceType: 'fixed',
    currency: 'ILS',
    modes: ['onsite'],
    requiresDevice: true,
    requiresOperatingSystem: false,
    paymentPolicy: 'after_service',
    sortOrder: 1,
    paymentMethods: [],
    ...patch,
  };
}

describe('public catalog and payment rules', () => {
  it('hides a service when it or its category is inactive or archived', () => {
    const visible = { active: true, archivedAt: null };
    expect(isPublicService(visible, visible)).toBe(true);
    expect(isPublicService({ active: false, archivedAt: null }, visible)).toBe(false);
    expect(isPublicService(visible, { active: false, archivedAt: null })).toBe(false);
    expect(isPublicService({ active: true, archivedAt: '2026-01-01' }, visible)).toBe(false);
  });

  it('keeps service visibility independent from the category switch', () => {
    const nas = { active: false, archivedAt: null };
    const categoryOff = { active: false, archivedAt: null };
    const categoryOn = { active: true, archivedAt: null };
    expect(isPublicService(nas, categoryOff)).toBe(false);
    expect(nas.active).toBe(false);
    expect(isPublicService(nas, categoryOn)).toBe(false);
  });

  it('filters payment methods and decides when the payment step appears', () => {
    expect(enabledPaymentMethod({ active: true, archivedAt: null }, true)).toBe(true);
    expect(enabledPaymentMethod({ active: false, archivedAt: null }, true)).toBe(false);
    expect(enabledPaymentMethod({ active: true, archivedAt: null }, false)).toBe(false);

    const bit = {
      code: 'bit',
      name: { ru: 'Bit', he: 'Bit', en: 'Bit' },
      integrationType: 'manual' as const,
      instructions: { ru: null, he: null, en: null },
      externalUrl: null,
      sortOrder: 1,
    };
    const card = { ...bit, code: 'credit_card', integrationType: 'automatic' as const };
    const remote = service({
      paymentPolicy: 'required_before_booking',
      modes: ['remote'],
      paymentMethods: [bit, card],
    });
    const visit = service({
      id: 'visit',
      paymentPolicy: 'after_service',
      paymentMethods: [bit],
    });

    expect(sharedPaymentMethods([remote, visit]).map((method) => method.code)).toEqual(['bit']);
    expect(allowedModes([remote, visit])).toEqual([]);
    expect(paymentStepMode(['required_before_booking'])).toBe('required');
    expect(paymentStepMode(['optional', 'after_service'])).toBe('optional');
    expect(paymentStepMode(['none', 'after_service'])).toBe('skip');
  });
});
