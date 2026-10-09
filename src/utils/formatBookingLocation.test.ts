import { describe, expect, it } from 'vitest';
import { formatAddressLine, formatBookingLocation, isHouseNumber } from './formatBookingLocation';

describe('isHouseNumber', () => {
  it('detects numeric house numbers', () => {
    expect(isHouseNumber('166')).toBe(true);
    expect(isHouseNumber('12a')).toBe(true);
    expect(isHouseNumber('Haifa')).toBe(false);
    expect(isHouseNumber('שדה נחום')).toBe(false);
  });
});

describe('formatAddressLine', () => {
  it('moves a leading house number after the street', () => {
    expect(formatAddressLine('166 גוב')).toBe('גוב 166');
    expect(formatAddressLine('1 Herzl')).toBe('Herzl 1');
    expect(formatAddressLine('166, שדה נחום')).toBe('שדה נחום 166');
  });

  it('keeps street-first lines unchanged', () => {
    expect(formatAddressLine('Herzl 1')).toBe('Herzl 1');
    expect(formatAddressLine('שדה נחום 166')).toBe('שדה נחום 166');
  });
});

describe('formatBookingLocation', () => {
  it('fixes house number stored in the city field', () => {
    expect(formatBookingLocation('166', 'שדה נחום')).toBe('שדה נחום 166');
  });

  it('shows settlement before street line', () => {
    expect(formatBookingLocation('Haifa', 'Herzl 1')).toBe('Haifa, Herzl 1');
    expect(formatBookingLocation('Haifa', '1 Herzl')).toBe('Haifa, Herzl 1');
  });
});
