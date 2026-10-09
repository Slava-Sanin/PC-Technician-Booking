import type { Booking } from '../types/booking';
import { formatBookingLocation } from './formatBookingLocation';

export interface GeoPoint {
  lat: number;
  lng: number;
}

const cache = new Map<string, GeoPoint | null>();

const PHOTON_DELAY_MS = 350;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

export function bookingGeocodeQuery(booking: Pick<Booking, 'address' | 'city'>): string | null {
  const formatted = formatBookingLocation(booking.city, booking.address);
  if (!formatted) return null;
  return `${formatted}, Israel`;
}

async function geocodeQuery(query: string, signal?: AbortSignal): Promise<GeoPoint | null> {
  const key = query.toLowerCase();
  if (cache.has(key)) return cache.get(key) ?? null;

  const url = `https://photon.komoot.io/api/?${new URLSearchParams({ q: query, limit: '1' })}`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    cache.set(key, null);
    return null;
  }

  const payload = (await response.json()) as {
    features?: Array<{ geometry?: { coordinates?: [number, number] } }>;
  };
  const coords = payload.features?.[0]?.geometry?.coordinates;
  if (!coords || coords.length < 2) {
    cache.set(key, null);
    return null;
  }

  const point = { lng: coords[0], lat: coords[1] };
  cache.set(key, point);
  return point;
}

export async function geocodeBookingsSequential(
  queries: Array<{ id: string; query: string }>,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, GeoPoint>> {
  const result = new Map<string, GeoPoint>();
  const total = queries.length;

  for (let index = 0; index < queries.length; index += 1) {
    if (signal?.aborted) break;
    const item = queries[index];
    const cached = cache.get(item.query.toLowerCase());
    if (cached) {
      result.set(item.id, cached);
    } else {
      const point = await geocodeQuery(item.query, signal);
      if (point) result.set(item.id, point);
      if (index < queries.length - 1) await sleep(PHOTON_DELAY_MS, signal);
    }
    onProgress?.(index + 1, total);
  }

  return result;
}
