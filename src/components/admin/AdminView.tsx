import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LogIn } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { BrandLogo } from '../BrandLogo';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { AdminWorkspace } from './AdminWorkspace';
import { useBookingSettings } from '../../hooks/useBookingSettings';
import { useBookings } from '../../hooks/useBookings';
import { fetchMyProfile, isActiveStaff } from '../../services/profileService';
import { loginStaff } from '../../services/staffAuthService';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import type { StaffProfile } from '../../types/bookingSettings';
import { Button } from '../ui';

interface AdminViewProps {
  onLogout: () => void;
}

type Access = 'loading' | 'anonymous' | 'staff';

export function AdminView({ onLogout }: AdminViewProps) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<Access>('loading');
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const accessRequest = useRef(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const staff = access === 'staff';
  const bookingsState = useBookings(staff);
  const settingsState = useBookingSettings(staff);

  useEffect(() => {
    const requestId = ++accessRequest.current;
    const loadSession = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (accessRequest.current !== requestId) return;
      if (error || !data.session) {
        setProfile(null);
        setAccess('anonymous');
        return;
      }
      try {
        const nextProfile = await fetchMyProfile();
        if (accessRequest.current !== requestId) return;
        if (isActiveStaff(nextProfile)) {
          setProfile(nextProfile);
          setAccess('staff');
          return;
        }
        setProfile(null);
        setAccess('anonymous');
      } catch {
        if (accessRequest.current !== requestId) return;
        toast.error(t('fetchError'));
        setProfile(null);
        setAccess('anonymous');
      }
    };
    void loadSession();
  }, [t]);

  useEffect(() => {
    if (bookingsState.error || settingsState.error) toast.error(t('fetchError'));
  }, [bookingsState.error, settingsState.error, t]);

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoginLoading(true);
    try {
      await loginStaff(email, password);
      const requestId = ++accessRequest.current;
      setAccess('loading');
      try {
        const nextProfile = await fetchMyProfile();
        if (accessRequest.current !== requestId) return;
        if (!isActiveStaff(nextProfile)) {
          await supabase.auth.signOut();
          toast.error(t('invalidCredentials'));
          setProfile(null);
          setAccess('anonymous');
          return;
        }
        setProfile(nextProfile);
        setAccess('staff');
      } catch {
        if (accessRequest.current !== requestId) return;
        toast.error(t('fetchError'));
        setProfile(null);
        setAccess('anonymous');
      }
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
      toast.error(t(errorI18nKey(code)));
      setProfile(null);
      setAccess('anonymous');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      accessRequest.current += 1;
      await supabase.auth.signOut();
      setProfile(null);
      setAccess('anonymous');
      onLogout();
    } catch {
      toast.error(t('logoutError'));
    }
  };

  if (access === 'loading' || (staff && !bookingsState.loaded)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (access === 'anonymous') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12">
        <Toaster position="top-right" />
        <div className="fixed top-4 end-4"><LanguageSwitcher /></div>
        <form className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card" onSubmit={(event) => void handleLogin(event)}>
          <div className="flex flex-col items-center gap-3">
            <BrandLogo className="h-24 w-auto object-contain sm:h-28" />
            <h2 className="text-center text-2xl font-semibold">{t('loginTitle')}</h2>
          </div>
          <p className="text-center text-sm text-muted">{t('loginSubtitle')}</p>
          <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('email')} className="w-full rounded-lg border border-line px-3 py-2" />
          <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('password')} className="w-full rounded-lg border border-line px-3 py-2" />
          <Button className="w-full" disabled={loginLoading}><LogIn className="h-4 w-4" />{loginLoading ? t('loggingIn') : t('login')}</Button>
          <Button type="button" variant="ghost" className="w-full" onClick={onLogout}><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('backToBooking')}</Button>
        </form>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <Toaster position="top-right" />
      <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandLogo className="h-16 w-auto shrink-0 object-contain sm:h-20" />
          <h1 className="truncate text-lg font-semibold">{t('adminTitle')}</h1>
        </div>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Button variant="ghost" onClick={() => void handleLogout()}>{t('logout')}</Button>
        </div>
      </header>
      <AdminWorkspace profile={profile} bookingsState={bookingsState} settingsState={settingsState} />
    </div>
  );
}
