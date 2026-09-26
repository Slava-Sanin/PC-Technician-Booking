import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { compareSortValues, SortableTableHead, TableHead, toggleSortState, type SortDirection } from './sortableTableHead';
import { useTranslation } from 'react-i18next';
import { toast } from 'react-hot-toast';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Modal, ModalFooter, Select, Switch, Textarea } from '../ui';
import { useBookings } from '../../hooks/useBookings';
import { useBookingSettings } from '../../hooks/useBookingSettings';
import {
  createCategoryWithServices,
  fetchAdminCatalog,
  fetchBankProfile,
  fetchPayments,
  fetchStaff,
  insertService,
  reviewPayment,
  setServicePaymentMethod,
  setStaff,
  slugCode,
  updateCategory,
  updatePaymentMethod,
  updateService,
  saveBankProfile,
  type CategoryRow,
  type PaymentListItem,
  type PaymentMethodRow,
  type ServiceDraft,
  type ServicePaymentLink,
  type ServiceRow,
  type StaffProfileInput,
  type StaffRow,
} from '../../services/catalogService';
import type { StaffProfile, WorkingHourDay } from '../../types/bookingSettings';
import { BOOKING_STATUSES, type Booking, type BookingStatus } from '../../types/booking';
import { PAYMENT_POLICIES, PRICE_TYPES, localized, type PaymentPolicy, type PriceType } from '../../types/catalog';
import { isPublicCategory, isPublicService } from '../../utils/catalogRules';
import { BUSINESS_TIME_ZONE, formatAppointmentInZone, formatISODateToDisplay, getZonedParts, parseDisplayDate, todayISOInTimeZone } from '../../utils/dateTime';
import { formatDurationMinutes, formatMoney } from '../../utils/pricing';
import { BookingApiError, errorI18nKey } from '../../utils/errors';

type Panel = 'dashboard' | 'bookings' | 'calendar' | 'categories' | 'services' | 'technicians' | 'schedule' | 'payments' | 'settings';

const NAV: Panel[] = ['dashboard', 'bookings', 'calendar', 'categories', 'services', 'technicians', 'schedule', 'payments', 'settings'];

function civilDate(iso: string | null): string {
  if (!iso) return '';
  const parts = getZonedParts(new Date(iso), BUSINESS_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function money(value: number | null, currency: string | null, locale: string): string {
  if (value == null) return '—';
  return formatMoney(Number(value), currency || 'ILS', locale);
}

export function AdminWorkspace({
  profile,
  bookingsState,
  settingsState,
}: {
  profile: StaffProfile;
  bookingsState: ReturnType<typeof useBookings>;
  settingsState: ReturnType<typeof useBookingSettings>;
}) {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<Panel>('dashboard');
  const isAdmin = profile.role === 'admin';

  return (
    <div className="grid min-h-[calc(100vh-73px)] lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav className="border-b border-line bg-surface p-3 lg:border-b-0 lg:border-e" aria-label={t('admin')}>
        <div className="flex gap-2 overflow-x-auto lg:flex-col">
          {NAV.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setPanel(item)}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-start text-sm font-medium ${panel === item ? 'bg-primary text-white' : 'text-ink hover:bg-canvas'}`}
            >
              {t(`nav_${item}`)}
            </button>
          ))}
        </div>
      </nav>
      <div className="p-4 sm:p-6">
        {panel === 'dashboard' ? <Dashboard bookings={bookingsState.bookings} /> : null}
        {panel === 'bookings' ? <BookingsPanel state={bookingsState} /> : null}
        {panel === 'calendar' ? <CalendarPanel bookings={bookingsState.bookings} /> : null}
        {panel === 'categories' ? <CategoriesPanel isAdmin={isAdmin} /> : null}
        {panel === 'services' ? <ServicesPanel isAdmin={isAdmin} /> : null}
        {panel === 'technicians' ? <StaffPanel isAdmin={isAdmin} /> : null}
        {panel === 'schedule' ? <SchedulePanel state={settingsState} isAdmin={isAdmin} /> : null}
        {panel === 'payments' ? <PaymentsPanel isAdmin={isAdmin} /> : null}
        {panel === 'settings' ? <SettingsPanel state={settingsState} isAdmin={isAdmin} /> : null}
      </div>
    </div>
  );
}

function Dashboard({ bookings }: { bookings: Booking[] }) {
  const { t, i18n } = useTranslation();
  const today = todayISOInTimeZone(BUSINESS_TIME_ZONE);
  const active = bookings.filter((booking) => !booking.deleted_at);
  const cards = [
    ['today', active.filter((booking) => civilDate(booking.appointment_start || booking.appointment_date) === today).length],
    ['new', active.filter((booking) => booking.status === 'new').length],
    ['confirmed', active.filter((booking) => booking.status === 'confirmed').length],
    ['progress', active.filter((booking) => ['assigned', 'on_the_way', 'in_progress', 'waiting_for_parts', 'waiting_for_customer'].includes(booking.status)).length],
    ['completed', active.filter((booking) => booking.status === 'completed').length],
    ['unpaid', active.filter((booking) => booking.payment_status === 'pending' || booking.payment_status === 'awaiting_verification').length],
  ] as const;
  const revenue = active
    .filter((booking) => booking.payment_status === 'paid')
    .reduce((sum, booking) => sum + Number(booking.total_amount ?? 0), 0);
  const upcoming = [...active]
    .filter((booking) => civilDate(booking.appointment_start || booking.appointment_date) >= today)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t('nav_dashboard')}</h1>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(([key, value]) => (
          <Card key={key} className="p-4">
            <p className="text-sm text-muted">{t(`dash_${key}`)}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-sm text-muted">{t('dash_revenue')}</p>
          <p className="mt-1 text-2xl font-semibold">{formatMoney(revenue, 'ILS', i18n.language)}</p>
        </Card>
      </div>
      <Card className="p-4">
        <h2 className="font-semibold">{t('upcoming')}</h2>
        {upcoming.length === 0 ? <p className="mt-3 text-sm text-muted">{t('noBookings')}</p> : null}
        <ul className="mt-3 divide-y divide-line">
          {upcoming.map((booking) => (
            <li key={booking.id} className="flex items-center justify-between gap-3 py-3 text-sm">
              <span>{booking.booking_number} · {booking.first_name} {booking.last_name}</span>
              <span className="text-muted">{formatAppointmentInZone(booking.appointment_start || booking.appointment_date, BUSINESS_TIME_ZONE)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function BookingsPanel({ state }: { state: ReturnType<typeof useBookings> }) {
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [payment, setPayment] = useState('all');
  const [from, setFrom] = useState('');
  const [selected, setSelected] = useState<Booking | null>(null);
  const locale = i18n.language;
  const rows = state.bookings.filter((booking) => {
    const text = `${booking.booking_number} ${booking.first_name} ${booking.last_name} ${booking.phone} ${booking.city ?? ''}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (payment !== 'all' && booking.payment_status !== payment) return false;
    const day = civilDate(booking.appointment_start || booking.appointment_date);
    if (from && day < from) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('nav_bookings')}</h1>
        <Button variant="ghost" onClick={() => state.setIncludeDeleted(!state.includeDeleted)}>
          {state.includeDeleted ? t('hideDeleted') : t('showDeleted')}
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('search')} aria-label={t('search')} />
        <Select value={state.statusFilter} onChange={(event) => state.setStatusFilter(event.target.value as BookingStatus | 'all')} aria-label={t('filterStatus')}>
          <option value="all">{t('allStatuses')}</option>
          {BOOKING_STATUSES.map((status) => <option key={status} value={status}>{t(`status_${status}`)}</option>)}
        </Select>
        <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} aria-label={t('dateFrom')} />
        <Select value={payment} onChange={(event) => setPayment(event.target.value)} aria-label={t('payment')}>
          <option value="all">{t('allPayments')}</option>
          <option value="paid">{t('pay_paid')}</option>
          <option value="pending">{t('pay_pending')}</option>
          <option value="awaiting_verification">{t('pay_awaiting_verification')}</option>
          <option value="failed">{t('pay_failed')}</option>
        </Select>
      </div>
      {rows.length === 0 ? <EmptyState title={t('noBookings')} /> : null}
      <div className="grid gap-3">
        {rows.map((booking) => (
          <button key={booking.id} type="button" onClick={() => setSelected(booking)} className="rounded-2xl border border-line bg-surface p-4 text-start shadow-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{booking.booking_number}</span>
              <Badge tone={booking.status === 'completed' ? 'success' : booking.status === 'cancelled' ? 'danger' : 'info'}>{t(`status_${booking.status}`)}</Badge>
            </div>
            <p className="mt-1 text-sm">{booking.first_name} {booking.last_name} · {booking.phone}</p>
            <p className="mt-1 text-sm text-muted">{formatAppointmentInZone(booking.appointment_start || booking.appointment_date, BUSINESS_TIME_ZONE)} · {money(booking.total_amount, booking.currency, locale)}</p>
          </button>
        ))}
      </div>
      {selected ? (
        <Modal title={selected.booking_number} onClose={() => setSelected(null)}>
          <BookingEditor booking={selected} onStatus={state.saveStatus} onDelete={state.remove} onClose={() => setSelected(null)} />
        </Modal>
      ) : null}
    </div>
  );
}

