import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import {
  loginCustomer,
  startCustomerRegistration,
  verifyCustomerRegistration,
} from '../../services/customerService';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { Button, Field, Input } from '../ui';

type Mode = 'login' | 'register' | 'verify';

export function CustomerAuthModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('login');
  const [loading, setLoading] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [verifyChannel, setVerifyChannel] = useState<'email' | 'sms'>('sms');
  const [challengeId, setChallengeId] = useState('');
  const [maskedTarget, setMaskedTarget] = useState('');
  const [code, setCode] = useState('');

  if (!open) return null;

  const resetToLogin = () => {
    setMode('login');
    setChallengeId('');
    setCode('');
    setMaskedTarget('');
  };

  const handleError = (error: unknown) => {
    const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
    toast.error(t(errorI18nKey(code)));
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await loginCustomer(identifier.trim(), password);
      toast.success(t('customerLoginSuccess'));
      onSuccess();
      onClose();
      resetToLogin();
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterStart = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await startCustomerRegistration({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        password,
        verifyChannel,
      });
      setChallengeId(result.challengeId);
      setMaskedTarget(result.maskedTarget);
      setMode('verify');
      toast.success(t('verificationCodeSent', { target: result.maskedTarget }));
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterVerify = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      await verifyCustomerRegistration({ challengeId, code: code.trim() });
      toast.success(t('customerRegisterSuccess'));
      onSuccess();
      onClose();
      resetToLogin();
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">
            {mode === 'login' ? t('customerLoginTitle') : mode === 'register' ? t('customerRegisterTitle') : t('customerVerifyTitle')}
          </h2>
          <button type="button" className="text-sm text-muted hover:text-ink" onClick={onClose}>{t('close')}</button>
        </div>

        {mode === 'login' ? (
          <form className="space-y-3" onSubmit={(event) => void handleLogin(event)}>
            <Field label={t('customerLoginIdentifier')}>
              <Input required value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder={t('customerLoginIdentifierHint')} />
            </Field>
            <Field label={t('password')}>
              <Input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
            </Field>
            <Button className="w-full" disabled={loading}>{loading ? t('loggingIn') : t('login')}</Button>
            <button type="button" className="w-full text-sm text-primary" onClick={() => setMode('register')}>{t('customerSwitchToRegister')}</button>
          </form>
        ) : null}

        {mode === 'register' ? (
          <form className="space-y-3" onSubmit={(event) => void handleRegisterStart(event)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('firstName')}><Input required value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field>
              <Field label={t('lastName')}><Input required value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field>
            </div>
            <Field label={t('phone')}><Input value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
            <Field label={t('email')}><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
            <Field label={t('password')}><Input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
            <Field label={t('customerVerifyChannel')}>
              <select className="w-full rounded-lg border border-line px-3 py-2 text-sm" value={verifyChannel} onChange={(event) => setVerifyChannel(event.target.value as 'email' | 'sms')}>
                <option value="sms">{t('customerVerifyBySms')}</option>
                <option value="email">{t('customerVerifyByEmail')}</option>
              </select>
            </Field>
            <Button className="w-full" disabled={loading}>{loading ? t('submitting') : t('customerSendVerification')}</Button>
            <button type="button" className="w-full text-sm text-primary" onClick={() => setMode('login')}>{t('customerSwitchToLogin')}</button>
          </form>
        ) : null}

        {mode === 'verify' ? (
          <form className="space-y-3" onSubmit={(event) => void handleRegisterVerify(event)}>
            <p className="text-sm text-muted">{t('verificationCodeSent', { target: maskedTarget })}</p>
            <Field label={t('verificationCode')}>
              <Input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} />
            </Field>
            <Button className="w-full" disabled={loading}>{loading ? t('submitting') : t('customerConfirmRegistration')}</Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
