import { useCallback, useEffect, useState } from 'react';
import {
  fetchBookingSettings,
  legacySettingsToDraft,
  readLegacyLocalSettings,
  saveBookingSettings,
} from '../services/settingsService';
import type { BookingSettings } from '../types/bookingSettings';

export function useBookingSettings(enabled: boolean) {
  const [settings, setSettings] = useState<BookingSettings | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [legacyAvailable, setLegacyAvailable] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setSettings(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      setSettings(await fetchBookingSettings());
      setLegacyAvailable(readLegacyLocalSettings() !== null);
      setError(false);
    } catch (caught) {
      setError(true);
      throw caught;
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const save = useCallback(async (next: BookingSettings) => {
    setSaving(true);
    try {
      const saved = await saveBookingSettings(next);
      setSettings(saved);
      setLegacyAvailable(false);
      return saved;
    } finally {
      setSaving(false);
    }
  }, []);

  const importLegacyDraft = useCallback((): BookingSettings | null => {
    if (!settings) return null;
    const legacy = readLegacyLocalSettings();
    if (!legacy) return null;
    return legacySettingsToDraft(settings, legacy);
  }, [settings]);

  return { settings, loading, saving, error, legacyAvailable, refresh, save, importLegacyDraft };
}
