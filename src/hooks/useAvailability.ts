import { useCallback, useEffect, useState } from 'react';
import { fetchAvailability, fetchMonthAvailability } from '../services/publicApi';
import type { AvailabilityQuery } from '../types/api';
import { BookingApiError, type ApiErrorCode } from '../utils/errors';

export function useAvailability(date: string | null, query: AvailabilityQuery | null) {
  const [slots, setSlots] = useState<string[]>([]);
  const [durationMinutes, setDurationMinutes] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<ApiErrorCode | null>(null);
  const refresh = useCallback(async () => {
    if (!date || !query || query.serviceIds.length === 0) {
      setSlots([]);
      setDurationMinutes(0);
      setErrorCode(null);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchAvailability(date, query);
      setSlots(result.availableSlots ?? []);
      setDurationMinutes(result.durationMinutes ?? 0);
      setErrorCode(null);
    } catch (error) {
      setSlots([]);
      setErrorCode(error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR');
    } finally {
      setLoading(false);
    }
  }, [date, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { slots, durationMinutes, loading, errorCode, refresh };
}

export function useMonthAvailability(month: string | null, query: AvailabilityQuery | null) {
  const [days, setDays] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!month || !query || query.serviceIds.length === 0) {
      setDays({});
      return;
    }
    setLoading(true);
    try {
      const result = await fetchMonthAvailability(month, query);
      setDays(result.days ?? {});
    } catch {
      setDays({});
    } finally {
      setLoading(false);
    }
  }, [month, query]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { days, loading, refresh };
}