function BookingEditor({
  booking,
  onStatus,
  onDelete,
  onClose,
}: {
  booking: Booking;
  onStatus: (id: string, status: BookingStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <div className="space-y-4 text-sm">
      <p>{booking.first_name} {booking.last_name}</p>
      <p>{booking.phone} {booking.email}</p>
      <p>{booking.city} {booking.address}</p>
      <p>{t(`mode_${booking.service_mode ?? 'onsite'}`)}</p>
      <p>{booking.device_type} · {booking.operating_system}</p>
      <p>{booking.problem_description}</p>
      <ul className="space-y-1">
        {(booking.booking_services ?? []).map((line) => (
          <li key={line.id}>{localized(line.service_name_snapshot, i18n.language)} · {formatDurationMinutes(line.duration_minutes, { minutesShort: t('minutesShort'), hoursShort: t('hoursShort') })}</li>
        ))}
      </ul>
      <Field label={t('status')}>
        <Select value={booking.status} onChange={(event) => void onStatus(booking.id, event.target.value as BookingStatus).then(onClose)}>
          {BOOKING_STATUSES.map((status) => <option key={status} value={status}>{t(`status_${status}`)}</option>)}
        </Select>
      </Field>
      {!booking.deleted_at ? (
        <ModalFooter>
          <Button variant="danger" onClick={() => void onDelete(booking.id).then(onClose)}>{t('delete')}</Button>
        </ModalFooter>
      ) : null}
    </div>
  );
}

function CalendarPanel({ bookings }: { bookings: Booking[] }) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => todayISOInTimeZone(BUSINESS_TIME_ZONE).slice(0, 7));
  const grouped = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const booking of bookings) {
      const day = civilDate(booking.appointment_start || booking.appointment_date);
      if (!day.startsWith(month)) continue;
      map.set(day, [...(map.get(day) ?? []), booking]);
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [bookings, month]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('nav_calendar')}</h1>
        <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} aria-label={t('nav_calendar')} />
      </div>
      {grouped.length === 0 ? <EmptyState title={t('noBookings')} /> : null}
      {grouped.map(([day, items]) => (
        <Card key={day} className="p-4">
          <h2 className="font-semibold">{formatISODateToDisplay(day)}</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {items.map((booking) => (
              <li key={booking.id}>{formatAppointmentInZone(booking.appointment_start || booking.appointment_date, BUSINESS_TIME_ZONE).slice(-5)} · {booking.first_name} {booking.last_name} · {t(`status_${booking.status}`)}</li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}

function useCatalog(enabled: boolean) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [methods, setMethods] = useState<PaymentMethodRow[]>([]);
  const [links, setLinks] = useState<ServicePaymentLink[]>([]);
  const [loading, setLoading] = useState(enabled);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await fetchAdminCatalog();
      setCategories(data.categories);
      setServices(data.services);
      setMethods(data.methods);
      setLinks(data.links);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (enabled) void refresh().catch(() => undefined);
  }, [enabled]);

  return { categories, services, methods, links, loading, refresh };
}

type CategorySortColumn = 'name' | 'servicesCount' | 'visible';

function CategoriesPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t, i18n } = useTranslation();
  const catalog = useCatalog(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [sortColumn, setSortColumn] = useState<CategorySortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const rows = catalog.categories.filter((category) => showArchived || !category.archived_at);

  const serviceCount = useCallback(
    (categoryId: string) => catalog.services.filter((service) => service.category_id === categoryId && !service.archived_at).length,
    [catalog.services],
  );

  const toggleSort = (column: CategorySortColumn) => {
    const next = toggleSortState(sortColumn, column, sortDirection);
    setSortColumn(next.column);
    setSortDirection(next.direction);
  };

  const sortedRows = useMemo(() => {
    if (!sortColumn) return rows;
    return [...rows].sort((left, right) => {
      let leftValue: string | number | boolean;
      let rightValue: string | number | boolean;
      if (sortColumn === 'name') {
        leftValue = localized({ ru: left.name_ru, he: left.name_he, en: left.name_en }, i18n.language).toLowerCase();
        rightValue = localized({ ru: right.name_ru, he: right.name_he, en: right.name_en }, i18n.language).toLowerCase();
      } else if (sortColumn === 'servicesCount') {
        leftValue = serviceCount(left.id);
        rightValue = serviceCount(right.id);
      } else {
        leftValue = left.active;
        rightValue = right.active;
      }
      return compareSortValues(leftValue, rightValue, sortDirection);
    });
  }, [rows, sortColumn, sortDirection, serviceCount, i18n.language]);

  const move = async (category: CategoryRow, direction: -1 | 1) => {
    const ordered = [...rows];
    const index = ordered.findIndex((item) => item.id === category.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    await updateCategory(category.id, { sort_order: swap.sort_order });
    await updateCategory(swap.id, { sort_order: category.sort_order });
    await catalog.refresh();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('nav_categories')}</h1>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setShowArchived((value) => !value)}>{t('showArchived')}</Button>
          {isAdmin ? <Button onClick={() => setOpen(true)}>{t('newCategory')}</Button> : null}
        </div>
      </div>
      {!isAdmin ? <Alert>{t('settingsReadOnly')}</Alert> : null}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="table-cols-center min-w-full text-sm">
          <thead>
            <tr>
              <SortableTableHead column="name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('category')} className="px-4 py-3" />
              <SortableTableHead column="servicesCount" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('servicesCount')} className="px-4 py-3" />
              <SortableTableHead column="visible" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('visible')} className="px-4 py-3" />
              <TableHead label={t('actions')} className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((category) => {
              const count = serviceCount(category.id);
              return (
                <tr key={category.id}>
                  <td className="px-4 py-3 font-medium">{localized({ ru: category.name_ru, he: category.name_he, en: category.name_en }, i18n.language)}</td>
                  <td className="px-4 py-3">{count}</td>
                  <td className="px-4 py-3">
                    <Switch checked={category.active} label={t('visible')} onChange={(checked) => {
                      if (!isAdmin) return;
                      void updateCategory(category.id, { active: checked }).then(() => catalog.refresh());
                    }} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" className="px-2.5" aria-label={t('moveUp')} title={t('moveUp')} onClick={() => void move(category, -1).catch(() => toast.error(t('updateError')))}>
                        <ArrowUp className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button variant="ghost" className="px-2.5" aria-label={t('moveDown')} title={t('moveDown')} onClick={() => void move(category, 1).catch(() => toast.error(t('updateError')))}>
                        <ArrowDown className="h-4 w-4" aria-hidden />
                      </Button>
                      {isAdmin ? (
                        <>
                          <Button variant="ghost" onClick={() => setEditing(category)}>{t('edit')}</Button>
                          <Button variant="ghost" onClick={() => void updateCategory(category.id, { archived_at: category.archived_at ? null : new Date().toISOString() }).then(() => catalog.refresh())}>
                            {category.archived_at ? t('restore') : t('archive')}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Preview categories={catalog.categories} services={catalog.services} />
      {open ? <CategoryCreator onClose={() => setOpen(false)} onSaved={() => { setOpen(false); void catalog.refresh(); }} /> : null}
      {editing ? (
        <CategoryEditor
          category={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void catalog.refresh(); }}
        />
      ) : null}
    </div>
  );
}

function CategoryEditor({
  category,
  onClose,
  onSaved,
}: {
  category: CategoryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [nameRu, setNameRu] = useState(category.name_ru);
  const [nameHe, setNameHe] = useState(category.name_he);
  const [nameEn, setNameEn] = useState(category.name_en);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await updateCategory(category.id, { name_ru: nameRu, name_he: nameHe, name_en: nameEn });
      toast.success(t('settingsSaved'));
      onSaved();
    } catch {
      toast.error(t('updateError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('edit')} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('nameRu')}><Input value={nameRu} onChange={(event) => setNameRu(event.target.value)} /></Field>
        <Field label={t('nameHe')}><Input value={nameHe} onChange={(event) => setNameHe(event.target.value)} /></Field>
        <Field label={t('nameEn')}><Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></Field>
      </div>
      <ModalFooter>
        <Button disabled={saving} onClick={() => void save()}>{t('saveCategory')}</Button>
      </ModalFooter>
    </Modal>
  );
}

function CategoryCreator({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [nameRu, setNameRu] = useState('');
  const [nameHe, setNameHe] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [descriptionRu, setDescriptionRu] = useState('');
  const [descriptionHe, setDescriptionHe] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [icon, setIcon] = useState('wrench');
  const [active, setActive] = useState(true);
  const [services, setServices] = useState<ServiceDraft[]>([]);
  const [saving, setSaving] = useState(false);

  const addService = () => {
    setServices((current) => [...current, {
      nameRu: '',
      nameHe: '',
      nameEn: '',
      durationMinutes: 60,
      price: 180,
      priceType: 'fixed',
      currency: 'ILS',
      onsiteAvailable: true,
      remoteAvailable: false,
      workshopAvailable: false,
      requiresDevice: false,
      requiresOperatingSystem: false,
      paymentPolicy: 'after_service',
      active: true,
    }]);
  };

  const save = async () => {
    setSaving(true);
    try {
      await createCategoryWithServices({ nameRu, nameHe, nameEn, descriptionRu, descriptionHe, descriptionEn, icon, active, services });
      toast.success(t('settingsSaved'));
      onSaved();
    } catch (error) {
      toast.error(t(errorI18nKey(error instanceof BookingApiError ? error.code : 'INVALID_INPUT')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('newCategory')} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('nameRu')}><Input value={nameRu} onChange={(event) => setNameRu(event.target.value)} /></Field>
        <Field label={t('nameHe')}><Input value={nameHe} onChange={(event) => setNameHe(event.target.value)} /></Field>
        <Field label={t('nameEn')}><Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></Field>
      </div>
      <div className="mt-3 grid gap-3">
        <Field label={t('description')}><Textarea value={descriptionRu} onChange={(event) => setDescriptionRu(event.target.value)} /></Field>
        <Field label="HE"><Input value={descriptionHe} onChange={(event) => setDescriptionHe(event.target.value)} /></Field>
        <Field label="EN"><Input value={descriptionEn} onChange={(event) => setDescriptionEn(event.target.value)} /></Field>
        <Field label={t('icon')}><Input value={icon} onChange={(event) => setIcon(event.target.value)} /></Field>
        <div className="flex items-center gap-3"><Switch checked={active} onChange={setActive} label={t('visible')} /><span>{t('visible')}</span></div>
      </div>
      <section className="mt-4 rounded-xl border border-line p-3">
        <h3 className="admin-sector-heading">{t('nav_services')}</h3>
        <div className="mb-3 flex justify-end">
          <Button variant="ghost" onClick={addService}>{t('addService')}</Button>
        </div>
        <div className="space-y-3">
          {services.map((service, index) => (
            <div key={index} className="rounded-xl border border-line p-3">
              <h4 className="admin-sector-heading">{t('serviceNames')}</h4>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input placeholder="RU" value={service.nameRu} onChange={(event) => setServices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, nameRu: event.target.value } : item))} />
                <Input placeholder="HE" value={service.nameHe} onChange={(event) => setServices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, nameHe: event.target.value } : item))} />
                <Input placeholder="EN" value={service.nameEn} onChange={(event) => setServices((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, nameEn: event.target.value } : item))} />
              </div>
            </div>
          ))}
        </div>
      </section>
      <ModalFooter>
        <Button disabled={saving} onClick={() => void save()}>{t('saveCategory')}</Button>
      </ModalFooter>
    </Modal>
  );
}

