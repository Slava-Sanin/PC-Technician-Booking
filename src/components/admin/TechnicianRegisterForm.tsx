import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { registerTechnicianStart, registerTechnicianVerify } from '../../services/staffAuthService';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { BrandLogo } from '../BrandLogo';
import { Alert, Button, Field, Input } from '../ui';

type Step = 'form' | 'verify';

export function TechnicianRegisterForm({
  onBack,
  onRegistered,
}: {
  onBack: () => void;
  /** Called after the email is confirmed. `sessionStarted` is false when the user must sign in manually. */
  onRegistered: (sessionStarted: boolean) => void;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordRepeat, setPasswordRepeat] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [maskedTarget, setMaskedTarget] = useState('');
  const [linkExistingAuth, setLinkExistingAuth] = useState(false);
  const [code, setCode] = useState('');

  const handleError = (error: unknown) => {
    const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
    toast.error(t(errorI18nKey(code)));
  };

  const handleStart = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== passwordRepeat) {
      toast.error(t('passwordsDoNotMatch'));
      return;
    }
    setLoading(true);
    try {
      const result = await registerTechnicianStart({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        password,
      });
      setChallengeId(result.challengeId);
      setMaskedTarget(result.maskedTarget);
      setLinkExistingAuth(result.linkExistingAuth);
      setStep('verify');
      toast.success(t('technicianRegisterCodeSent', { target: result.maskedTarget }));
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    try {
      const result = await registerTechnicianVerify({ challengeId, code: code.trim() });
      toast.success(t('technicianRegisterSuccess'));
      onRegistered(result.sessionStarted);
    } catch (error) {
      handleError(error);
    } finally {
      setLoading(false);
    }
  };

  if (step === 'verify') {
    return (
      <form className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card" onSubmit={(event) => void handleVerify(event)}>
        <div className="flex flex-col items-center gap-3">
          <BrandLogo className="h-24 w-auto object-contain sm:h-28" />
          <h2 className="text-center text-2xl font-semibold">{t('technicianVerifyTitle')}</h2>
        </div>
        <p className="text-center text-sm text-muted">{t('technicianVerifyHint', { target: maskedTarget })}</p>
        {linkExistingAuth ? <Alert>{t('technicianLinkExistingHint')}</Alert> : null}
        <Field label={t('verificationCode')} required>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="123456"
          />
        </Field>
        <Button className="w-full" disabled={loading || code.trim().length < 4}>{loading ? t('loading') : t('confirm')}</Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => setStep('form')}><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('back')}</Button>
      </form>
    );
  }

  return (
    <form className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-surface p-6 shadow-card" onSubmit={(event) => void handleStart(event)}>
      <div className="flex flex-col items-center gap-3">
        <BrandLogo className="h-24 w-auto object-contain sm:h-28" />
        <h2 className="text-center text-2xl font-semibold">{t('technicianRegisterTitle')}</h2>
      </div>
      <p className="text-center text-sm text-muted">{t('technicianRegisterSubtitle')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('firstName')} required><Input required autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} /></Field>
        <Field label={t('lastName')} required><Input required autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} /></Field>
      </div>
      <Field label={t('phone')}><Input type="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+972..." /></Field>
      <Field label={t('email')} required><Input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('password')} required hint={t('passwordMinHint')}>
          <Input type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Field label={t('passwordRepeat')} required>
          <Input type="password" required minLength={6} autoComplete="new-password" value={passwordRepeat} onChange={(event) => setPasswordRepeat(event.target.value)} />
        </Field>
      </div>
      <Alert>{t('technicianRegisterSubscriptionNote')}</Alert>
      <Button className="w-full" disabled={loading}><UserPlus className="h-4 w-4" />{loading ? t('loading') : t('technicianRegisterSubmit')}</Button>
      <Button type="button" variant="ghost" className="w-full" onClick={onBack}><ArrowLeft className="h-4 w-4 rtl:rotate-180" />{t('backToLogin')}</Button>
    </form>
  );
}
