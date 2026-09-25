import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { BookingSettings } from '../../types/bookingSettings';
import { BUSINESS_TIME_ZONE, todayISOInTimeZone } from '../../utils/dateTime';

interface BookingSettingsModalProps {
  settings: BookingSettings;
  canEdit: boolean;
  saving: boolean;
  legacyAvailable: boolean;
  onClose: () => void;
  onSave: (settings: BookingSettings) => Promise<void>;
  onImportLegacy: () => BookingSettings | null;
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function BookingSettingsModal({
  settings,
  canEdit,
  saving,
  legacyAvailable,
  onClose,
  onSave,
  onImportLegacy,
}: BookingSettingsModalProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(settings);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  const update = (patch: Partial<BookingSettings>) => {
    if (!canEdit) return;
    setDraft((current) => ({ ...current, ...patch }));
  };

  const handleSave = async () => {
    if (draft.workEndTime <= draft.workStartTime) {
      toast.error(t('workEndTimeError'));
      return;
    }
    if (draft.minIntervalMinutes < 30 || draft.minIntervalMinutes > 1440) {
      toast.error(t('error_INVALID_INPUT'));
      return;
    }
    await onSave(draft);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-6 py-4 flex items-center relative">
          <h3 className="text-xl font-bold flex-1 text-center">{t('settings')}</h3>
          <button type="button" onClick={onClose} className="text-gray-500 hover:text-gray-700 absolute end-6">
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <p className="text-sm text-gray-600">{t('settingsSharedHint')}</p>
          {!canEdit && <p className="text-sm text-amber-700">{t('settingsReadOnly')}</p>}

          {legacyAvailable && canEdit && (
            <div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <p>{t('importLocalSettingsHint')}</p>
              <button
                type="button"
                className="mt-2 px-3 py-1 bg-blue-600 text-white rounded-md"
                onClick={() => {
                  const imported = onImportLegacy();
                  if (imported) setDraft(imported);
                }}
              >
                {t('importLocalSettings')}
              </button>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('timezoneLabel')}</label>
            <input value={draft.timezone} readOnly className="w-full rounded-md border border-gray-300 px-3 py-2 bg-gray-50" />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('firstDayOfWeek')}</label>
            <select
              disabled={!canEdit}
              value={draft.firstDayOfWeek}
              onChange={(event) => update({ firstDayOfWeek: Number(event.target.value) === 0 ? 0 : 1 })}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            >
              <option value={0}>{t('sunday')}</option>
              <option value={1}>{t('monday')}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('disabledWeekdays')}</label>
            <div className="space-y-2">
              {WEEKDAYS.map((day) => (
                <label key={day} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={draft.disabledWeekdays.includes(day)}
                    onChange={(event) => {
                      const disabledWeekdays = event.target.checked
                        ? [...draft.disabledWeekdays, day]
                        : draft.disabledWeekdays.filter((value) => value !== day);
                      update({ disabledWeekdays });
                    }}
                  />
                  <span>{t(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][day])}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('disabledDates')}</label>
            <div className="space-y-2">
              {draft.disabledDates.map((date, index) => (
                <div key={`${date}-${index}`} className="flex items-center gap-2">
                  <input
                    type="date"
                    disabled={!canEdit}
                    value={date}
                    onChange={(event) => {
                      const disabledDates = [...draft.disabledDates];
                      disabledDates[index] = event.target.value;
                      update({ disabledDates: disabledDates.filter(Boolean) });
                    }}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2"
                  />
                  <button
                    type="button"
                    disabled={!canEdit}
                    onClick={() => update({ disabledDates: draft.disabledDates.filter((_, itemIndex) => itemIndex !== index) })}
                    className="px-3 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    {t('remove')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={!canEdit}
                onClick={() => update({ disabledDates: [...draft.disabledDates, todayISOInTimeZone(draft.timezone || BUSINESS_TIME_ZONE)] })}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {t('addDate')}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('minIntervalMinutes')}</label>
            <input
              type="number"
              min={30}
              max={1440}
              step={30}
              disabled={!canEdit}
              value={draft.minIntervalMinutes}
              onChange={(event) => update({ minIntervalMinutes: Number(event.target.value) })}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('workHours')}</label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-xs text-gray-600">
                {t('workStartTime')}
                <input
                  type="time"
                  disabled={!canEdit}
                  value={draft.workStartTime}
                  onChange={(event) => update({ workStartTime: event.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block text-xs text-gray-600">
                {t('workEndTime')}
                <input
                  type="time"
                  disabled={!canEdit}
                  value={draft.workEndTime}
                  onChange={(event) => update({ workEndTime: event.target.value })}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2"
                />
              </label>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                disabled={!canEdit}
                checked={draft.maxBookingsPerDay !== null}
                onChange={(event) => update({ maxBookingsPerDay: event.target.checked ? draft.maxBookingsPerDay ?? 10 : null })}
              />
              {t('enableLimit')}
            </label>
            {draft.maxBookingsPerDay !== null && (
              <input
                type="number"
                min={1}
                max={100}
                disabled={!canEdit}
                value={draft.maxBookingsPerDay}
                onChange={(event) => update({ maxBookingsPerDay: Number(event.target.value) })}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2"
              />
            )}
            <p className="mt-1 text-sm text-gray-600">{t('maxBookingsPerDay')}</p>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={draft.sendSms}
              onChange={(event) => update({ sendSms: event.target.checked })}
            />
            <span>
              <span className="font-medium">{t('sendSMS')}</span>
              <span className="block text-gray-600">{t('sendSMSDescription')}</span>
            </span>
          </label>

          {canEdit && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="rounded-md bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? t('saving') : t('saveSettings')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