function Preview({ categories, services }: { categories: CategoryRow[]; services: ServiceRow[] }) {
  const { t, i18n } = useTranslation();
  const visible = categories.filter((category) => isPublicCategory({ active: category.active, archivedAt: category.archived_at }));
  return (
    <Card className="p-4">
      <h2 className="font-semibold">{t('previewCatalog')}</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {visible.map((category) => {
          const items = services.filter((service) => service.category_id === category.id && isPublicService(
            { active: service.active, archivedAt: service.archived_at },
            { active: category.active, archivedAt: category.archived_at },
          ));
          return (
            <div key={category.id} className="rounded-xl border border-line p-3">
              <p className="font-medium">{localized({ ru: category.name_ru, he: category.name_he, en: category.name_en }, i18n.language)}</p>
              <ul className="mt-2 text-sm text-muted">
                {items.map((service) => <li key={service.id}>{localized({ ru: service.name_ru, he: service.name_he, en: service.name_en }, i18n.language)}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

type ServiceSortColumn = 'name' | 'category' | 'duration' | 'price' | 'serviceMode' | 'payment' | 'visible';

function ServicesPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t, i18n } = useTranslation();
  const catalog = useCatalog(true);
  const [editing, setEditing] = useState<ServiceRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [sortColumn, setSortColumn] = useState<ServiceSortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const toggleSort = (column: ServiceSortColumn) => {
    const next = toggleSortState(sortColumn, column, sortDirection);
    setSortColumn(next.column);
    setSortDirection(next.direction);
  };

  const categoryName = useCallback(
    (categoryId: string) => {
      const category = catalog.categories.find((item) => item.id === categoryId);
      return category ? localized({ ru: category.name_ru, he: category.name_he, en: category.name_en }, i18n.language).toLowerCase() : '';
    },
    [catalog.categories, i18n.language],
  );

  const serviceModeKey = (service: ServiceRow) =>
    [service.onsite_available && 'onsite', service.remote_available && 'remote', service.workshop_available && 'workshop'].filter(Boolean).join(', ');

  const priceSortKey = (service: ServiceRow) => (service.price != null ? service.price : t(`price_${service.price_type}`).toLowerCase());

  const visibleServices = useMemo(
    () => catalog.services.filter((service) => !service.archived_at),
    [catalog.services],
  );

  const sortedServices = useMemo(() => {
    if (!sortColumn) return visibleServices;
    return [...visibleServices].sort((left, right) => {
      let leftValue: string | number | boolean;
      let rightValue: string | number | boolean;
      switch (sortColumn) {
        case 'name':
          leftValue = localized({ ru: left.name_ru, he: left.name_he, en: left.name_en }, i18n.language).toLowerCase();
          rightValue = localized({ ru: right.name_ru, he: right.name_he, en: right.name_en }, i18n.language).toLowerCase();
          break;
        case 'category':
          leftValue = categoryName(left.category_id);
          rightValue = categoryName(right.category_id);
          break;
        case 'duration':
          leftValue = left.default_duration_minutes;
          rightValue = right.default_duration_minutes;
          break;
        case 'price':
          leftValue = priceSortKey(left);
          rightValue = priceSortKey(right);
          break;
        case 'serviceMode':
          leftValue = serviceModeKey(left);
          rightValue = serviceModeKey(right);
          break;
        case 'payment':
          leftValue = t(`policy_${left.payment_policy}`).toLowerCase();
          rightValue = t(`policy_${right.payment_policy}`).toLowerCase();
          break;
        default:
          leftValue = left.active;
          rightValue = right.active;
          break;
      }
      return compareSortValues(leftValue, rightValue, sortDirection);
    });
  }, [visibleServices, sortColumn, sortDirection, categoryName, i18n.language, t]);

  const headClass = 'px-3 py-3';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('nav_services')}</h1>
        {isAdmin ? <Button onClick={() => setCreating(true)}>{t('newService')}</Button> : null}
      </div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="table-cols-center table-data-start-2-6 min-w-full text-sm">
          <thead>
            <tr>
              <SortableTableHead column="name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('service')} className={headClass} />
              <SortableTableHead column="category" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('category')} className={headClass} />
              <SortableTableHead column="duration" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('duration')} className={headClass} />
              <SortableTableHead column="price" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('price')} className={headClass} />
              <SortableTableHead column="serviceMode" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('serviceMode')} className={headClass} />
              <SortableTableHead column="payment" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('payment')} className={headClass} />
              <SortableTableHead column="visible" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('visible')} className={headClass} />
              <TableHead label={t('actions')} className={headClass} />
            </tr>
          </thead>
          <tbody>
            {sortedServices.map((service) => {
              const category = catalog.categories.find((item) => item.id === service.category_id);
              return (
                <tr key={service.id}>
                  <td className="px-3 py-3">{localized({ ru: service.name_ru, he: service.name_he, en: service.name_en }, i18n.language)}</td>
                  <td className="px-3 py-3">{category ? localized({ ru: category.name_ru, he: category.name_he, en: category.name_en }, i18n.language) : ''}</td>
                  <td className="px-3 py-3">{service.default_duration_minutes}</td>
                  <td className="px-3 py-3">{service.price ?? t(`price_${service.price_type}`)}</td>
                  <td className="px-3 py-3">{[service.onsite_available && 'onsite', service.remote_available && 'remote', service.workshop_available && 'workshop'].filter(Boolean).join(', ')}</td>
                  <td className="px-3 py-3">{t(`policy_${service.payment_policy}`)}</td>
                  <td className="px-3 py-3">
                    <Switch checked={service.active} label={t('visible')} onChange={(checked) => {
                      if (!isAdmin) return;
                      void updateService(service.id, { active: checked }).then(() => catalog.refresh());
                    }} />
                  </td>
                  <td className="px-3 py-3">
                    <Button variant="ghost" onClick={() => setEditing(service)}>{t('edit')}</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {creating ? (
        <ServiceForm
          categories={catalog.categories}
          methods={catalog.methods}
          links={catalog.links}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void catalog.refresh(); }}
        />
      ) : null}
      {editing ? (
        <ServiceForm
          initial={editing}
          categories={catalog.categories}
          methods={catalog.methods}
          links={catalog.links}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void catalog.refresh(); }}
        />
      ) : null}
    </div>
  );
}

