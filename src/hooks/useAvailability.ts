import { useCallback, useEffect, useState } from 'react';
import { fetchAvailability, fetchMonthAvailability } from '../services/publicApi';
import { BookingApiError, type ApiErrorCode } from '../utils/errors';

export function useAvailability(date: string | null) {
  const [slots, setSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<ApiErrorCode | null>(null);

  const refresh = useCallback(async () => {
    if (!date) {
      setSlots([]);
      setErrorCode(null);
      return;
    }

    setLoading(true);
    try {
      const result = await fetchAvailability(date);
      setSlots(result.availableSlots ?? []);
      setErrorCode(null);
    } catch (error) {
      setSlots([]);
      setErrorCode(error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR');
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { slots, loading, errorCode, refresh };
}

export function useMonthAvailability(month: string | null) {
  const [days, setDays] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!month) return;
    setLoading(true);
    try {
      const result = await fetchMonthAvailability(month);
      setDays(result.days ?? {});
    } catch {
      setDays({});
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { days, loading, refresh };
}
