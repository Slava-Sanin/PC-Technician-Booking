import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import {
  adminGetPayoutProfile,
  adminListSubscriptions,
  adminRevealPayoutCard,
  adminSavePayoutProfile,
  adminSaveSubscriptionDiscounts,
  adminSaveSubscriptionPlan,
  fetchMySubscriptionState,
} from '../../services/subscriptionService';
import type { AdminSubscriptionItem, DiscountTier, PayoutMethod, PayoutProfile, SubscriptionStatus } from '../../types/subscription';
import { BookingApiError, errorI18nKey } from '../../utils/errors';
import { formatMoney } from '../../utils/pricing';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select, Switch } from '../ui';
import { useConfirm } from '../ui/ConfirmProvider';

function statusTone(status: SubscriptionStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'active') return 'success';
  if (status === 'pending_payment') return 'warning';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function formatDate(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const language = locale.startsWith('he') ? 'he-IL' : locale.startsWith('ru') ? 'ru-RU' : 'en-GB';
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium' }).format(new Date(iso));
}

function errorToast(t: (key: string) => string, error: unknown): void {
  const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
  toast.error(t(errorI18nKey(code)));
}

// ---------------------------------------------------------------------------
// Subscriptions (admin): list + tariff + discounts
// ---------------------------------------------------------------------------

