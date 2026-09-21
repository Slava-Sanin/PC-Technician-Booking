import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LogIn, Settings } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { BookingSettingsModal } from './BookingSettingsModal';
import { BookingTable } from './BookingTable';
import { useBookingSettings } from '../../hooks/useBookingSettings';
import { useBookings } from '../../hooks/useBookings';
import { fetchMyProfile, isActiveStaff } from '../../services/profileService';
import type { StaffProfile } from '../../types/bookingSettings';
import type { BookingStatus, EditableBookingField } from '../../types/booking';
import { BOOKING_STATUSES } from '../../types/booking';
import { BUSINESS_TIME_ZONE } from '../../utils/dateTime';
import { BookingApiError, errorI18nKey } from '../../utils/errors';

interface AdminViewProps {
  onLogout: () => void;
}

const FIELD_MESSAGE: Partial<Record<EditableBookingField, string>> = {
  appointment_date: 'appointmentDateUpdated',
  first_name: 'firstNameUpdated',
  last_name: 'lastNameUpdated',
  phone: 'phoneUpdated',
  city: 'cityUpdated',
  address: 'addressUpdated',
  operating_system: 'operatingSystemUpdated',
  comments: 'commentsUpdated',
  technician_notes: 'notesUpdated',
};

export function AdminView({ onLogout }: AdminViewProps) {
  const { t } = useTranslation();
  const [authLoading, setAuthLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const staff = isActiveStaff(profile);
  const bookingsState = useBookings(staff);
  const settingsState = useBookingSettings(staff);

  useEffect(() => {
    const loadSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setAuthenticated(false);
        setProfile(null);
        setAuthLoading(false);
        return;
      }

      setAuthenticated(true);
      try {
        setProfile(await fetchMyProfile());
      } catch {
        toast.error(t('fetchError'));
      } finally {
        setAuthLoading(false);
      }
    };

    void loadSession();
  }, [t]);

  useEffect(() => {
    if (bookingsState.error || settingsState.error) {
      toast.error(t('fetchError'));
    }
  }, [bookingsState.error, settingsState.error, t]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message === 'Invalid login credentials' ? t('invalidCredentials') : t('loginError'));
        return;
      }
      setAuthenticated(true);
      setProfile(await fetchMyProfile());
    } catch {
      toast.error(t('loginError'));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut();
      setAuthenticated(false);
      setProfile(null);
      onLogout();
    } catch {
      toast.error(t('logoutError'));
    }
  };

  const handleField = async (id: string, field: EditableBookingField, value: string) => {
    try {
      await bookingsState.saveField(id, field, value);
      toast.success(t(FIELD_MESSAGE[field] ?? 'fieldUpdated'));
    } catch {
      toast.error(t('updateError'));
    }
  };

  const handleStatus = async (id: string, status: BookingStatus) => {
    try {
      await bookingsState.saveStatus(id, status);
      toast.success(t('statusUpdated'));
    } catch {
      toast.error(t('updateError'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return;
    try {
      await bookingsState.remove(id);
      toast.success(t('bookingDeleted'));
    } catch {
      toast.error(t('deleteError'));
    }
  };

  if (authLoading || (staff && !bookingsState.loaded)) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12 px-4">
        <Toaster position="top-right" />
        <div className="fixed top-4 end-4">
          <LanguageSwitcher />
        </div>
        <div className="max-w-md w-full space-y-8">
          <div>
            <h2 className="text-center text-3xl font-extrabold text-gray-900">{t('loginTitle')}</h2>
            <p className="mt-2 text-center text-sm text-gray-600">{t('loginSubtitle')}</p>
          </div>
          <form className="space-y-6" onSubmit={(event) => void handleLogin(event)}>
            <div className="rounded-md shadow-sm -space-y-px">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t('email')}
                disabled={loginLoading}
                className="appearance-none rounded-t-md relative block w-full px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={t('password')}
                disabled={loginLoading}
                className="appearance-none rounded-b-md relative block w-full px-3 py-2 border border-gray-300 text-gray-900 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={loginLoading}
              className="relative w-full flex justify-center py-2 px-4 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              <LogIn className="h-5 w-5 absolute start-3" />
              {loginLoading ? t('loggingIn') : t('login')}
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="relative w-full flex justify-center py-2 px-4 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
            >
              <ArrowLeft className="h-5 w-5 absolute start-3" />
              {t('backToBooking')}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!staff) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <Toaster position="top-right" />
        <div className="max-w-md w-full bg-white shadow rounded-lg p-6 text-center space-y-4">
          <h2 className="text-2xl font-bold text-gray-900">{t('insufficientPermissions')}</h2>
          <button type="button" onClick={() => void handleLogout()} className="px-4 py-2 bg-red-600 text-white rounded-md">
            {t('logout')}
          </button>
          <button type="button" onClick={onLogout} className="block w-full px-4 py-2 border border-gray-300 rounded-md">
            {t('backToBooking')}
          </button>
        </div>
      </div>
    );
  }

  const timeZone = settingsState.settings?.timezone || BUSINESS_TIME_ZONE;

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" />
      <div className="sticky top-0 z-10 bg-gray-50">
        <div className="w-full px-4 py-4 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-bold flex-1 text-center">{t('adminTitle')}</h2>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (!settingsState.settings) {
                  toast.error(t('fetchError'));
                  return;
                }
                setShowSettings(true);
              }}
              className="px-3 py-1 rounded text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 flex items-center gap-2"
            >
              <Settings className="w-4 h-4" />
              {t('settings')}
            </button>
            <LanguageSwitcher />
            <button type="button" onClick={() => void handleLogout()} className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-md">
              {t('logout')}
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 pb-4 flex flex-wrap gap-3 items-center">
        <label className="text-sm text-gray-700 flex items-center gap-2">
          {t('filterStatus')}
          <select
            value={bookingsState.statusFilter}
            onChange={(event) => bookingsState.setStatusFilter(event.target.value as BookingStatus | 'all')}
            className="border rounded px-2 py-1"
          >
            <option value="all">{t('allStatuses')}</option>
            {BOOKING_STATUSES.map((status) => (
              <option key={status} value={status}>{t(`status_${status}`)}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => bookingsState.setIncludeDeleted(!bookingsState.includeDeleted)}
          className="px-3 py-1 text-sm border rounded bg-white hover:bg-gray-100"
        >
          {bookingsState.includeDeleted ? t('hideDeleted') : t('showDeleted')}
        </button>
      </div>

      <div className="px-1 pb-8">
        <BookingTable
          bookings={bookingsState.bookings}
          timeZone={timeZone}
          onUpdateField={handleField}
          onUpdateStatus={handleStatus}
          onDelete={handleDelete}
        />
      </div>

      {showSettings && settingsState.settings && (
        <BookingSettingsModal
          settings={settingsState.settings}
          canEdit={profile?.role === 'admin' && profile.active}
          saving={settingsState.saving}
          legacyAvailable={settingsState.legacyAvailable}
          onClose={() => setShowSettings(false)}
          onImportLegacy={settingsState.importLegacyDraft}
          onSave={async (next) => {
            try {
              await settingsState.save(next);
              toast.success(t('settingsSaved'));
              setShowSettings(false);
            } catch (error) {
              const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
              toast.error(t(errorI18nKey(code)));
            }
          }}
        />
      )}
    </div>
  );
}
