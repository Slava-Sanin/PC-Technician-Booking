import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from './BrandLogo';
import { LanguageSwitcher } from './LanguageSwitcher';
import { ThemeSwitcher } from './ThemeSwitcher';
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
    <header className="shrink-0 border-b border-line bg-hd text-hdt">
      <div className="flex w-full flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2 sm:gap-x-3 sm:px-5 lg:flex-nowrap xl:px-8">
        <div className="order-1 flex min-w-0 flex-1 items-center gap-2.5 sm:gap-3">
          <BrandLogo className="h-11 w-auto shrink-0 object-contain sm:h-14 lg:h-16" />
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase leading-none tracking-wide text-hdt/70">{t('brandKicker')}</p>
            <h1 className="text-balance break-words text-base font-semibold leading-tight text-hdt sm:text-lg">{t('title')}</h1>
            {subtitle ? <p className="hidden break-words text-xs text-hdt/75 sm:block">{subtitle}</p> : null}
          </div>
        </div>
        <div className="order-2 flex shrink-0 items-center gap-1 self-center lg:order-3 lg:ms-1">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
        <div className="order-3 flex w-full min-w-0 basis-full items-stretch gap-1.5 sm:justify-end sm:gap-2 lg:order-2 lg:ms-0 lg:w-auto lg:basis-auto lg:justify-start">
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
                    <SectorButton onClick={onStaffAdmin}>{t('staffEntry')}</SectorButton>
                  ) : null}
                  <SectorButton className="text-danger" onClick={onStaffLogout}>{t('logout')}</SectorButton>
                </div>
              </>
            ) : area === 'booking' ? (
              <SectorButton onClick={onStaffAdmin}>{t('staffEntry')}</SectorButton>
            ) : null}
          </HeaderSector>
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