export function SubscriptionsAdminPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'list' | 'plan'>('list');
  const [items, setItems] = useState<AdminSubscriptionItem[]>([]);
  const [filter, setFilter] = useState<'all' | SubscriptionStatus>('all');
  const [monthlyPrice, setMonthlyPrice] = useState('');
  const [currency, setCurrency] = useState('ILS');
  const [enabled, setEnabled] = useState(true);
  const [tiers, setTiers] = useState<DiscountTier[]>([]);
  const [saving, setSaving] = useState(false);

  const refreshList = useCallback(() => adminListSubscriptions().then(setItems).catch((error) => errorToast(t, error)), [t]);
  const refreshPlan = useCallback(() => fetchMySubscriptionState().then((state) => {
    setMonthlyPrice(String(state.plan.monthlyPrice));
    setCurrency(state.plan.currency);
    setEnabled(state.plan.enabled);
    setTiers(state.discounts);
  }).catch((error) => errorToast(t, error)), [t]);

  useEffect(() => {
    if (!isAdmin) return;
    void refreshList();
    void refreshPlan();
  }, [isAdmin, refreshList, refreshPlan]);

  const visible = useMemo(
    () => items.filter((item) => filter === 'all' || item.status === filter),
    [filter, items],
  );

  const savePlan = async () => {
    const price = Number(monthlyPrice.replace(',', '.'));
    if (!Number.isFinite(price) || price < 0) {
      toast.error(t('error_INVALID_INPUT'));
      return;
    }
    setSaving(true);
    try {
      await adminSaveSubscriptionPlan({ monthlyPrice: Math.round(price * 100) / 100, currency: currency.toUpperCase(), enabled });
      const cleaned = tiers
        .map((tier) => ({ minMonths: Math.trunc(tier.minMonths), discountPercent: Math.round(tier.discountPercent * 100) / 100 }))
        .filter((tier) => Number.isInteger(tier.minMonths) && tier.minMonths >= 3);
      const saved = await adminSaveSubscriptionDiscounts(cleaned);
      setTiers(saved);
      toast.success(t('settingsSaved'));
    } catch (error) {
      errorToast(t, error);
    } finally {
      setSaving(false);
    }
  };

  const updateTier = (index: number, patch: Partial<DiscountTier>) => {
    setTiers((current) => current.map((tier, position) => (position === index ? { ...tier, ...patch } : tier)));
  };

  if (!isAdmin) {
    return <Alert>{t('settingsReadOnly')}</Alert>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('nav_subscriptions')}</h1>
      <div className="flex gap-2">
        <Button variant={tab === 'list' ? 'primary' : 'ghost'} onClick={() => setTab('list')}>{t('subscriptionsList')}</Button>
        <Button variant={tab === 'plan' ? 'primary' : 'ghost'} onClick={() => setTab('plan')}>{t('subscriptionPlan')}</Button>
      </div>

      {tab === 'list' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'pending_payment', 'expired', 'cancelled', 'failed'] as const).map((item) => (
              <Button key={item} variant={filter === item ? 'secondary' : 'ghost'} onClick={() => setFilter(item)}>
                {item === 'all' ? t('allPayments') : t(`sub_${item}`)}
              </Button>
            ))}
          </div>
          {visible.length === 0 ? <EmptyState title={t('noSubscriptions')} /> : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="table-cols-center min-w-full text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-3 text-start">{t('technician')}</th>
                    <th className="px-3 py-3">{t('subscriptionMonths')}</th>
                    <th className="px-3 py-3">{t('subscriptionAmount')}</th>
                    <th className="px-3 py-3">{t('status')}</th>
                    <th className="px-3 py-3">{t('subscriptionStarts')}</th>
                    <th className="px-3 py-3">{t('subscriptionEnds')}</th>
                    <th className="px-3 py-3">{t('subscriptionRefund')}</th>
                    <th className="px-3 py-3">{t('subscriptionCard')}</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.id}>
                      <td className="table-cell-text-start px-3 py-2">
                        <p className="font-medium">{[item.firstName, item.lastName].filter(Boolean).join(' ') || '—'}</p>
                        <p className="text-xs text-muted">{item.email ?? ''}{item.phone ? ` · ${item.phone}` : ''}</p>
                      </td>
                      <td className="px-3 py-2">{item.months}</td>
                      <td className="px-3 py-2">{formatMoney(item.amountTotal, item.currency, i18n.language)}{item.discountPercent > 0 ? <span className="block text-xs text-muted">−{item.discountPercent}%</span> : null}</td>
                      <td className="px-3 py-2"><Badge tone={statusTone(item.status)}>{t(`sub_${item.status}`)}</Badge></td>
                      <td className="px-3 py-2">{formatDate(item.startsAt, i18n.language)}</td>
                      <td className="px-3 py-2">{formatDate(item.endsAt, i18n.language)}</td>
                      <td className="px-3 py-2">
                        {item.status === 'cancelled' && item.refundAmount != null ? (
                          <>
                            {formatMoney(item.refundAmount, item.currency, i18n.language)}
                            <Badge tone={item.refundStatus === 'refunded' ? 'success' : item.refundStatus === 'failed' ? 'danger' : 'neutral'}>{t(`refund_${item.refundStatus}`)}</Badge>
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2">{item.cardLast4 ? `**** ${item.cardLast4}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {tab === 'plan' ? (
        <Card className="grid max-w-2xl gap-4 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t('subscriptionMonthlyPriceLabel')}>
              <Input inputMode="decimal" value={monthlyPrice} onChange={(event) => setMonthlyPrice(event.target.value)} />
            </Field>
            <Field label={t('currency')}>
              <Select value={currency} onChange={(event) => setCurrency(event.target.value)}>
                <option value="ILS">ILS</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </Select>
            </Field>
            <Field label={t('subscriptionSalesEnabled')}>
              <div className="pt-1"><Switch checked={enabled} label={t('subscriptionSalesEnabled')} onChange={setEnabled} /></div>
            </Field>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{t('subscriptionDiscounts')}</h3>
              <Button variant="ghost" onClick={() => setTiers((current) => [...current, { minMonths: Math.max(3, (current.at(-1)?.minMonths ?? 2) + 1), discountPercent: 0 }])}>
                <Plus className="h-4 w-4" />{t('subscriptionAddTier')}
              </Button>
            </div>
            <p className="text-xs text-muted">{t('subscriptionDiscountsHint')}</p>
            {tiers.length === 0 ? <p className="text-sm text-muted">{t('subscriptionNoTiers')}</p> : null}
            {tiers.map((tier, index) => (
              <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label={t('subscriptionFromMonths')}>
                  <Input type="number" min={3} max={1200} value={tier.minMonths} onChange={(event) => updateTier(index, { minMonths: Number(event.target.value) })} />
                </Field>
                <Field label={t('subscriptionDiscount')}>
                  <Input type="number" min={0} max={100} step={0.5} value={tier.discountPercent} onChange={(event) => updateTier(index, { discountPercent: Number(event.target.value) })} />
                </Field>
                <Button variant="ghost" aria-label={t('delete')} onClick={() => setTiers((current) => current.filter((_, position) => position !== index))}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>

          <Button disabled={saving} onClick={() => void savePlan()}>{t('save')}</Button>
        </Card>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payouts (admin): bank account or card where the administrator receives money
// ---------------------------------------------------------------------------

interface PayoutDraft {
  payoutMethod: PayoutMethod;
  bankName: string;
  branch: string;
  accountNumber: string;
  beneficiary: string;
  iban: string;
  swift: string;
  cardHolder: string;
  cardNumber: string;
  cardExpMonth: string;
  cardExpYear: string;
}

function draftFromProfile(profile: PayoutProfile): PayoutDraft {
  return {
    payoutMethod: profile.payoutMethod,
    bankName: profile.bankName ?? '',
    branch: profile.branch ?? '',
    accountNumber: profile.accountNumber ?? '',
    beneficiary: profile.beneficiary ?? '',
    iban: profile.iban ?? '',
    swift: profile.swift ?? '',
    cardHolder: profile.cardHolder ?? '',
    cardNumber: '',
    cardExpMonth: profile.cardExpMonth ? String(profile.cardExpMonth).padStart(2, '0') : '',
    cardExpYear: profile.cardExpYear ? String(profile.cardExpYear) : '',
  };
}

export function PayoutsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const [profile, setProfile] = useState<PayoutProfile | null>(null);
  const [draft, setDraft] = useState<PayoutDraft | null>(null);
  const [editingCard, setEditingCard] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const refresh = useCallback(() => adminGetPayoutProfile().then((next) => {
    setProfile(next);
    setDraft(draftFromProfile(next));
    setEditingCard(!next.cardStored);
    setRevealed(null);
  }).catch((error) => errorToast(t, error)), [t]);

  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);

  if (!isAdmin) {
    return <Alert>{t('settingsReadOnly')}</Alert>;
  }
  if (!profile || !draft) {
    return <p className="text-sm text-muted">{t('loading')}</p>;
  }

  const patch = (next: Partial<PayoutDraft>) => setDraft((current) => (current ? { ...current, ...next } : current));

  const save = async () => {
    const digits = draft.cardNumber.replace(/\D/g, '');
    if (draft.payoutMethod === 'card' && editingCard && digits && (digits.length < 12 || digits.length > 19)) {
      toast.error(t('payoutCardInvalid'));
      return;
    }
    setSaving(true);
    try {
      const next = await adminSavePayoutProfile({
        payoutMethod: draft.payoutMethod,
        bank: {
          bankName: draft.bankName,
          branch: draft.branch,
          accountNumber: draft.accountNumber,
          beneficiary: draft.beneficiary,
          iban: draft.iban,
          swift: draft.swift,
        },
        card: {
          holder: draft.cardHolder,
          number: editingCard && digits ? digits : undefined,
          expMonth: draft.cardExpMonth ? Number(draft.cardExpMonth) : null,
          expYear: draft.cardExpYear ? Number(draft.cardExpYear) : null,
        },
      });
      setProfile(next);
      setDraft(draftFromProfile(next));
      setEditingCard(!next.cardStored);
      setRevealed(null);
      toast.success(t('settingsSaved'));
    } catch (error) {
      errorToast(t, error);
    } finally {
      setSaving(false);
    }
  };

  const clearCard = async () => {
    const ok = await confirm({ message: t('payoutCardClearConfirm'), variant: 'danger' });
    if (!ok) return;
    setSaving(true);
    try {
      const next = await adminSavePayoutProfile({
        payoutMethod: draft.payoutMethod,
        bank: {
          bankName: draft.bankName,
          branch: draft.branch,
          accountNumber: draft.accountNumber,
          beneficiary: draft.beneficiary,
          iban: draft.iban,
          swift: draft.swift,
        },
        card: { holder: '', expMonth: null, expYear: null, clear: true },
      });
      setProfile(next);
      setDraft(draftFromProfile(next));
      setEditingCard(true);
      setRevealed(null);
      toast.success(t('settingsSaved'));
    } catch (error) {
      errorToast(t, error);
    } finally {
      setSaving(false);
    }
  };

  const toggleReveal = async () => {
    if (revealed) {
      setRevealed(null);
      return;
    }
    try {
      const number = await adminRevealPayoutCard();
      setRevealed(number ?? '');
    } catch (error) {
      errorToast(t, error);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('nav_payouts')}</h1>
      <Alert>{t('payoutHint')}</Alert>
      <Card className="grid max-w-2xl gap-4 p-4">
        <Field label={t('payoutMethod')}>
          <Select value={draft.payoutMethod} onChange={(event) => patch({ payoutMethod: event.target.value as PayoutMethod })}>
            <option value="bank">{t('payoutMethodBank')}</option>
            <option value="card">{t('payoutMethodCard')}</option>
          </Select>
        </Field>

        {draft.payoutMethod === 'bank' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('bankName')}><Input value={draft.bankName} onChange={(event) => patch({ bankName: event.target.value })} /></Field>
            <Field label={t('branch')}><Input value={draft.branch} onChange={(event) => patch({ branch: event.target.value })} /></Field>
            <Field label={t('accountNumber')}><Input value={draft.accountNumber} onChange={(event) => patch({ accountNumber: event.target.value })} /></Field>
            <Field label={t('beneficiary')}><Input value={draft.beneficiary} onChange={(event) => patch({ beneficiary: event.target.value })} /></Field>
            <Field label="IBAN"><Input value={draft.iban} onChange={(event) => patch({ iban: event.target.value })} /></Field>
            <Field label="SWIFT / BIC"><Input value={draft.swift} onChange={(event) => patch({ swift: event.target.value })} /></Field>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('payoutCardHolder')} className="sm:col-span-2">
              <Input autoComplete="off" value={draft.cardHolder} onChange={(event) => patch({ cardHolder: event.target.value })} />
            </Field>
            <Field label={t('payoutCardNumber')} className="sm:col-span-2" hint={t('payoutCardNumberHint')}>
              {editingCard ? (
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="0000 0000 0000 0000"
                  value={draft.cardNumber}
                  onChange={(event) => patch({ cardNumber: event.target.value.replace(/[^\d ]/g, '').slice(0, 23) })}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base">{revealed ? revealed.replace(/(\d{4})(?=\d)/g, '$1 ') : `**** **** **** ${profile.cardLast4 ?? '????'}`}</span>
                  <Button variant="ghost" type="button" onClick={() => void toggleReveal()}>
                    {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {revealed ? t('payoutCardHide') : t('payoutCardReveal')}
                  </Button>
                  <Button variant="ghost" type="button" onClick={() => setEditingCard(true)}>{t('payoutCardChange')}</Button>
                  <Button variant="ghost" type="button" className="text-danger" onClick={() => void clearCard()}>{t('payoutCardClear')}</Button>
                </div>
              )}
            </Field>
            <Field label={t('payoutCardExpMonth')}>
              <Input inputMode="numeric" placeholder="MM" maxLength={2} value={draft.cardExpMonth} onChange={(event) => patch({ cardExpMonth: event.target.value.replace(/\D/g, '').slice(0, 2) })} />
            </Field>
            <Field label={t('payoutCardExpYear')}>
              <Input inputMode="numeric" placeholder="YYYY" maxLength={4} value={draft.cardExpYear} onChange={(event) => patch({ cardExpYear: event.target.value.replace(/\D/g, '').slice(0, 4) })} />
            </Field>
            <p className="text-xs text-muted sm:col-span-2">{t('payoutCardCvvNote')}</p>
          </div>
        )}

        <Button disabled={saving} onClick={() => void save()}>{t('save')}</Button>
      </Card>
    </div>
  );
}
