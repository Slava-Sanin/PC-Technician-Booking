import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LogIn } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { BrandLogo } from '../BrandLogo';
import { SiteHeader } from '../SiteHeader';
import { AdminWorkspace } from './AdminWorkspace';
import { useBookingSettings } from '../../hooks/useBookingSettings';
import { useBookings } from '../../hooks/useBookings';
import { fetchMyProfile, isActiveStaff } from '../../services/profileService';
import { loginStaff } from '../../services/staffAuthService';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import type { StaffProfile } from '../../types/bookingSettings';
import { Button } from '../ui';

interface AdminViewProps {
  onCloseAdmin: () => void;
}

type Access = 'loading' | 'anonymous' | 'staff';

export function AdminView({ onCloseAdmin }: AdminViewProps) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<Access>('loading');
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const accessRequest = useRef(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [staffEmail, setStaffEmail] = useState<string | null>(null);

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
        setStaffEmail(null);
        setAccess('anonymous');
        return;
      }
      try {
        const nextProfile = await fetchMyProfile();
        if (accessRequest.current !== requestId) return;
        if (isActiveStaff(nextProfile)) {
          setProfile(nextProfile);
          const { data: userData } = await supabase.auth.getUser();
          setStaffEmail(userData.user?.email ?? null);
          setAccess('staff');
          return;
        }
        setProfile(null);
        setStaffEmail(null);
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
        const { data: userData } = await supabase.auth.getUser();
        setStaffEmail(userData.user?.email ?? null);
        setAccess('staff');
      } catch {
        if (accessRequest.current !== requestId) return;
        toast.error(t('fetchError'));
        setProfile(null);
        setStaffEmail(null);
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
      setStaffEmail(null);
      setAccess('anonymous');
    } catch {
      toast.error(t('logoutError'));
    }
  };

  const handleGoToBooking = async () => {
    if (staff && profile) {
      try {
        accessRequest.current += 1;
        await supabase.auth.signOut();
        setProfile(null);
        setStaffEmail(null);
        setAccess('anonymous');
      } catch {
        toast.error(t('logoutError'));
        return;
      }
    }
    onCloseAdmin();
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
      <div className="flex min-h-screen flex-col bg-canvas">
        <Toaster position="top-right" />
        <SiteHeader
          area="admin"
          customer={null}
          staff={null}
          onCustomerAccount={() => onCloseAdmin()}
          onCustomerBookings={() => onCloseAdmin()}
          onCustomerLogout={() => {}}
          onStaffAdmin={() => {}}
          onStaffLogout={() => {}}
          onGoToBooking={() => onCloseAdmin()}
        />
        <div className="flex flex-1 items-center justify-center px-4 py-12">
        <form className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card" onSubmit={(event) => void handleLogin(event)}>
          <div className="flex flex-col items-center gap-3">
            <BrandLogo className="h-24 w-auto object-contain sm:h-28" />
            <h2 className="text-center text-2xl font-semibold">{t('loginTitle')}</h2>
          </div>
          <p className="text-center text-sm text-muted">{t('loginSubtitle')}</p>
          <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('email')} className="w-full rounded-lg border border-line px-3 py-2" />
          <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('password')} className="w-full rounded-lg border border-line px-3 py-2" />
          <Button className="w-full" disabled={loginLoading}><LogIn className="h-4 w-4" />{loginLoading ? t('loggingIn') : t('login')}</Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => onCloseAdmin()}><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('backToBooking')}</Button>
        </form>
        </div>
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
      <SiteHeader
        area="admin"
        customer={null}
        staff={profile}
        staffEmail={staffEmail}
        onCustomerAccount={() => void handleGoToBooking()}
        onCustomerBookings={() => void handleGoToBooking()}
        onCustomerLogout={() => {}}
        onStaffAdmin={() => {}}
        onStaffLogout={() => void handleLogout()}
        onGoToBooking={() => void handleGoToBooking()}
      />
      <AdminWorkspace profile={profile} bookingsState={bookingsState} settingsState={settingsState} />
    </div>
  );
}
