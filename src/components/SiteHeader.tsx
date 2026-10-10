import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from './BrandLogo';
import { LanguageSwitcher } from './LanguageSwitcher';
import type { CustomerProfile } from '../services/customerService';
import type { StaffProfile } from '../types/bookingSettings';

export type SiteHeaderArea = 'booking' | 'admin';

export function SiteHeader({
  subtitle,
  area,
  customer,
  staff,
  staffEmail,
  onCustomerAccount,
  onCustomerBookings,
  onCustomerLogout,
  onStaffAdmin,
  onStaffLogout,
  onGoToBooking,
}: {
  subtitle?: string;
  area: SiteHeaderArea;
  customer: CustomerProfile | null;
  staff: StaffProfile | null;
  staffEmail?: string | null;
  onCustomerAccount: () => void;
  onCustomerBookings: () => void;
  onCustomerLogout: () => void;
  onStaffAdmin: () => void;
  onStaffLogout: () => void;
  onGoToBooking: () => void;
}) {
  const { t } = useTranslation();

  const customerLabel = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(' ').trim() || customer.email || customer.phone || t('customerAccount')
    : null;

  const staffLabel = staff
    ? staffEmail?.trim() || t(`role_${staff.role}`)
    : null;

  return (
    <header className="shrink-0 border-b border-line bg-surface">
      <div className="flex w-full items-center justify-between gap-3 px-3 py-2 sm:px-5 xl:px-8">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <BrandLogo />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-secondary">{t('brandKicker')}</p>
            <h1 className="truncate text-base font-semibold leading-tight text-ink sm:text-lg">{t('title')}</h1>
            {subtitle ? <p className="hidden truncate text-xs text-muted sm:block">{subtitle}</p> : null}
          </div>
        </div>
        <div className="flex shrink-0 items-stretch gap-2 sm:gap-3">
          <HeaderSector label={t('headerSectorClients')}>
            {customer ? (
              <>
                <p className="header-action-sector-status" title={customerLabel ?? undefined}>{customerLabel}</p>
                <div className="header-action-sector-actions">
                  <SectorButton className="text-primary" onClick={onCustomerBookings}>{t('customerMyBookings')}</SectorButton>
                  <SectorButton className="text-danger" onClick={onCustomerLogout}>{t('logout')}</SectorButton>
                </div>
              </>
            ) : area === 'admin' ? (
              <SectorButton onClick={onGoToBooking}>{t('backToBooking')}</SectorButton>
            ) : (
              <SectorButton onClick={onCustomerAccount}>{t('customerAccount')}</SectorButton>
            )}
          </HeaderSector>
          <HeaderSector label={t('headerSectorStaff')}>
            {staff ? (
              <>
                <p className="header-action-sector-status" title={staffLabel ?? undefined}>
                  {t(`role_${staff.role}`)}
                  {staffEmail ? <span className="block truncate text-[9px] font-normal text-muted sm:text-[10px]">{staffEmail}</span> : null}
                </p>
                <div className="header-action-sector-actions">
                  {area === 'booking' ? (
                    <SectorButton onClick={onStaffAdmin}>{t('admin')}</SectorButton>
                  ) : null}
                  <SectorButton className="text-danger" onClick={onStaffLogout}>{t('logout')}</SectorButton>
                </div>
              </>
            ) : area === 'booking' ? (
              <SectorButton onClick={onStaffAdmin}>{t('admin')}</SectorButton>
            ) : null}
          </HeaderSector>
          <div className="ms-1 flex items-center self-center sm:ms-3">
            <LanguageSwitcher />
          </div>
        </div>
      </div>
    </header>
  );
}

function HeaderSector({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="header-action-sector">
      <span className="header-action-sector-label">{label}</span>
      {children}
    </div>
  );
}

function SectorButton({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`header-action-sector-btn ${className}`.trim()}>
      {children}
    </button>
  );
}
