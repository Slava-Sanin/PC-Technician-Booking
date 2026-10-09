/** Short token that looks like a house number (not a settlement name). */
export function isHouseNumber(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 12) return false;
  return /^\d[\d/a-zA-Zא-ת.-]*$/.test(trimmed);
}

/** Puts house number after street when it was stored before the street name. */
export function formatAddressLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';

  const commaFirst = trimmed.match(/^(\d[\d/a-zA-Zא-ת.-]*)\s*,\s*(.+)$/);
  if (commaFirst) {
    return `${commaFirst[2].trim()} ${commaFirst[1].trim()}`.trim();
  }

  const spaceFirst = trimmed.match(/^(\d[\d/a-zA-Zא-ת.-]*)\s+(\S.+)$/);
  if (spaceFirst) {
    return `${spaceFirst[2].trim()} ${spaceFirst[1].trim()}`.trim();
  }

  return trimmed;
}

export function formatBookingLocation(
  city: string | null | undefined,
  address: string | null | undefined,
): string {
  const cityPart = city?.trim() ?? '';
  const addressPart = address?.trim() ?? '';
  if (!cityPart && !addressPart) return '';

  if (cityPart && isHouseNumber(cityPart) && addressPart) {
    return `${formatAddressLine(addressPart)} ${cityPart}`.trim();
  }

  const streetLine = formatAddressLine(addressPart);
  if (cityPart && !isHouseNumber(cityPart)) {
    return streetLine ? `${cityPart}, ${streetLine}` : cityPart;
  }

  return streetLine || cityPart;
}
