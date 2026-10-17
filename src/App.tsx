import { useEffect, useState } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { AdminView } from './components/admin/AdminView';
import type { SubscriptionReturn } from './components/admin/SubscriptionPanel';
import { BookingPage } from './components/booking/BookingPage';
import { ConfirmProvider } from './components/ui/ConfirmProvider';
import { useDocumentDirection } from './hooks/useDocumentDirection';
import { verifyCustomerRegistration } from './services/customerService';
import { BookingApiError, errorI18nKey } from './utils/errors';

interface StaffEntryParams {
  staffRegisterToken: string | null;
  subscriptionReturn: SubscriptionReturn | null;
}

/** Reads one-shot query parameters that must open the staff area (registration link, Cardcom redirect). */
function readStaffEntryParams(): StaffEntryParams {
  const params = new URLSearchParams(window.location.search);
  const staffRegisterToken = params.get('staffRegisterToken');
  const subscription = params.get('subscription');
  const subscriptionReturn: SubscriptionReturn | null =
    subscription === 'success' || subscription === 'failed' ? subscription : null;

  if (staffRegisterToken || subscriptionReturn) {
    params.delete('staffRegisterToken');
    params.delete('subscription');
    params.delete('id');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }

  return { staffRegisterToken, subscriptionReturn };
}

function App() {
  useDocumentDirection();
  const { t } = useTranslation();
  const [staffEntry, setStaffEntry] = useState<StaffEntryParams>(readStaffEntryParams);
  const [showAdmin, setShowAdmin] = useState(Boolean(staffEntry.staffRegisterToken || staffEntry.subscriptionReturn));

  const closeAdmin = () => {
    // One-shot parameters must not replay when the staff area is reopened.
    setStaffEntry({ staffRegisterToken: null, subscriptionReturn: null });
    setShowAdmin(false);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const registerToken = params.get('registerToken');
    if (!registerToken) return;

    const separator = registerToken.indexOf('.');
    if (separator <= 0) return;

    const challengeId = registerToken.slice(0, separator);
    const token = registerToken.slice(separator + 1);
    void verifyCustomerRegistration({ challengeId, token })
      .then(() => toast.success(t('customerRegisterSuccess')))
      .catch((error) => {
        const code = error instanceof BookingApiError ? error.code : 'INTERNAL_ERROR';
        toast.error(t(errorI18nKey(code)));
      })
      .finally(() => {
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
      });
  }, [t]);

  return (
    <ConfirmProvider>
      {showAdmin ? (
        <AdminView
          onCloseAdmin={closeAdmin}
          staffRegisterToken={staffEntry.staffRegisterToken}
          subscriptionReturn={staffEntry.subscriptionReturn}
        />
      ) : (
        <>
          <Toaster position="top-center" />
          <BookingPage onOpenAdmin={() => setShowAdmin(true)} />
        </>
      )}
    </ConfirmProvider>
  );
}

export default App;
