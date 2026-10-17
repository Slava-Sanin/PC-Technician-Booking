import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, LogIn, UserPlus } from 'lucide-react';
import { toast, Toaster } from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { BrandLogo } from '../BrandLogo';
import { SiteHeader } from '../SiteHeader';
import { AdminWorkspace } from './AdminWorkspace';
import { SubscriptionPanel, type SubscriptionReturn } from './SubscriptionPanel';
import { TechnicianRegisterForm } from './TechnicianRegisterForm';
import { useBookingSettings } from '../../hooks/useBookingSettings';
import { useBookings } from '../../hooks/useBookings';
import { fetchMyProfile, isActiveStaff, needsSubscription } from '../../services/profileService';
import { loginStaff, registerTechnicianVerify } from '../../services/staffAuthService';
import { fetchSubscriptionState } from '../../services/subscriptionService';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import type { StaffProfile } from '../../types/bookingSettings';
import { Button } from '../ui';

interface AdminViewProps {
  onCloseAdmin: () => void;
  /** `<challengeId>.<token>` from the registration email link. */
  staffRegisterToken?: string | null;
  /** Result of the Cardcom redirect (`?subscription=success|failed`). */
  subscriptionReturn?: SubscriptionReturn | null;
}

type Access = 'loading' | 'anonymous' | 'register' | 'subscription_required' | 'staff';

export function AdminView({ onCloseAdmin, staffRegisterToken = null, subscriptionReturn = null }: AdminViewProps) {
  const { t } = useTranslation();
  const [access, setAccess] = useState<Access>('loading');
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const accessRequest = useRef(0);
  const pendingReturn = useRef<SubscriptionReturn | null>(subscriptionReturn);
  const [panelReturn, setPanelReturn] = useState<SubscriptionReturn | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [staffEmail, setStaffEmail] = useState<string | null>(null);

  const staff = access === 'staff';
  const bookingsState = useBookings(staff);
  const settingsState = useBookingSettings(staff);

  const resetToAnonymous = useCallback(() => {
    setProfile(null);
    setStaffEmail(null);
    setAccess('anonymous');
  }, []);

  /** Loads the profile for the current session and decides between workspace, subscription gate, or login. */
  const resolveAccess = useCallback(async (requestId: number, fromLogin: boolean): Promise<void> => {
    try {
      const nextProfile = await fetchMyProfile();
      if (accessRequest.current !== requestId) return;
      if (!isActiveStaff(nextProfile) || !nextProfile) {
        if (fromLogin) {
          await supabase.auth.signOut();
          toast.error(t('invalidCredentials'));
        }
        resetToAnonymous();
        return;
      }

      setProfile(nextProfile);
      const { data: userData } = await supabase.auth.getUser();
      if (accessRequest.current !== requestId) return;
      setStaffEmail(userData.user?.email ?? null);

      if (needsSubscription(nextProfile)) {
        const returnAction = pendingReturn.current;
        pendingReturn.current = null;
        if (returnAction) {
          setPanelReturn(returnAction);
          setAccess('subscription_required');
          return;
        }
        const state = await fetchSubscriptionState();
        if (accessRequest.current !== requestId) return;
        if (!state.hasAccess) {
          setPanelReturn(null);
          setAccess('subscription_required');
          return;
        }
      }
      setAccess('staff');
    } catch {
      if (accessRequest.current !== requestId) return;
      toast.error(t('fetchError'));
      resetToAnonymous();
    }
  }, [resetToAnonymous, t]);

  useEffect(() => {
    const requestId = ++accessRequest.current;
    const boot = async () => {
      if (staffRegisterToken) {
        const separator = staffRegisterToken.indexOf('.');
        if (separator > 0) {
          try {
            await registerTechnicianVerify({
              challengeId: staffRegisterToken.slice(0, separator),
              token: staffRegisterToken.slice(separator + 1),
            });
            toast.success(t('technicianRegisterSuccess'));
          } catch (error) {
            const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
            toast.error(t(errorI18nKey(code)));
          }
        }
      }

      const { data, error } = await supabase.auth.getSession();
      if (accessRequest.current !== requestId) return;
      if (error || !data.session) {
        resetToAnonymous();
        return;
      }
      await resolveAccess(requestId, false);
    };
    void boot();
    // Runs once per mount: the token and return flag are consumed by the first pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      await resolveAccess(requestId, true);
    } catch (error) {
      const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
      toast.error(t(errorI18nKey(code)));
      resetToAnonymous();
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      accessRequest.current += 1;
      await supabase.auth.signOut();
      resetToAnonymous();
    } catch {
      toast.error(t('logoutError'));
    }
  };

  const handleGoToBooking = async () => {
    if ((staff || access === 'subscription_required') && profile) {
      try {
        accessRequest.current += 1;
        await supabase.auth.signOut();
        resetToAnonymous();
      } catch {
        toast.error(t('logoutError'));
        return;
      }
    }
    onCloseAdmin();
  };

  const handleRegistered = async (sessionStarted: boolean) => {
    if (!sessionStarted) {
      setAccess('anonymous');
      return;
    }
    const requestId = ++accessRequest.current;
    setAccess('loading');
    await resolveAccess(requestId, false);
  };

  const handleSubscriptionAccess = useCallback((hasAccess: boolean) => {
    if (hasAccess && access === 'subscription_required') {
      setAccess('staff');
    } else if (!hasAccess && access === 'staff' && needsSubscription(profile)) {
      setPanelReturn(null);
      setAccess('subscription_required');
    }
  }, [access, profile]);

  if (access === 'loading' || (staff && !bookingsState.loaded)) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    );
  }

  if (access === 'anonymous' || access === 'register') {
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
          {access === 'register' ? (
            <TechnicianRegisterForm onBack={() => setAccess('anonymous')} onRegistered={(started) => void handleRegistered(started)} />
          ) : (
            <form className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card" onSubmit={(event) => void handleLogin(event)}>
              <div className="flex flex-col items-center gap-3">
                <BrandLogo className="h-24 w-auto object-contain sm:h-28" />
                <h2 className="text-center text-2xl font-semibold">{t('loginTitle')}</h2>
              </div>
              <p className="text-center text-sm text-muted">{t('loginSubtitle')}</p>
              <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t('email')} className="w-full rounded-lg border border-line px-3 py-2" />
              <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t('password')} className="w-full rounded-lg border border-line px-3 py-2" />
              <Button className="w-full" disabled={loginLoading}><LogIn className="h-4 w-4" />{loginLoading ? t('loggingIn') : t('login')}</Button>
              <Button type="button" variant="secondary" className="w-full" onClick={() => setAccess('register')}><UserPlus className="h-4 w-4" />{t('technicianRegisterEntry')}</Button>
              <Button type="button" variant="ghost" className="w-full" onClick={() => onCloseAdmin()}><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('backToBooking')}</Button>
            </form>
          )}
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

  if (access === 'subscription_required') {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
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
        <div className="flex flex-1 justify-center px-4 py-8">
          <SubscriptionPanel initialAction={panelReturn} onAccessChanged={handleSubscriptionAccess} />
        </div>
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
      <AdminWorkspace
        profile={profile}
        bookingsState={bookingsState}
        settingsState={settingsState}
        onSubscriptionAccessChanged={handleSubscriptionAccess}
      />
    </div>
  );
}