function ServiceForm({
  initial,
  categories,
  methods,
  links,
  onClose,
  onSaved,
}: {
  initial?: ServiceRow;
  categories: CategoryRow[];
  methods: PaymentMethodRow[];
  links: ServicePaymentLink[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [categoryId, setCategoryId] = useState(initial?.category_id ?? categories[0]?.id ?? '');
  const [nameRu, setNameRu] = useState(initial?.name_ru ?? '');
  const [nameHe, setNameHe] = useState(initial?.name_he ?? '');
  const [nameEn, setNameEn] = useState(initial?.name_en ?? '');
  const [duration, setDuration] = useState(initial?.default_duration_minutes ?? 60);
  const [price, setPrice] = useState(initial?.price?.toString() ?? '');
  const [priceType, setPriceType] = useState<PriceType>(initial?.price_type ?? 'fixed');
  const [policy, setPolicy] = useState<PaymentPolicy>(initial?.payment_policy ?? 'after_service');
  const [onsite, setOnsite] = useState(initial?.onsite_available ?? true);
  const [remote, setRemote] = useState(initial?.remote_available ?? false);
  const [workshop, setWorkshop] = useState(initial?.workshop_available ?? false);
  const [requiresDevice, setRequiresDevice] = useState(initial?.requires_device ?? false);
  const [requiresOs, setRequiresOs] = useState(initial?.requires_operating_system ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [enabledMethods, setEnabledMethods] = useState<Record<string, boolean>>(() => {
    const map: Record<string, boolean> = {};
    for (const method of methods) {
      const link = links.find((item) => item.service_id === initial?.id && item.payment_method_id === method.id);
      map[method.id] = link ? link.enabled : true;
    }
    return map;
  });

  const save = async () => {
    const payload = {
      category_id: categoryId,
      name_ru: nameRu,
      name_he: nameHe,
      name_en: nameEn,
      description_ru: initial?.description_ru ?? null,
      description_he: initial?.description_he ?? null,
      description_en: initial?.description_en ?? null,
      default_duration_minutes: duration,
      price: price.trim() === '' ? null : Number(price),
      price_type: priceType,
      currency: 'ILS',
      onsite_available: onsite,
      remote_available: remote,
      workshop_available: workshop,
      requires_device: requiresDevice,
      requires_operating_system: requiresOs,
      payment_policy: policy,
      active,
      sort_order: initial?.sort_order ?? 0,
    };
    try {
      if (initial) {
        await updateService(initial.id, payload);
        await Promise.all(methods.map((method) => setServicePaymentMethod(initial.id, method.id, enabledMethods[method.id] !== false)));
      } else {
        await insertService({ ...payload, code: slugCode(nameEn) || `service_${Date.now().toString(36)}` });
      }
      toast.success(t('settingsSaved'));
      onSaved();
    } catch {
      toast.error(t('updateError'));
    }
  };

  return (
    <Modal title={initial ? t('edit') : t('newService')} onClose={onClose}>
      <section className="rounded-xl border border-line p-3">
        <h3 className="admin-sector-heading">{t('serviceNames')}</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('nameRu')}><Input value={nameRu} onChange={(event) => setNameRu(event.target.value)} /></Field>
          <Field label={t('nameHe')}><Input value={nameHe} onChange={(event) => setNameHe(event.target.value)} /></Field>
          <Field label={t('nameEn')}><Input value={nameEn} onChange={(event) => setNameEn(event.target.value)} /></Field>
        </div>
      </section>
      <section className="mt-4 rounded-xl border border-line p-3">
        <h3 className="admin-sector-heading">{t('serviceParameters')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('category')}>
            <Select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
              {categories.filter((category) => !category.archived_at).map((category) => (
                <option key={category.id} value={category.id}>{category.name_ru}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('durationMinutes')}><Input type="number" min={15} max={720} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></Field>
          <Field label={t('priceType')}>
            <Select value={priceType} onChange={(event) => setPriceType(event.target.value as PriceType)}>
              {PRICE_TYPES.map((item) => <option key={item} value={item}>{t(`price_${item}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('price')}><Input value={price} onChange={(event) => setPrice(event.target.value)} /></Field>
          <Field label={t('paymentPolicy')}>
            <Select value={policy} onChange={(event) => setPolicy(event.target.value as PaymentPolicy)}>
              {PAYMENT_POLICIES.map((item) => <option key={item} value={item}>{t(`policy_${item}`)}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={onsite} onChange={(event) => setOnsite(event.target.checked)} />{t('mode_onsite')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={remote} onChange={(event) => setRemote(event.target.checked)} />{t('mode_remote')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={workshop} onChange={(event) => setWorkshop(event.target.checked)} />{t('mode_workshop')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={requiresDevice} onChange={(event) => setRequiresDevice(event.target.checked)} />{t('requiresDevice')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={requiresOs} onChange={(event) => setRequiresOs(event.target.checked)} />{t('requiresOs')}</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />{t('visible')}</label>
        </div>
      </section>
      {initial ? (
        <section className="mt-4 rounded-xl border border-line p-3">
          <h3 className="admin-sector-heading">{t('paytab_methods')}</h3>
          <div className="space-y-2">
            {methods.map((method) => (
              <label key={method.id} className="flex items-center justify-between gap-3 text-sm">
                <span>{method.name_en}</span>
                <Switch checked={enabledMethods[method.id] !== false} label={method.name_en} onChange={(checked) => setEnabledMethods((current) => ({ ...current, [method.id]: checked }))} />
              </label>
            ))}
          </div>
        </section>
      ) : null}
      <ModalFooter>
        <Button onClick={() => void save()}>{t('save')}</Button>
      </ModalFooter>
    </Modal>
  );
}

type StaffSortColumn = 'first_name' | 'last_name' | 'phone' | 'address' | 'email' | 'role' | 'visible';
type StaffTextField = 'first_name' | 'last_name' | 'phone' | 'address';

function staffProfileFields(row: Pick<StaffRow, 'first_name' | 'last_name' | 'phone' | 'address'>): StaffProfileInput {
  return {
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    address: row.address,
  };
}

function StaffPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<StaffRow[]>([]);
  const [open, setOpen] = useState(false);
  const [sortColumn, setSortColumn] = useState<StaffSortColumn | null>('last_name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [drafts, setDrafts] = useState<Record<string, Partial<Record<StaffTextField, string>>>>({});

  const refresh = useCallback(() => fetchStaff().then((data) => {
    setRows(data);
    setDrafts({});
  }).catch(() => toast.error(t('fetchError'))), [t]);
  useEffect(() => { void refresh(); }, [refresh]);

  const toggleSort = (column: StaffSortColumn) => {
    const next = toggleSortState(sortColumn, column, sortDirection);
    setSortColumn(next.column);
    setSortDirection(next.direction);
  };

  const sortedRows = useMemo(() => {
    if (!sortColumn) return rows;
    return [...rows].sort((left, right) => {
      let leftValue: string | number | boolean;
      let rightValue: string | number | boolean;
      if (sortColumn === 'email') {
        leftValue = (left.email || left.user_id).toLowerCase();
        rightValue = (right.email || right.user_id).toLowerCase();
      } else if (sortColumn === 'role') {
        leftValue = left.role;
        rightValue = right.role;
      } else if (sortColumn === 'visible') {
        leftValue = left.active;
        rightValue = right.active;
      } else {
        leftValue = (left[sortColumn] ?? '').toLowerCase();
        rightValue = (right[sortColumn] ?? '').toLowerCase();
      }
      return compareSortValues(leftValue, rightValue, sortDirection);
    });
  }, [rows, sortColumn, sortDirection]);

  const fieldValue = (row: StaffRow, field: StaffTextField): string => {
    const draft = drafts[row.user_id]?.[field];
    if (draft !== undefined) return draft;
    return row[field] ?? '';
  };

  const setDraft = (userId: string, field: StaffTextField, value: string) => {
    setDrafts((current) => ({ ...current, [userId]: { ...current[userId], [field]: value } }));
  };

  const clearDraft = (userId: string, field: StaffTextField) => {
    setDrafts((current) => {
      const next = { ...current[userId] };
      delete next[field];
      const copy = { ...current };
      if (Object.keys(next).length === 0) delete copy[userId];
      else copy[userId] = next;
      return copy;
    });
  };

  const mergedRow = (row: StaffRow): StaffRow => {
    const draft = drafts[row.user_id];
    if (!draft) return row;
    return {
      ...row,
      first_name: draft.first_name !== undefined ? draft.first_name || null : row.first_name,
      last_name: draft.last_name !== undefined ? draft.last_name || null : row.last_name,
      phone: draft.phone !== undefined ? draft.phone || null : row.phone,
      address: draft.address !== undefined ? draft.address || null : row.address,
    };
  };

  const persistStaff = (row: StaffRow, patch: Partial<StaffRow>) => {
    if (!isAdmin || !row.email) return;
    const next: StaffRow = { ...mergedRow(row), ...patch };
    void setStaff(next.email, next.role, next.active, undefined, staffProfileFields(next))
      .then(() => { toast.success(t('settingsSaved')); return refresh(); })
      .catch((error: unknown) => toast.error(t(errorI18nKey(error instanceof BookingApiError ? error.code : 'INVALID_INPUT'))));
  };

  const saveTextField = (row: StaffRow, field: StaffTextField) => {
    const value = fieldValue(row, field).trim();
    const previous = (row[field] ?? '').trim();
    clearDraft(row.user_id, field);
    if (value === previous) return;
    persistStaff(row, { [field]: value || null } as Partial<StaffRow>);
  };

  const headClass = 'px-3 py-3 whitespace-nowrap';

  return (
    <div className="space-y-4">
      <div className="relative">
        <h1 className="text-center text-2xl font-semibold">{t('nav_technicians')}</h1>
        {isAdmin ? (
          <div className="absolute end-0 top-0">
            <Button onClick={() => setOpen(true)}>{t('newTechnician')}</Button>
          </div>
        ) : null}
      </div>
      {!isAdmin ? <Alert>{t('settingsReadOnly')}</Alert> : null}
      {sortedRows.length === 0 ? (
        <EmptyState title={t('noTechnicians')} />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="table-cols-center min-w-full text-sm">
            <thead>
              <tr>
                <SortableTableHead column="first_name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('firstName')} className={headClass} />
                <SortableTableHead column="last_name" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('lastName')} className={headClass} />
                <SortableTableHead column="phone" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('phone')} className={headClass} />
                <SortableTableHead column="address" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('address')} className={headClass} />
                <SortableTableHead column="email" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('email')} className={headClass} />
                <SortableTableHead column="role" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('role')} className={headClass} />
                <SortableTableHead column="visible" activeColumn={sortColumn} direction={sortDirection} onSort={toggleSort} label={t('visible')} className={headClass} />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.user_id}>
                  {(['first_name', 'last_name', 'phone', 'address'] as const).map((field) => (
                    <td key={field} className="px-3 py-2">
                      {isAdmin && row.email ? (
                        <Input
                          value={fieldValue(row, field)}
                          onChange={(event) => setDraft(row.user_id, field, event.target.value)}
                          onBlur={() => saveTextField(row, field)}
                          className="min-w-[8rem]"
                        />
                      ) : (
                        <span>{row[field] || '—'}</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-3 text-start font-medium">{row.email || row.user_id}</td>
                  <td className="px-3 py-3">
                    {isAdmin && row.email ? (
                      <Select
                        value={row.role}
                        onChange={(event) => persistStaff(row, { role: event.target.value as 'admin' | 'technician' })}
                        className="min-w-[10rem]"
                      >
                        <option value="admin">{t('role_admin')}</option>
                        <option value="technician">{t('role_technician')}</option>
                      </Select>
                    ) : (
                      <Badge>{t(`role_${row.role}`)}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <Switch
                      checked={row.active}
                      label={row.active ? t('visible') : t('hidden')}
                      onChange={(checked) => {
                        if (!isAdmin) return;
                        persistStaff(row, { active: checked });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open ? (
        <StaffCreator
          onClose={() => setOpen(false)}
          onSaved={() => { setOpen(false); void refresh(); }}
        />
      ) : null}
    </div>
  );
}

function StaffCreator({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'technician'>('technician');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await setStaff(email, role, active, password, {
        firstName: firstName.trim() || null,
        lastName: lastName.trim() || null,
        phone: phone.trim() || null,
        address: address.trim() || null,
      });
      toast.success(t('settingsSaved'));
      onSaved();
    } catch (error: unknown) {
      toast.error(t(errorI18nKey(error instanceof BookingApiError ? error.code : 'INVALID_INPUT')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('newTechnician')} onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('firstName')}><Input value={firstName} onChange={(event) => setFirstName(event.target.value)} autoComplete="off" /></Field>
        <Field label={t('lastName')}><Input value={lastName} onChange={(event) => setLastName(event.target.value)} autoComplete="off" /></Field>
        <Field label={t('phone')}><Input value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="off" /></Field>
        <Field label={t('address')}><Input value={address} onChange={(event) => setAddress(event.target.value)} autoComplete="off" /></Field>
        <Field label={t('email')}><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="off" /></Field>
        <Field label={t('password')}>
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
        </Field>
        <p className="text-xs text-muted sm:col-span-2">{t('staffPasswordHint')}</p>
        <Field label={t('role')}>
          <Select value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'technician')}>
            <option value="admin">{t('role_admin')}</option>
            <option value="technician">{t('role_technician')}</option>
          </Select>
        </Field>
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />{t('visible')}</label>
      </div>
      <ModalFooter>
        <Button variant="ghost" onClick={onClose}>{t('back')}</Button>
        <Button disabled={saving || !email.trim()} onClick={() => void save()}>{t('save')}</Button>
      </ModalFooter>
    </Modal>
  );
}

function SchedulePanel({ state, isAdmin }: { state: ReturnType<typeof useBookingSettings>; isAdmin: boolean }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(state.settings);
  useEffect(() => setDraft(state.settings), [state.settings]);
  if (!draft) return null;
  const updateDay = (weekday: number, patch: Partial<WorkingHourDay>) => {
    setDraft({
      ...draft,
      workingHours: draft.workingHours.map((day) => day.weekday === weekday ? { ...day, ...patch } : day),
    });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('nav_schedule')}</h1>
      {!isAdmin ? <Alert>{t('settingsReadOnly')}</Alert> : null}
      {draft.workingHours.map((day) => (
        <div key={day.weekday} className="grid items-center gap-2 rounded-xl border border-line bg-surface p-3 sm:grid-cols-[140px_80px_1fr_1fr]">
          <span className="text-sm font-medium">{t(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][day.weekday])}</span>
          <Switch checked={day.enabled} label={t('visible')} onChange={(checked) => updateDay(day.weekday, { enabled: checked })} />
          <Input type="time" value={day.startTime} onChange={(event) => updateDay(day.weekday, { startTime: event.target.value })} />
          <Input type="time" value={day.endTime} onChange={(event) => updateDay(day.weekday, { endTime: event.target.value })} />
        </div>
      ))}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t('slotStep')}><Input type="number" value={draft.slotStepMinutes} onChange={(event) => setDraft({ ...draft, slotStepMinutes: Number(event.target.value) })} /></Field>
        <Field label={t('paymentHold')}><Input type="number" value={draft.paymentHoldMinutes} onChange={(event) => setDraft({ ...draft, paymentHoldMinutes: Number(event.target.value) })} /></Field>
        <Field label={t('bufferMinutes')}><Input type="number" value={draft.bufferMinutes} onChange={(event) => setDraft({ ...draft, bufferMinutes: Number(event.target.value) })} /></Field>
      </div>
      <Field label={t('disabledDates')}>
        <Input
          placeholder="dd/mm/yyyy"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            const value = event.currentTarget.value.trim();
            const iso = parseDisplayDate(value) ?? (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
            if (!iso) return;
            setDraft({ ...draft, disabledDates: [...new Set([...draft.disabledDates, iso])].sort() });
            event.currentTarget.value = '';
          }}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {draft.disabledDates.map((date) => (
            <button key={date} type="button" className="rounded-full bg-canvas px-3 py-1 text-xs" onClick={() => setDraft({ ...draft, disabledDates: draft.disabledDates.filter((item) => item !== date) })}>{formatISODateToDisplay(date)}</button>
          ))}
        </div>
      </Field>
      {isAdmin ? <Button onClick={() => void state.save(draft).then(() => toast.success(t('settingsSaved'))).catch(() => toast.error(t('updateError')))}>{t('saveSettings')}</Button> : null}
    </div>
  );
}

function SettingsPanel({ state, isAdmin }: { state: ReturnType<typeof useBookingSettings>; isAdmin: boolean }) {
  const { t } = useTranslation();
  const settings = state.settings;
  if (!settings) return null;
  return (
    <Card className="max-w-xl space-y-4 p-5">
      <h1 className="text-2xl font-semibold">{t('nav_settings')}</h1>
      <p className="text-sm text-muted">{t('timezoneLabel')}: {settings.timezone}</p>
      <Field label={t('firstDayOfWeek')}>
        <Select
          value={settings.firstDayOfWeek}
          disabled={!isAdmin}
          onChange={(event) => void state.save({ ...settings, firstDayOfWeek: event.target.value === '0' ? 0 : 1 })}
        >
          <option value={1}>{t('monday')}</option>
          <option value={0}>{t('sunday')}</option>
        </Select>
      </Field>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>{t('sendSMS')}</span>
        <Switch checked={settings.sendSms} label={t('sendSMS')} onChange={(checked) => { if (isAdmin) void state.save({ ...settings, sendSms: checked }); }} />
      </label>
      <Field label={t('maxBookingsPerDay')}>
        <Input
          type="number"
          disabled={!isAdmin}
          value={settings.maxBookingsPerDay ?? ''}
          onChange={(event) => void state.save({ ...settings, maxBookingsPerDay: event.target.value ? Number(event.target.value) : null })}
        />
      </Field>
      <Alert>{t('cardDataNote')}</Alert>
      <Alert>{t('credentialsNote')}</Alert>
    </Card>
  );
}

function PaymentsPanel({ isAdmin }: { isAdmin: boolean }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<'transactions' | 'methods' | 'bank'>('transactions');
  const [payments, setPayments] = useState<PaymentListItem[]>([]);
  const [filter, setFilter] = useState('all');
  const catalog = useCatalog(true);
  const [bank, setBank] = useState({ bank_name: '', branch: '', account_number: '', beneficiary: '', iban: '', instructions_ru: '', instructions_he: '', instructions_en: '' });

  const refresh = useCallback(() => fetchPayments().then(setPayments).catch(() => toast.error(t('fetchError'))), [t]);
  useEffect(() => {
    void refresh();
    void fetchBankProfile().then((profile) => {
      if (!profile) return;
      setBank({
        bank_name: profile.bank_name ?? '',
        branch: profile.branch ?? '',
        account_number: profile.account_number ?? '',
        beneficiary: profile.beneficiary ?? '',
        iban: profile.iban ?? '',
        instructions_ru: profile.instructions_ru ?? '',
        instructions_he: profile.instructions_he ?? '',
        instructions_en: profile.instructions_en ?? '',
      });
    }).catch(() => undefined);
  }, [refresh]);

  const visible = payments.filter((payment) => filter === 'all' || payment.status === filter || (filter === 'refunded' && (payment.status === 'refunded' || payment.status === 'partially_refunded')));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t('nav_payments')}</h1>
      <div className="flex gap-2">
        {(['transactions', 'methods', 'bank'] as const).map((item) => (
          <Button key={item} variant={tab === item ? 'primary' : 'ghost'} onClick={() => setTab(item)}>{t(`paytab_${item}`)}</Button>
        ))}
      </div>
      {tab === 'transactions' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {['all', 'paid', 'pending', 'failed', 'awaiting_verification', 'refunded'].map((item) => (
              <Button key={item} variant={filter === item ? 'secondary' : 'ghost'} onClick={() => setFilter(item)}>{t(item === 'all' ? 'allPayments' : `pay_${item}`)}</Button>
            ))}
          </div>
          {visible.length === 0 ? <EmptyState title={t('noPayments')} /> : null}
          {visible.map((payment) => (
            <Card key={payment.id} className="grid gap-2 p-4 text-sm md:grid-cols-6">
              <span>{payment.bookings?.booking_number}</span>
              <span>{payment.bookings?.first_name} {payment.bookings?.last_name}</span>
              <span>{payment.payment_methods ? localized({ ru: payment.payment_methods.name_ru, he: payment.payment_methods.name_he, en: payment.payment_methods.name_en }, i18n.language) : payment.provider}</span>
              <span>{formatMoney(Number(payment.amount), payment.currency, i18n.language)}</span>
              <Badge>{t(`pay_${payment.status}`)}</Badge>
              {isAdmin && (payment.status === 'pending' || payment.status === 'awaiting_verification') ? (
                <span className="flex gap-2">
                  <Button onClick={() => void reviewPayment(payment.id, 'paid').then(refresh)}>{t('confirmPayment')}</Button>
                  <Button variant="ghost" onClick={() => void reviewPayment(payment.id, 'failed').then(refresh)}>{t('rejectPayment')}</Button>
                </span>
              ) : <span className="text-muted">{payment.paid_at ? payment.paid_at.slice(0, 10) : ''}</span>}
            </Card>
          ))}
        </div>
      ) : null}
      {tab === 'methods' ? (
        <div className="space-y-3">
          {catalog.methods.map((method) => (
            <Card key={method.id} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{localized({ ru: method.name_ru, he: method.name_he, en: method.name_en }, i18n.language)}</p>
                <p className="text-xs text-muted">{t(`integration_${method.integration_type}`)}</p>
              </div>
              <Switch checked={method.active} label={method.code} onChange={(checked) => {
                if (!isAdmin) return;
                void updatePaymentMethod(method.id, { active: checked }).then(() => catalog.refresh());
              }} />
            </Card>
          ))}
          <Alert>{t('credentialsNote')}</Alert>
        </div>
      ) : null}
      {tab === 'bank' ? (
        <Card className="grid max-w-xl gap-3 p-4">
          <Field label={t('bankName')}><Input value={bank.bank_name} onChange={(event) => setBank({ ...bank, bank_name: event.target.value })} /></Field>
          <Field label={t('branch')}><Input value={bank.branch} onChange={(event) => setBank({ ...bank, branch: event.target.value })} /></Field>
          <Field label={t('accountNumber')}><Input value={bank.account_number} onChange={(event) => setBank({ ...bank, account_number: event.target.value })} /></Field>
          <Field label={t('beneficiary')}><Input value={bank.beneficiary} onChange={(event) => setBank({ ...bank, beneficiary: event.target.value })} /></Field>
          <Field label="IBAN"><Input value={bank.iban} onChange={(event) => setBank({ ...bank, iban: event.target.value })} /></Field>
          <Field label={t('instructions')}><Textarea value={bank.instructions_ru} onChange={(event) => setBank({ ...bank, instructions_ru: event.target.value })} /></Field>
          {isAdmin ? <Button onClick={() => void saveBankProfile(bank).then(() => toast.success(t('settingsSaved'))).catch(() => toast.error(t('updateError')))}>{t('save')}</Button> : null}
        </Card>
      ) : null}
    </div>
  );
}