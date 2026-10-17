import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { CreditCard, RefreshCw, XCircle } from 'lucide-react';
import {
  abandonSubscriptionCheckout,
  cancelSubscription,
  createSubscriptionCheckout,
  fetchSubscriptionState,
  syncSubscription,
} from '../../services/subscriptionService';
import type { SubscriptionState, SubscriptionStatus } from '../../types/subscription';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { formatMoney, subscriptionQuote, subscriptionRefund } from '../../utils/pricing';
import { Alert, Badge, Button, Card, EmptyState, Field, Input } from '../ui';
import { useConfirm } from '../ui/ConfirmProvider';

export type SubscriptionReturn = 'success' | 'failed';

const QUICK_MONTHS = [1, 3, 6, 12, 24];

function statusTone(status: SubscriptionStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'active':
      return 'success';
    case 'pending_payment':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const language = locale.startsWith('he') ? 'he-IL' : locale.startsWith('ru') ? 'ru-RU' : 'en-GB';
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(iso));
}

export function SubscriptionPanel({
  initialAction = null,
  onAccessChanged,
  embedded = false,
}: {
  initialAction?: SubscriptionReturn | null;
  onAccessChanged?: (hasAccess: boolean) => void;
  embedded?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const confirm = useConfirm();
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [monthsInput, setMonthsInput] = useState('1');
  const initialHandled = useRef(false);

  const reportAccess = useCallback((next: SubscriptionState) => {
    onAccessChanged?.(next.hasAccess);
  }, [onAccessChanged]);

  const handleError = useCallback((error: unknown) => {
    const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
    toast.error(t(errorI18nKey(code)));
  }, [t]);

  useEffect(() => {
    if (initialHandled.current) return;
    initialHandled.current = true;
    const run = async () => {
      setLoading(true);
      try {
        let next: SubscriptionState;
        if (initialAction === 'success') {
          next = await syncSubscription();
          if (next.subscription?.status === 'active') toast.success(t('subscriptionPaid'));
          else toast(t('subscriptionPaymentPending'));
        } else if (initialAction === 'failed') {
          next = await abandonSubscriptionCheckout();
          toast.error(t('subscriptionPaymentFailed'));
        } else {
          next = await fetchSubscriptionState();
        }
        setState(next);
        reportAccess(next);
      } catch (error) {
        handleError(error);
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [handleError, initialAction, reportAccess, t]);

  const months = useMemo(() => {
    const parsed = Number.parseInt(monthsInput, 10);
    return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 1200) : 1;
  }, [monthsInput]);

  const quote = useMemo(() => {
    if (!state) return null;
    return subscriptionQuote(months, state.plan.monthlyPrice, state.discounts);
  }, [months, state]);

  const subscription = state?.subscription ?? null;
  const currency = subscription?.currency ?? state?.plan.currency ?? 'ILS';
  const locale = i18n.language;
  const money = (value: number) => formatMoney(value, currency, locale);

  const liveRefund = useMemo(() => {
    if (!subscription || subscription.status !== 'active' || !subscription.startsAt || !subscription.endsAt) return null;
    return subscriptionRefund(subscription.amountTotal, subscription.startsAt, subscription.endsAt);
  }, [subscription]);

  const canPurchase = Boolean(
    state
    && state.role === 'technician'
    && (!subscription || !['active', 'pending_payment'].includes(subscription.status)),
  );

  const startCheckout = async () => {
    if (!state) return;
    setBusy(true);
    try {
      const { url } = await createSubscriptionCheckout(months, locale);
      window.location.assign(url);
    } catch (error) {
      handleError(error);
      setBusy(false);
    }
  };

  const checkPayment = async () => {
    setBusy(true);
    try {
      const next = await syncSubscription();
      setState(next);
      reportAccess(next);
      if (next.subscription?.status === 'active') toast.success(t('subscriptionPaid'));
      else toast(t('subscriptionPaymentPending'));
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const abandon = async () => {
    setBusy(true);
    try {
      const next = await abandonSubscriptionCheckout();
      setState(next);
      reportAccess(next);
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!subscription) return;
    const refund = liveRefund ?? state?.refundQuote ?? null;
    const ok = await confirm({
      title: t('subscriptionCancelTitle'),
      message: t('subscriptionCancelMessage', {
        amount: money(refund?.refundAmount ?? 0),
        days: refund?.remainingDays ?? 0,
      }),
      confirmLabel: t('subscriptionCancelConfirm'),
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await cancelSubscription();
      setState(result.state);
      reportAccess(result.state);
      if (result.refundAmount <= 0) toast.success(t('subscriptionCancelled'));
      else if (result.refundStatus === 'refunded') toast.success(t('subscriptionCancelledRefunded', { amount: money(result.refundAmount) }));
      else toast.error(t('subscriptionCancelledRefundFailed', { amount: money(result.refundAmount) }));
    } catch (error) {
      handleError(error);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !state) {
    return <p className="text-sm text-muted">{t('loading')}</p>;
  }

  if (!state) {
    return <EmptyState title={t('fetchError')} />;
  }

  return (
    <div className={embedded ? 'space-y-4' : 'mx-auto w-full max-w-3xl space-y-4'}>
      <h1 className={`text-2xl font-semibold ${embedded ? '' : 'text-center'}`}>{t('subscriptionTitle')}</h1>
      {!state.hasAccess ? <Alert tone="warning">{t('subscriptionRequiredHint')}</Alert> : null}
      {state.exempt ? <Alert>{t('subscriptionExemptHint')}</Alert> : null}
      {!state.paymentAvailable ? <Alert tone="warning">{t('subscriptionPaymentUnavailable')}</Alert> : null}
      {!state.plan.enabled ? <Alert tone="warning">{t('subscriptionDisabled')}</Alert> : null}

      {subscription ? (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{t('subscriptionCurrent')}</h2>
            <Badge tone={statusTone(subscription.status)}>{t(`sub_${subscription.status}`)}</Badge>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-muted">{t('subscriptionMonths')}</dt><dd className="font-medium">{subscription.months}</dd></div>
            <div><dt className="text-muted">{t('subscriptionAmount')}</dt><dd className="font-medium">{money(subscription.amountTotal)}{subscription.discountPercent > 0 ? ` (−${subscription.discountPercent}%)` : ''}</dd></div>
            <div><dt className="text-muted">{t('subscriptionStarts')}</dt><dd className="font-medium">{formatDate(subscription.startsAt, locale)}</dd></div>
            <div><dt className="text-muted">{t('subscriptionEnds')}</dt><dd className="font-medium">{formatDate(subscription.endsAt, locale)}</dd></div>
            {subscription.cardLast4 ? (
              <div><dt className="text-muted">{t('subscriptionCard')}</dt><dd className="font-medium">**** {subscription.cardLast4}</dd></div>
            ) : null}
            {subscription.status === 'active' && liveRefund ? (
              <div><dt className="text-muted">{t('subscriptionRemainingDays')}</dt><dd className="font-medium">{liveRefund.remainingDays} / {liveRefund.totalDays}</dd></div>
            ) : null}
            {subscription.status === 'cancelled' && subscription.refundAmount != null ? (
              <div>
                <dt className="text-muted">{t('subscriptionRefund')}</dt>
                <dd className="font-medium">{money(subscription.refundAmount)} · {t(`refund_${subscription.refundStatus}`)}</dd>
              </div>
            ) : null}
          </dl>

          {subscription.status === 'pending_payment' ? (
            <div className="space-y-2">
              <Alert tone="warning">{t('subscriptionAwaitingPayment')}</Alert>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => void checkPayment()}><RefreshCw className="h-4 w-4" />{t('subscriptionCheckPayment')}</Button>
                <Button variant="ghost" disabled={busy} onClick={() => void abandon()}>{t('subscriptionAbandon')}</Button>
              </div>
            </div>
          ) : null}

          {subscription.status === 'active' ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                {t('subscriptionRefundEstimate', { amount: money(liveRefund?.refundAmount ?? 0) })}
              </p>
              <Button variant="danger" disabled={busy} onClick={() => void cancel()}><XCircle className="h-4 w-4" />{t('subscriptionCancel')}</Button>
            </div>
          ) : null}
        </Card>
      ) : null}

      {canPurchase ? (
        <Card className="space-y-4 p-4">
          <h2 className="text-lg font-semibold">{t('subscriptionBuy')}</h2>
          <p className="text-sm text-muted">{t('subscriptionMonthlyPrice', { amount: money(state.plan.monthlyPrice) })}</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_MONTHS.map((value) => (
              <Button key={value} variant={months === value ? 'primary' : 'ghost'} onClick={() => setMonthsInput(String(value))}>
                {t('subscriptionMonthsCount', { count: value })}
              </Button>
            ))}
          </div>
          <Field label={t('subscriptionMonths')} hint={t('subscriptionMonthsHint')}>
            <Input
              type="number"
              min={1}
              max={1200}
              step={1}
              inputMode="numeric"
              value={monthsInput}
              onChange={(event) => setMonthsInput(event.target.value)}
              onBlur={() => setMonthsInput(String(months))}
              className="max-w-[10rem]"
            />
          </Field>

          {state.discounts.length > 0 ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">{t('subscriptionDiscounts')}</h3>
              <div className="overflow-x-auto rounded-xl border border-line">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-canvas text-start">
                      <th className="px-3 py-2 text-start font-medium">{t('subscriptionFromMonths')}</th>
                      <th className="px-3 py-2 text-start font-medium">{t('subscriptionDiscount')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.discounts.map((tier) => (
                      <tr key={tier.minMonths} className={quote?.discountPercent === tier.discountPercent && months >= tier.minMonths ? 'bg-highlight' : ''}>
                        <td className="px-3 py-2">{t('subscriptionMonthsCount', { count: tier.minMonths })}</td>
                        <td className="px-3 py-2">{tier.discountPercent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {quote ? (
            <div className="rounded-xl border border-line bg-canvas p-3 text-sm">
              <div className="flex justify-between"><span>{t('subscriptionFullPrice')}</span><span>{money(quote.fullPrice)}</span></div>
              {quote.discountPercent > 0 ? (
                <div className="flex justify-between text-success"><span>{t('subscriptionDiscount')} {quote.discountPercent}%</span><span>−{money(Math.round((quote.fullPrice - quote.amountTotal) * 100) / 100)}</span></div>
              ) : null}
              <div className="mt-1 flex justify-between border-t border-line pt-1 text-base font-semibold"><span>{t('subscriptionTotal')}</span><span>{money(quote.amountTotal)}</span></div>
            </div>
          ) : null}

          <Button
            className="w-full sm:w-auto"
            disabled={busy || !state.paymentAvailable || !state.plan.enabled || !quote || quote.amountTotal <= 0}
            onClick={() => void startCheckout()}
          >
            <CreditCard className="h-4 w-4" />
            {t('subscriptionPay', { amount: quote ? money(quote.amountTotal) : '' })}
          </Button>
          <p className="text-xs text-muted">{t('subscriptionCancelPolicy')}</p>
        </Card>
      ) : null}

      {!canPurchase && !subscription && state.role === 'admin' ? <Alert>{t('subscriptionAdminHint')}</Alert> : null}
      {loading ? <p className="text-xs text-muted">{t('loading')}</p> : null}
    </div>
  );
}
